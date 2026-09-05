"use client";

import { useEffect, useState } from "react";
import { Users, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import type { StockData } from "@/features/options/stock-data";
import type { PeerComparison, PeerMetrics } from "@/lib/types";

export function PeersTab({ data }: { data: StockData }) {
  const [comparison, setComparison] = useState<PeerComparison | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/stock/${encodeURIComponent(data.symbol)}/peers`, { cache: "no-store" })
      .then((r) => r.json())
      .then((b: PeerComparison) => !cancelled && setComparison(b))
      .catch(() => !cancelled && setComparison(null))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [data.symbol]);

  if (loading) return <p className="text-sm text-muted-foreground">Comparing against sector peers…</p>;
  if (!comparison) return <p className="text-sm text-loss">Failed to load peer comparison.</p>;

  const { targetMetrics, peers, spyBenchmark, rankings, analysis, warnings } = comparison;

  return (
    <div className="space-y-4">
      {/* Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" /> Sector &amp; peer comparison — {data.symbol}
          </CardTitle>
          <CardDescription>
            {comparison.sector ? `${comparison.sector} · ${comparison.industry}` : "Sector unknown"}
            {" · "}{peers.length} peers{spyBenchmark ? " + SPY benchmark" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Rankings */}
          {rankings.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Rankings</div>
              {rankings.map((r, i) => {
                const percentile = ((r.totalPeers - r.targetRank + 1) / r.totalPeers) * 100;
                const tone = percentile >= 67 ? "text-profit" : percentile <= 33 ? "text-loss" : "text-muted-foreground";
                return (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span>{r.metric}</span>
                    <span className={cn("font-bold tabular", tone)}>
                      #{r.targetRank}/{r.totalPeers} ({percentile.toFixed(0)}%) — {r.targetValue}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {warnings.map((w, i) => (
            <div key={i} className="text-xs text-amber-600 dark:text-amber-400">{w}</div>
          ))}
        </CardContent>
      </Card>

      {/* Comparison table */}
      <Card>
        <CardHeader><CardTitle className="text-base">Metrics comparison</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="pb-2 pr-3">Symbol</th>
                  <th className="pb-2 pr-3 text-right">Price</th>
                  <th className="pb-2 pr-3 text-right">1Y Return</th>
                  <th className="pb-2 pr-3 text-right">YTD</th>
                  <th className="pb-2 pr-3 text-right">Volatility</th>
                  <th className="pb-2 pr-3 text-right">IV</th>
                </tr>
              </thead>
              <tbody>
                <PeerRow metrics={targetMetrics} isTarget />
                {peers.map((p) => <PeerRow key={p.symbol} metrics={p} />)}
                {spyBenchmark && <PeerRow metrics={spyBenchmark} isBenchmark />}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Analysis */}
      {analysis && (
        <Card>
          <CardHeader><CardTitle className="text-base">Analysis</CardTitle></CardHeader>
          <CardContent>
            <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap rounded-md border bg-muted/30 p-4 text-sm leading-relaxed">
              {analysis}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PeerRow({ metrics, isTarget, isBenchmark }: { metrics: PeerMetrics; isTarget?: boolean; isBenchmark?: boolean }) {
  return (
    <tr className={cn("border-b", isTarget && "bg-primary/5 font-medium", isBenchmark && "bg-muted/30")}>
      <td className="py-2 pr-3">
        {metrics.symbol}
        {isTarget && <Badge variant="profit" className="ml-1 text-xs">Target</Badge>}
        {isBenchmark && <Badge variant="secondary" className="ml-1 text-xs">SPY</Badge>}
      </td>
      <td className="py-2 pr-3 text-right tabular">{formatCurrency(metrics.price)}</td>
      <td className="py-2 pr-3 text-right tabular">
        <ReturnCell value={metrics.oneYearReturn} />
      </td>
      <td className="py-2 pr-3 text-right tabular">
        <ReturnCell value={metrics.yearToDateReturn} />
      </td>
      <td className="py-2 pr-3 text-right tabular text-muted-foreground">
        {metrics.volatility != null ? formatPercent(metrics.volatility, 1) : "—"}
      </td>
      <td className="py-2 pr-3 text-right tabular text-muted-foreground">
        {metrics.impliedVolatility != null ? formatPercent(metrics.impliedVolatility, 1) : "—"}
      </td>
    </tr>
  );
}

function ReturnCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const positive = value >= 0;
  const Icon = positive ? ArrowUp : ArrowDown;
  return (
    <span className={positive ? "text-profit" : "text-loss"}>
      <Icon className="inline h-3 w-3" /> {formatPercent(Math.abs(value), 1)}
    </span>
  );
}
