import { NextResponse } from "next/server";
import { fetchNews, analyzeNewsSentiment } from "@/features/news/sentiment-service";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase().trim();
  try {
    const articles = await fetchNews(symbol);
    if (articles.length === 0) {
      return NextResponse.json({
        symbol,
        articles: [],
        aggregate: {
          totalArticles: 0,
          bullishCount: 0,
          bearishCount: 0,
          neutralCount: 0,
          averageScore: 0,
          overallSentiment: "neutral",
          confidence: 0,
          highImpactArticles: [],
          keyTopics: [],
        },
        aiAnalysis: "No news articles found. Configure NEWS_API_KEY or ALPHA_VANTAGE_API_KEY to fetch news.",
        aiPowered: false,
        warnings: ["No news API configured. Add NEWS_API_KEY (from newsapi.org) or ALPHA_VANTAGE_API_KEY to fetch real news."],
        fetchedAt: new Date().toISOString(),
      });
    }
    const report = await analyzeNewsSentiment(symbol, articles);
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
