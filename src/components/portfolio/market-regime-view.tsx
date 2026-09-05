"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, TrendingUp, TrendingDown, Minus, Activity, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface RegimeSnapshot {
  regime: string;
  description: string;
  riskLevel: "low" | "moderate" | "elevated" | "high" | "extreme";
  vix: number;
  vixSource: "provider" | "estimated_from_spy_realized_vol";
  spyTrend: "up" | "down" | "flat";
  spyAbove200sma: boolean;
  realizedVol30: number;
  strategyImplications: string[];
  warnings: string[];
}

const regimeColors: Record<string, string> = {
  LOW_VOL_BULL: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  HIGH_VOL_BULL: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  LOW_VOL_SIDEWAYS: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
  HIGH_VOL_SIDEWAYS: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  LOW_VOL_BEAR: "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30",
  HIGH_VOL_BEAR: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30",
  CRISIS: "bg-red-600/10 text-red-700 dark:text-red-300 border-red-600/40",
};

const regimeLabels: Record<string, string> = {
  LOW_VOL_BULL: "Low-Vol Bull",
  HIGH_VOL_BULL: "High-Vol Bull",
  LOW_VOL_SIDEWAYS: "Low-Vol Sideways",
  HIGH_VOL_SIDEWAYS: "High-Vol Sideways",
  LOW_VOL_BEAR: "Low-Vol Bear",
  HIGH_VOL_BEAR: "High-Vol Bear",
  CRISIS: "Crisis",
};

const riskLevelVariant: Record<string, "secondary" | "warning" | "loss"> = {
  low: "secondary",
  moderate: "secondary",
  elevated: "warning",
  high: "loss",
  extreme: "loss",
};

const riskLevelLabel: Record<string, string> = {
  low: "Low",
  moderate: "Moderate",
  elevated: "Elevated",
  high: "High",
  extreme: "Extreme",
};

// All 7 regimes for the surface grid
const allRegimes = [
  { key: "LOW_VOL_BULL", vol: "Low (VIX < 15)", trend: "Above 200-SMA" },
  { key: "HIGH_VOL_BULL", vol: "High (VIX >= 15)", trend: "Above 200-SMA" },
  { key: "LOW_VOL_SIDEWAYS", vol: "Low (VIX < 15)", trend: "Near 200-SMA" },
  { key: "HIGH_VOL_SIDEWAYS", vol: "High (VIX >= 15)", trend: "Near 200-SMA" },
  { key: "LOW_VOL_BEAR", vol: "Low (VIX < 15)", trend: "Below 200-SMA" },
  { key: "HIGH_VOL_BEAR", vol: "High (VIX >= 15)", trend: "Below 200-SMA" },
  { key: "CRISIS", vol: "VIX > 30", trend: "Any" },
];

export function MarketRegimeView() {
  const [data, setData] = useState<RegimeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/market-regime", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<RegimeSnapshot>;
      })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground">Classifying market regime…</p>;
  if (error) return <p className="text-sm text-loss">{error}</p>;
  if (!data) return null;

  const TrendIcon = data.spyTrend === "up" ? TrendingUp : data.spyTrend === "down" ? TrendingDown : Minus;

  return (
    <div className="space-y-4">
      {/* Current regime card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current market regime</CardTitle>
          <CardDescription>Classified from VIX level and SPY 200-day SMA trend.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className={cn("rounded-lg border px-4 py-2", regimeColors[data.regime] ?? "bg-secondary")}>
              <div className="text-lg font-bold">{regimeLabels[data.regime] ?? data.regime}</div>
            </div>
            <Badge variant={riskLevelVariant[data.riskLevel] ?? "secondary"}>
              {riskLevelLabel[data.riskLevel] ?? data.riskLevel} risk
            </Badge>
            {data.regime === "CRISIS" && (
              <Badge variant="loss" className="gap-1">
                <ShieldAlert className="h-3 w-3" /> Crisis
              </Badge>
            )}
          </div>

          <p className="text-sm text-muted-foreground">{data.description}</p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="text-xs uppercase text-muted-foreground">VIX</div>
              <div className="flex items-center gap-1.5">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span className="text-lg font-bold tabular">{data.vix.toFixed(2)}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {data.vixSource === "provider" ? "from provider" : "est. from SPY realized vol"}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">SPY trend</div>
              <div className="flex items-center gap-1.5">
                <TrendIcon className={cn("h-4 w-4", data.spyTrend === "up" ? "text-profit" : data.spyTrend === "down" ? "text-loss" : "text-muted-foreground")} />
                <span className="text-lg font-bold capitalize">{data.spyTrend}</span>
              </div>
              <div className="text-xs text-muted-foreground">{data.spyAbove200sma ? "above" : "below"} 200-SMA</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">30-day realized vol</div>
              <div className="text-lg font-bold tabular">{data.realizedVol30.toFixed(2)}%</div>
              <div className="text-xs text-muted-foreground">annualized, SPY</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">VIX vs realized vol</div>
              <div className="text-lg font-bold tabular">
                {(data.vix - data.realizedVol30).toFixed(2)}
              </div>
              <div className="text-xs text-muted-foreground">implied vol premium</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Strategy implications */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Strategy implications</CardTitle>
          <CardDescription>Options strategy guidance for the current regime.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {data.strategyImplications.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                {s}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Regime surface grid */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Regime surface</CardTitle>
          <CardDescription>All possible regimes. The highlighted cell is the current classification.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {allRegimes.map((r) => {
              const isActive = r.key === data.regime;
              return (
                <div
                  key={r.key}
                  className={cn(
                    "rounded-lg border p-3 transition-colors",
                    isActive
                      ? regimeColors[r.key] ?? "border-primary bg-primary/10"
                      : "border-border bg-card opacity-60",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold">{regimeLabels[r.key] ?? r.key}</span>
                    {isActive && <Badge variant="secondary" className="text-[10px]">current</Badge>}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    <div>{r.vol}</div>
                    <div>{r.trend}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

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
