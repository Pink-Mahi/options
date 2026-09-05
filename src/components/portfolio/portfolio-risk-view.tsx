"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn, formatCurrency, formatPercent, formatNumber } from "@/lib/utils";

interface PortfolioRiskResponse {
  totalMarketValue: number;
  netDelta: number;
  betaWeightedDelta: number;
  spyEquivalentExposure: number;
  directionalBias: "bullish" | "bearish" | "neutral";
  concentration: {
    riskLevel: "diversified" | "moderate" | "concentrated" | "highly_concentrated";
    largestPosition: number;
    top3: number;
    herfindahlIndex: number;
    warnings: string[];
  };
  positions: {
    symbol: string;
    marketValue: number;
    percentOfPortfolio: number;
    betaWeightedDelta: number;
  }[];
  warnings: string[];
}

const riskLevelVariant: Record<string, "secondary" | "warning" | "loss"> = {
  diversified: "secondary",
  moderate: "warning",
  concentrated: "loss",
  highly_concentrated: "loss",
};

const riskLevelLabel: Record<string, string> = {
  diversified: "Diversified",
  moderate: "Moderate",
  concentrated: "Concentrated",
  highly_concentrated: "Highly Concentrated",
};

export function PortfolioRiskView() {
  const [data, setData] = useState<PortfolioRiskResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/portfolio/risk", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<PortfolioRiskResponse>;
      })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground">Calculating portfolio risk…</p>;
  if (error) return <p className="text-sm text-loss">{error}</p>;
  if (!data) return null;

  const biasIcon = data.directionalBias === "bullish" ? TrendingUp : data.directionalBias === "bearish" ? TrendingDown : Minus;
  const BiasIcon = biasIcon;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-3">
            <div className="text-xs uppercase text-muted-foreground">Total market value</div>
            <div className="text-xl font-bold tabular">{formatCurrency(data.totalMarketValue, 0)}</div>
            <div className="text-xs text-muted-foreground">{data.positions.length} holding{data.positions.length === 1 ? "" : "s"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs uppercase text-muted-foreground">Beta-weighted delta</div>
            <div className={cn("text-xl font-bold tabular", data.betaWeightedDelta < 0 ? "text-loss" : "text-profit")}>
              {formatNumber(data.betaWeightedDelta, 0)}
            </div>
            <div className="text-xs text-muted-foreground">SPY-equivalent shares</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs uppercase text-muted-foreground">SPY-equivalent exposure</div>
            <div className="text-xl font-bold tabular">{formatCurrency(data.spyEquivalentExposure, 0)}</div>
            <div className="text-xs text-muted-foreground">dollar directional risk</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs uppercase text-muted-foreground">Directional bias</div>
            <div className="flex items-center gap-1.5">
              <BiasIcon className={cn("h-5 w-5", data.directionalBias === "bullish" ? "text-profit" : data.directionalBias === "bearish" ? "text-loss" : "text-muted-foreground")} />
              <span className="text-lg font-bold capitalize">{data.directionalBias}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Concentration risk */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Concentration risk</CardTitle>
          <CardDescription>How exposed the portfolio is to single positions or a few holdings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="text-xs uppercase text-muted-foreground">Risk level</div>
              <Badge variant={riskLevelVariant[data.concentration.riskLevel] ?? "secondary"} className="mt-1">
                {riskLevelLabel[data.concentration.riskLevel] ?? data.concentration.riskLevel}
              </Badge>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">Largest position</div>
              <div className="text-lg font-bold tabular">{data.concentration.largestPosition}%</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">Top 3 concentration</div>
              <div className="text-lg font-bold tabular">{data.concentration.top3}%</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">Herfindahl index</div>
              <div className="text-lg font-bold tabular">{data.concentration.herfindahlIndex.toFixed(4)}</div>
              <div className="text-xs text-muted-foreground">0 = diversified, 1 = single position</div>
            </div>
          </div>

          {/* Concentration bar chart */}
          {data.positions.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-medium">Position weights</div>
              <div className="flex h-6 w-full overflow-hidden rounded-md">
                {data.positions.map((p, i) => {
                  const colors = [
                    "bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-purple-500",
                    "bg-pink-500", "bg-cyan-500", "bg-orange-500", "bg-indigo-500",
                  ];
                  return (
                    <div
                      key={p.symbol}
                      className={cn("flex items-center justify-center text-[10px] font-medium text-white", colors[i % colors.length])}
                      style={{ width: `${p.percentOfPortfolio}%` }}
                      title={`${p.symbol}: ${p.percentOfPortfolio}%`}
                    >
                      {p.percentOfPortfolio >= 5 ? p.symbol : ""}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {data.concentration.warnings.length > 0 && (
            <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
              {data.concentration.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}</div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-position breakdown */}
      {data.positions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Beta-weighted delta by position</CardTitle>
            <CardDescription>Each holding&apos;s contribution to portfolio directional risk.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Market value</TableHead>
                  <TableHead>% of portfolio</TableHead>
                  <TableHead>Beta-weighted delta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.positions.map((p) => (
                  <TableRow key={p.symbol}>
                    <TableCell className="font-medium">{p.symbol}</TableCell>
                    <TableCell className="tabular">{formatCurrency(p.marketValue, 0)}</TableCell>
                    <TableCell className="tabular">{p.percentOfPortfolio}%</TableCell>
                    <TableCell className={cn("tabular", p.betaWeightedDelta < 0 ? "text-loss" : "text-profit")}>
                      {formatNumber(p.betaWeightedDelta, 0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {data.warnings.length > 0 && (
        <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
          {data.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}</div>
          ))}
        </div>
      )}
    </div>
  );
}
