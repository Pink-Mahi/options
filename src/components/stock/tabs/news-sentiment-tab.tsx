"use client";

import { useEffect, useState } from "react";
import { Newspaper, TrendingUp, TrendingDown, Minus, AlertTriangle, ExternalLink, Brain } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatNumber } from "@/lib/utils";
import type { StockData } from "@/features/options/stock-data";
import type { NewsSentimentReport, NewsArticle } from "@/lib/types";

export function NewsSentimentTab({ data }: { data: StockData }) {
  const [report, setReport] = useState<NewsSentimentReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/stock/${encodeURIComponent(data.symbol)}/news`, { cache: "no-store" })
      .then((r) => r.json())
      .then((b: NewsSentimentReport) => !cancelled && setReport(b))
      .catch(() => !cancelled && setReport(null))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [data.symbol]);

  if (loading) return <p className="text-sm text-muted-foreground">Fetching news &amp; analyzing sentiment…</p>;
  if (!report) return <p className="text-sm text-loss">Failed to load news.</p>;

  const agg = report.aggregate;
  const sentimentColor = agg.overallSentiment === "bullish" ? "text-profit" : agg.overallSentiment === "bearish" ? "text-loss" : "text-muted-foreground";
  const SentimentIcon = agg.overallSentiment === "bullish" ? TrendingUp : agg.overallSentiment === "bearish" ? TrendingDown : Minus;

  return (
    <div className="space-y-4">
      {/* Aggregate sentiment */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Newspaper className="h-4 w-4" /> News sentiment — {data.symbol}
          </CardTitle>
          <CardDescription>
            {agg.totalArticles} articles analyzed · {report.aiPowered ? "AI-powered" : "Keyword-based (no AI key)"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <SentimentIcon className={cn("h-8 w-8", sentimentColor)} />
            <div>
              <div className={cn("text-2xl font-bold", sentimentColor)}>
                {agg.overallSentiment.toUpperCase()}
              </div>
              <div className="text-xs text-muted-foreground">
                Score: {formatNumber(agg.averageScore, 2)} · Confidence: {formatNumber(agg.confidence, 2)}
              </div>
            </div>
          </div>

          {/* Sentiment distribution bar */}
          {agg.totalArticles > 0 && (
            <div>
              <div className="flex h-6 w-full overflow-hidden rounded-md">
                <div className="bg-profit" style={{ width: `${(agg.bullishCount / agg.totalArticles) * 100}%` }} title={`${agg.bullishCount} bullish`} />
                <div className="bg-muted-foreground/30" style={{ width: `${(agg.neutralCount / agg.totalArticles) * 100}%` }} title={`${agg.neutralCount} neutral`} />
                <div className="bg-loss" style={{ width: `${(agg.bearishCount / agg.totalArticles) * 100}%` }} title={`${agg.bearishCount} bearish`} />
              </div>
              <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                <span className="text-profit">{agg.bullishCount} bullish</span>
                <span>{agg.neutralCount} neutral</span>
                <span className="text-loss">{agg.bearishCount} bearish</span>
              </div>
            </div>
          )}

          {/* Key topics */}
          {agg.keyTopics.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground">Key topics</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {agg.keyTopics.map((t, i) => (
                  <Badge
                    key={i}
                    variant={t.sentiment === "bullish" ? "profit" : t.sentiment === "bearish" ? "loss" : "secondary"}
                  >
                    {t.topic} ({t.count})
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {report.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* AI Analysis */}
      {report.aiAnalysis && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Brain className="h-4 w-4" /> AI analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap rounded-md border bg-muted/30 p-4 text-sm leading-relaxed">
              {report.aiAnalysis}
            </div>
          </CardContent>
        </Card>
      )}

      {/* High-impact articles */}
      {agg.highImpactArticles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">High-impact articles</CardTitle>
            <CardDescription>Articles most likely to move the stock price</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {agg.highImpactArticles.map((a) => <ArticleRow key={a.id} article={a} />)}
          </CardContent>
        </Card>
      )}

      {/* All articles */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All articles ({report.articles.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {report.articles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No articles found.</p>
          ) : (
            report.articles.map((a) => <ArticleRow key={a.id} article={a} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ArticleRow({ article }: { article: NewsArticle }) {
  const s = article.sentiment;
  const color = s?.label === "bullish" ? "text-profit" : s?.label === "bearish" ? "text-loss" : "text-muted-foreground";
  const Icon = s?.label === "bullish" ? TrendingUp : s?.label === "bearish" ? TrendingDown : Minus;

  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-md border p-3 transition-colors hover:bg-muted/50"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            {s && <Icon className={cn("h-4 w-4 shrink-0", color)} />}
            <span className="text-sm font-medium leading-tight">{article.headline}</span>
          </div>
          {article.summary && <p className="text-xs text-muted-foreground line-clamp-2">{article.summary}</p>}
          {s && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <Badge variant={s.label === "bullish" ? "profit" : s.label === "bearish" ? "loss" : "secondary"} className="text-xs">
                {s.label}
              </Badge>
              <Badge variant="outline" className="text-xs">impact: {s.impact}</Badge>
              <span className="text-muted-foreground">score: {formatNumber(s.score, 2)}</span>
              {s.topics.length > 0 && (
                <span className="text-muted-foreground">· {s.topics.join(", ")}</span>
              )}
            </div>
          )}
          {s?.optionsImplication && (
            <p className="text-xs italic text-muted-foreground">{s.optionsImplication}</p>
          )}
        </div>
        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{article.source}</div>
    </a>
  );
}
