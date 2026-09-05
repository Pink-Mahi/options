"use client";

import { useEffect, useState } from "react";
import { Calendar, TrendingUp, TrendingDown, AlertTriangle, Zap, Target } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine, Cell } from "recharts";
import type { StockData } from "@/features/options/stock-data";
import type { EarningsAnalysis } from "@/lib/types";

export function EarningsTab({ data }: { data: StockData }) {
  const [analysis, setAnalysis] = useState<EarningsAnalysis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/stock/${encodeURIComponent(data.symbol)}/earnings`, { cache: "no-store" })
      .then((r) => r.json())
      .then((b: EarningsAnalysis) => !cancelled && setAnalysis(b))
      .catch(() => !cancelled && setAnalysis(null))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [data.symbol]);

  if (loading) return <p className="text-sm text-muted-foreground">Analyzing earnings history…</p>;
  if (!analysis) return <p className="text-sm text-loss">Failed to load earnings analysis.</p>;

  const next = analysis.nextEarnings;
  const stats = analysis.statistics;

  return (
    <div className="space-y-4">
      {/* Next earnings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-4 w-4" /> Next earnings — {data.symbol}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {next.date ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-bold">{next.date}</span>
                {next.daysUntil != null && (
                  <Badge variant={next.daysUntil <= 7 ? "loss" : next.daysUntil <= 30 ? "warning" : "outline"}>
                    {next.daysUntil} days away
                  </Badge>
                )}
                {next.timing && next.timing !== "unspecified" && (
                  <Badge variant="outline">{next.timing === "pre" ? "Pre-market" : "Post-market"}</Badge>
                )}
                {next.confirmed && <Badge variant="profit">Confirmed</Badge>}
              </div>
              {next.daysUntil != null && next.daysUntil <= 7 && (
                <div className="flex items-start gap-1 text-sm text-loss">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  Earnings imminent — elevated assignment risk for calls expiring after this date.
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No upcoming earnings date identified.</p>
          )}
        </CardContent>
      </Card>

      {/* Historical reactions chart */}
      {analysis.historicalReactions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Historical earnings reactions</CardTitle>
            <CardDescription>Stock move from close before earnings to close after</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={analysis.historicalReactions.map((r) => ({ date: r.date, move: (r.priceMovePercent ?? 0) * 100 }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" fontSize={10} stroke="hsl(var(--muted-foreground))" />
                <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" unit="%" />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
                  formatter={(v: number) => [`${v.toFixed(2)}%`, "Move"]}
                />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                <Bar dataKey="move" radius={[3, 3, 0, 0]}>
                  {analysis.historicalReactions.map((r, i) => (
                    <Cell key={i} fill={(r.priceMovePercent ?? 0) >= 0 ? "hsl(var(--profit))" : "hsl(var(--loss))"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Statistics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Avg |Move|"
          value={stats.avgMovePercent != null ? formatPercent(stats.avgMovePercent, 1) : "—"}
          detail={`${stats.sampleSize} samples`}
        />
        <StatCard
          label="Median |Move|"
          value={stats.medianMovePercent != null ? formatPercent(stats.medianMovePercent, 1) : "—"}
          detail="Middle value"
        />
        <StatCard
          label="Max Up"
          value={stats.maxUpMove != null ? `+${formatPercent(stats.maxUpMove, 1)}` : "—"}
          detail="Best earnings"
          tone="profit"
        />
        <StatCard
          label="Max Down"
          value={stats.maxDownMove != null ? formatPercent(stats.maxDownMove, 1) : "—"}
          detail="Worst earnings"
          tone="loss"
        />
      </div>

      {stats.upMoveFrequency != null && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm">Stock went UP after earnings:</span>
              <span className="font-bold">{formatPercent(stats.upMoveFrequency, 0)} of the time</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Expected move */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4" /> Expected move for next earnings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Based on avg history" value={analysis.expectedMove.basedOnAvg != null ? `±${formatPercent(analysis.expectedMove.basedOnAvg, 1)}` : "—"} detail="Mean of past moves" />
            <StatCard label="Based on median" value={analysis.expectedMove.basedOnMedian != null ? `±${formatPercent(analysis.expectedMove.basedOnMedian, 1)}` : "—"} detail="Median of past moves" />
            <StatCard label="Based on ATM IV" value={analysis.expectedMove.basedOnAtmIv != null ? `±${formatPercent(analysis.expectedMove.basedOnAtmIv, 1)}` : "—"} detail="Options-implied 1σ" />
          </div>
          <p className="text-xs text-muted-foreground">{analysis.expectedMove.note}</p>
        </CardContent>
      </Card>

      {/* IV crush */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4" /> IV crush estimate
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {analysis.ivCrush.typicalPostEarningsIvDropPercent != null ? (
            <p className="text-sm">
              Typical IV drop after earnings: <span className="font-bold text-loss">~{formatPercent(analysis.ivCrush.typicalPostEarningsIvDropPercent, 0)}</span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">IV data not available.</p>
          )}
          <p className="text-xs text-muted-foreground">{analysis.ivCrush.note}</p>
        </CardContent>
      </Card>

      {/* Strategy implications */}
      <Card>
        <CardHeader><CardTitle className="text-base">Strategy implications</CardTitle></CardHeader>
        <CardContent>
          <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap rounded-md border bg-muted/30 p-4 text-sm leading-relaxed">
            {analysis.strategyImplications}
          </div>
        </CardContent>
      </Card>

      {/* Warnings */}
      {analysis.warnings.map((w, i) => (
        <div key={i} className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: "profit" | "loss" }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-lg font-bold tabular", tone === "profit" && "text-profit", tone === "loss" && "text-loss")}>{value}</div>
      {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
    </div>
  );
}
