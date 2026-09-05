/**
 * News & sentiment analysis service.
 *
 * Fetches recent news for a stock via web search, then uses the AI provider
 * to read each article's headline + summary and produce:
 *   - Sentiment label (bullish/bearish/neutral)
 *   - Confidence score
 *   - Impact rating (high/medium/low)
 *   - Key topics
 *   - Options strategy implication
 *
 * When no AI key is configured, produces a deterministic keyword-based
 * sentiment estimate as a fallback.
 */

import "server-only";
import { web_search } from "@/lib/web-search";
import { getAIProvider, isAIStub, type AIMessage } from "@/features/ai/provider";
import type { NewsArticle, NewsSentiment, NewsSentimentReport } from "@/lib/types";

const BULLISH_KEYWORDS = [
  "beat", "beats", "surpass", "exceed", "record", "high", "growth", "grow", "grew",
  "profit", "gain", "gains", "rise", "rises", "rising", "rose", "jump", "jumps",
  "soar", "surge", "rally", "upgrade", "upgraded", "buy", "overweight", "bullish",
  "positive", "strong", "outperform", "raise", "raised", "boost", "expand",
  "partnership", "deal", "contract", "approve", "approval", "launch", "innovate",
  "dividend", "buyback", "repurchase", "announce", "win", "wins", "award",
];

const BEARISH_KEYWORDS = [
  "miss", "misses", "missed", "fall", "falls", "falling", "fell", "drop", "drops",
  "decline", "declines", "declining", "plunge", "plunges", "crash", "sell", "selling",
  "downgrade", "downgraded", "sell", "underweight", "bearish", "negative", "weak",
  "loss", "losses", "cut", "cuts", "reduced", "reduce", "lower", "lawsuit", "sued",
  "investigation", "probe", "fraud", "recall", "halt", "suspend", "delay",
  "concern", "worries", "risk", "threat", "shrink", "close", "closing", "layoff",
  "fire", "fired", "resign", "resignation", "scandal", "setback", "disappoint",
];

export async function fetchNews(symbol: string, maxArticles = 15): Promise<NewsArticle[]> {
  const results = await web_search(`${symbol} stock news latest`, maxArticles);
  const articles: NewsArticle[] = [];
  for (const r of results) {
    // Skip non-article results (homepages, generic pages).
    if (!r.title || r.title.length < 10) continue;
    articles.push({
      id: `${symbol}-${r.url}`,
      symbol,
      headline: r.title,
      summary: r.summary ?? null,
      url: r.url,
      source: extractSource(r.url),
      publishedAt: new Date().toISOString(), // Web search doesn't always give dates
      sentiment: null,
    });
  }
  return articles.slice(0, maxArticles);
}

export async function analyzeNewsSentiment(
  symbol: string,
  articles: NewsArticle[],
): Promise<NewsSentimentReport> {
  const warnings: string[] = [];
  const stub = isAIStub();

  let analyzedArticles: NewsArticle[];

  if (stub) {
    // Deterministic keyword-based sentiment.
    analyzedArticles = articles.map((a) => ({
      ...a,
      sentiment: keywordSentiment(a.headline + " " + (a.summary ?? "")),
    }));
    warnings.push("AI provider not configured — using keyword-based sentiment. Add AI_API_KEY for AI-powered analysis.");
  } else {
    // AI-powered batch sentiment analysis.
    analyzedArticles = await aiBatchSentiment(symbol, articles);
  }

  // Aggregate.
  const bullish = analyzedArticles.filter((a) => a.sentiment?.label === "bullish");
  const bearish = analyzedArticles.filter((a) => a.sentiment?.label === "bearish");
  const neutral = analyzedArticles.filter((a) => a.sentiment?.label === "neutral");
  const scored = analyzedArticles.filter((a) => a.sentiment != null);
  const averageScore = scored.length > 0
    ? scored.reduce((s, a) => s + (a.sentiment?.score ?? 0), 0) / scored.length
    : 0;
  const overallSentiment = averageScore > 0.15 ? "bullish" : averageScore < -0.15 ? "bearish" : "neutral";
  const confidence = Math.min(1, Math.abs(averageScore) + (scored.length / Math.max(1, articles.length)) * 0.3);

  // High-impact articles.
  const highImpact = analyzedArticles
    .filter((a) => a.sentiment?.impact === "high")
    .sort((a, b) => Math.abs(b.sentiment?.score ?? 0) - Math.abs(a.sentiment?.score ?? 0))
    .slice(0, 5);

  // Key topics aggregation.
  const topicMap = new Map<string, { count: number; sentiments: ("bullish" | "bearish" | "neutral")[] }>();
  for (const a of analyzedArticles) {
    if (!a.sentiment) continue;
    for (const topic of a.sentiment.topics) {
      const existing = topicMap.get(topic) ?? { count: 0, sentiments: [] };
      existing.count++;
      existing.sentiments.push(a.sentiment.label);
      topicMap.set(topic, existing);
    }
  }
  const keyTopics = Array.from(topicMap.entries())
    .map(([topic, data]) => ({
      topic,
      count: data.count,
      sentiment: data.sentiments.filter((s) => s === "bullish").length > data.sentiments.filter((s) => s === "bearish").length
        ? "bullish" as const
        : data.sentiments.filter((s) => s === "bearish").length > data.sentiments.filter((s) => s === "bullish").length
        ? "bearish" as const
        : "neutral" as const,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // AI analysis summary.
  let aiAnalysis: string;
  if (stub) {
    aiAnalysis = generateStubAnalysis(symbol, analyzedArticles, overallSentiment, averageScore, bullish.length, bearish.length, neutral.length, keyTopics);
  } else {
    aiAnalysis = await aiAnalysisSummary(symbol, analyzedArticles, overallSentiment, averageScore);
  }

  return {
    symbol,
    articles: analyzedArticles,
    aggregate: {
      totalArticles: analyzedArticles.length,
      bullishCount: bullish.length,
      bearishCount: bearish.length,
      neutralCount: neutral.length,
      averageScore,
      overallSentiment,
      confidence,
      highImpactArticles: highImpact,
      keyTopics,
    },
    aiAnalysis,
    aiPowered: !stub,
    warnings,
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// AI-powered sentiment analysis
// ---------------------------------------------------------------------------

async function aiBatchSentiment(symbol: string, articles: NewsArticle[]): Promise<NewsArticle[]> {
  const provider = getAIProvider();
  const results: NewsArticle[] = [];

  // Process in batches of 5 to keep prompts manageable.
  for (let i = 0; i < articles.length; i += 5) {
    const batch = articles.slice(i, i + 5);
    const batchText = batch.map((a, idx) => `[${idx}] Headline: ${a.headline}\nSummary: ${a.summary ?? "N/A"}\nSource: ${a.source}`).join("\n\n");

    const systemPrompt = `You are a financial news sentiment analyst. Analyze each news item for ${symbol} stock.

For each article, return a JSON array where each element has:
- "index": the article index
- "label": "bullish", "bearish", or "neutral"
- "confidence": 0-1
- "score": -1 (very bearish) to +1 (very bullish)
- "impact": "high", "medium", or "low" (how much this affects the stock price)
- "topics": array of 1-3 key topics
- "reasoning": one sentence explaining the sentiment
- "optionsImplication": one sentence on how this affects covered call / cash-secured put strategy

Return ONLY the JSON array, no other text.`;

    const messages: AIMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: batchText },
    ];

    try {
      const response = await provider.complete(messages, { portfolio: null, goals: null, symbol });
      const json = extractJsonArray(response.content);
      if (json) {
        for (const item of json) {
          const article = batch[Number(item.index)];
          if (!article) continue;
          const label = String(item.label ?? "neutral") as "bullish" | "bearish" | "neutral";
          const impact = String(item.impact ?? "medium") as "high" | "medium" | "low";
          results.push({
            ...article,
            sentiment: {
              label,
              confidence: Number(item.confidence ?? 0.5),
              score: Number(item.score ?? 0),
              impact,
              topics: Array.isArray(item.topics) ? item.topics.slice(0, 3).map(String) : [],
              reasoning: String(item.reasoning ?? ""),
              optionsImplication: String(item.optionsImplication ?? ""),
            },
          });
        }
      } else {
        // Fallback to keyword sentiment for this batch.
        for (const article of batch) {
          results.push({ ...article, sentiment: keywordSentiment(article.headline + " " + (article.summary ?? "")) });
        }
      }
    } catch {
      // Fallback to keyword sentiment.
      for (const article of batch) {
        results.push({ ...article, sentiment: keywordSentiment(article.headline + " " + (article.summary ?? "")) });
      }
    }
  }

  return results;
}

async function aiAnalysisSummary(
  symbol: string,
  articles: NewsArticle[],
  overall: string,
  avgScore: number,
): Promise<string> {
  const provider = getAIProvider();
  const bullish = articles.filter((a) => a.sentiment?.label === "bullish");
  const bearish = articles.filter((a) => a.sentiment?.label === "bearish");

  const systemPrompt = `You are a senior financial analyst. Summarize the news sentiment for ${symbol}.

Based on the analyzed articles, provide:
1. **News Summary** — what are the main themes in recent news?
2. **Sentiment Assessment** — overall ${overall} (score: ${avgScore.toFixed(2)}). What's driving it?
3. **Price Impact Assessment** — how likely is this news to move the stock in the next 1-2 weeks?
4. **Options Strategy Impact** — how should this news affect covered call and cash-secured put decisions?
5. **Key Risks** — what news developments could change the outlook?

Be concise. Ground every statement in the provided article data. Do NOT predict prices.`;

  const articleSummaries = articles
    .filter((a) => a.sentiment)
    .slice(0, 10)
    .map((a) => `[${a.sentiment!.label.toUpperCase()} | impact: ${a.sentiment!.impact}] ${a.headline} — ${a.sentiment!.reasoning}`)
    .join("\n");

  const messages: AIMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Analyzed ${articles.length} articles for ${symbol}:\n\n${articleSummaries}\n\nBullish: ${bullish.length}, Bearish: ${bearish.length}, Overall: ${overall}` },
  ];

  try {
    const response = await provider.complete(messages, { portfolio: null, goals: null, symbol });
    return response.content;
  } catch {
    return generateStubAnalysis(symbol, articles, overall, avgScore, bullish.length, bearish.length, articles.length - bullish.length - bearish.length, []);
  }
}

// ---------------------------------------------------------------------------
// Keyword-based fallback sentiment
// ---------------------------------------------------------------------------

function keywordSentiment(text: string): NewsSentiment {
  const lower = text.toLowerCase();
  let bullishCount = 0;
  let bearishCount = 0;

  for (const kw of BULLISH_KEYWORDS) {
    if (lower.includes(kw)) bullishCount++;
  }
  for (const kw of BEARISH_KEYWORDS) {
    if (lower.includes(kw)) bearishCount++;
  }

  const total = bullishCount + bearishCount;
  const score = total === 0 ? 0 : (bullishCount - bearishCount) / total;
  const label = score > 0.15 ? "bullish" : score < -0.15 ? "bearish" : "neutral";
  const confidence = Math.min(1, total / 5);
  const impact = total > 5 ? "high" : total > 2 ? "medium" : "low";

  // Extract topics from keywords found.
  const topics: string[] = [];
  if (lower.includes("earnings")) topics.push("earnings");
  if (lower.includes("dividend")) topics.push("dividend");
  if (lower.includes("fda") || lower.includes("approval")) topics.push("regulatory");
  if (lower.includes("merger") || lower.includes("acquisition") || lower.includes("deal")) topics.push("M&A");
  if (lower.includes("lawsuit") || lower.includes("sued")) topics.push("legal");
  if (lower.includes("upgrade") || lower.includes("downgrade")) topics.push("analyst rating");
  if (lower.includes("launch") || lower.includes("product")) topics.push("product");
  if (lower.includes("guidance") || lower.includes("forecast")) topics.push("guidance");

  return {
    label,
    confidence,
    score,
    impact,
    topics,
    reasoning: `Keyword analysis: ${bullishCount} bullish, ${bearishCount} bearish keywords detected.`,
    optionsImplication: label === "bullish"
      ? "Positive news may support the stock — covered calls can be sold at higher strikes with less assignment risk."
      : label === "bearish"
      ? "Negative news may pressure the stock — consider protective puts or lower-strike covered calls."
      : "Neutral news — proceed with normal strategy based on technicals and fundamentals.",
  };
}

function generateStubAnalysis(
  symbol: string,
  articles: NewsArticle[],
  overall: string,
  avgScore: number,
  bullishCount: number,
  bearishCount: number,
  neutralCount: number,
  keyTopics: { topic: string; count: number; sentiment: string }[],
): string {
  const lines: string[] = [];
  lines.push(`## News Summary — ${symbol}`);
  lines.push("");
  lines.push(`Analyzed ${articles.length} recent articles. Overall sentiment: **${overall.toUpperCase()}** (score: ${avgScore.toFixed(2)}).`);
  lines.push("");
  lines.push(`**Sentiment breakdown:** ${bullishCount} bullish, ${bearishCount} bearish, ${neutralCount} neutral.`);
  lines.push("");

  if (keyTopics.length > 0) {
    lines.push(`**Key topics:**`);
    for (const t of keyTopics.slice(0, 5)) {
      lines.push(`- ${t.topic} (${t.count} articles, ${t.sentiment})`);
    }
    lines.push("");
  }

  lines.push(`## Sentiment Assessment`);
  lines.push("");
  if (overall === "bullish") {
    lines.push(`The news flow is predominantly positive with ${bullishCount} bullish articles vs ${bearishCount} bearish. The average sentiment score of ${avgScore.toFixed(2)} suggests the market narrative is favorable.`);
  } else if (overall === "bearish") {
    lines.push(`The news flow is predominantly negative with ${bearishCount} bearish articles vs ${bullishCount} bullish. The average sentiment score of ${avgScore.toFixed(2)} suggests caution.`);
  } else {
    lines.push(`The news flow is mixed with no clear directional bias. ${bullishCount} bullish, ${bearishCount} bearish, and ${neutralCount} neutral articles.`);
  }
  lines.push("");

  lines.push(`## Price Impact Assessment`);
  lines.push("");
  const highImpact = articles.filter((a) => a.sentiment?.impact === "high");
  if (highImpact.length > 0) {
    lines.push(`${highImpact.length} high-impact articles detected. These could move the stock in the near term:`);
    for (const a of highImpact.slice(0, 3)) {
      lines.push(`- [${a.sentiment!.label.toUpperCase()}] ${a.headline}`);
    }
  } else {
    lines.push(`No high-impact articles detected. News is unlikely to cause significant short-term price movement.`);
  }
  lines.push("");

  lines.push(`## Options Strategy Impact`);
  lines.push("");
  if (overall === "bullish") {
    lines.push(`- **Covered calls:** Positive sentiment supports the stock. You can sell slightly OTM calls with confidence — assignment risk is lower when news is favorable.`);
    lines.push(`- **Cash-secured puts:** Consider selling puts at current or slightly OTM strikes. Positive news reduces assignment probability.`);
  } else if (overall === "bearish") {
    lines.push(`- **Covered calls:** Consider ATM or slightly ITM calls for more downside protection. Negative news increases assignment risk.`);
    lines.push(`- **Cash-secured puts:** Sell puts at lower strikes for more cushion. Be prepared for assignment if the news worsens.`);
  } else {
    lines.push(`- **Covered calls:** Neutral news means normal strategy. Sell at your preferred OTM distance based on technicals.`);
    lines.push(`- **Cash-secured puts:** Normal strategy. Target entry at your desired discount.`);
  }
  lines.push("");

  lines.push(`## Key Risks`);
  lines.push("");
  lines.push(`- News sentiment can change rapidly — monitor for new developments.`);
  lines.push(`- High-impact articles may not yet be priced in by the market.`);
  lines.push(`- Keyword-based analysis may miss nuance — add an AI API key for deeper analysis.`);
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractSource(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace("www.", "").replace("m.", "");
  } catch {
    return "unknown";
  }
}

function extractJsonArray(text: string): Array<Record<string, unknown>> | null {
  // Find JSON array in the response.
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Array<Record<string, unknown>>;
  } catch {
    return null;
  }
}
