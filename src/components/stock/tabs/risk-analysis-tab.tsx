"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, Input, Label, Select } from "@/components/ui";
import { cn, formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import type { StockData } from "@/features/options/stock-data";

interface RollingProjectionResponse {
  periodsAnalyzed: number;
  periodsPerYear: number;
  assignmentRate: number;
  avgPeriodReturn: number;
  projectedAnnualPremiumIncome: number;
  projectedAnnualTotalReturn: number;
  projectedAnnualUncappedReturn: number;
  incomeCaptureEfficiency: number;
  distribution: { p10: number; p25: number; p50: number; p75: number; p90: number };
  warnings: string[];
}

interface RiskAdjustedResponse {
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  calmarRatio: number | null;
  annualizedReturn: number;
  annualizedVolatility: number;
  downsideDeviation: number | null;
  maxDrawdown: number;
  riskFreeRate: number;
  warnings: string[];
}

interface IVAnalyticsResponse {
  currentAtmIv: number | null;
  ivPercentile: number | null;
  ivRank: number | null;
  expectedMove: {
    oneStdDev: number;
    oneStdDevPercent: number;
    upper1sd: number;
    lower1sd: number;
    dte: number;
    note: string;
  } | null;
  warnings: string[];
}

interface MonteCarloResponse {
  paths: number;
  horizonDays: number;
  buyAndHold: { meanFinalValue: number; medianFinalValue: number; p5: number; p25: number; p75: number; p95: number; meanReturn: number; probPositive: number };
  coveredCall: { meanFinalValue: number; medianFinalValue: number; p5: number; p25: number; p75: number; p95: number; meanReturn: number; probPositive: number; meanPremiumIncome: number; meanTimesAssigned: number };
  comparison: { meanExcessReturn: number; probCCBeatsBH: number; note: string };
  warnings: string[];
}

export function RiskAnalysisTab({ data }: { data: StockData }) {
  const [iv, setIv] = useState<IVAnalyticsResponse | null>(null);
  const [ivLoading, setIvLoading] = useState(true);
  const [mc, setMc] = useState<MonteCarloResponse | null>(null);
  const [mcLoading, setMcLoading] = useState(false);
  const [rolling, setRolling] = useState<RollingProjectionResponse | null>(null);
  const [rollLoading, setRollLoading] = useState(false);
  const [riskAdj, setRiskAdj] = useState<RiskAdjustedResponse | null>(null);
  const [riskAdjLoading, setRiskAdjLoading] = useState(true);

  const [paths, setPaths] = useState(500);
  const [horizon, setHorizon] = useState(252);
  const [periodDte, setPeriodDte] = useState(30);
  const [otmPct, setOtmPct] = useState(0.05);
  const [premYield, setPremYield] = useState(0.01);
  const [rollOtmPct, setRollOtmPct] = useState(0.05);
  const [rollPremYield, setRollPremYield] = useState(0.01);
  const [rollDte, setRollDte] = useState(30);

  useEffect(() => {
    let cancelled = false;
    setIvLoading(true);
    setRiskAdjLoading(true);
    fetch(`/api/stock/${encodeURIComponent(data.symbol)}/risk-adjusted`, { cache: "no-store" })
      .then((r) => r.json())
      .then((b: RiskAdjustedResponse) => !cancelled && setRiskAdj(b))
      .catch(() => !cancelled && setRiskAdj(null))
      .finally(() => !cancelled && setRiskAdjLoading(false));
    fetch(`/api/stock/${encodeURIComponent(data.symbol)}/iv`, { cache: "no-store" })
      .then((r) => r.json())
      .then((b: IVAnalyticsResponse) => !cancelled && setIv(b))
      .catch(() => !cancelled && setIv(null))
      .finally(() => !cancelled && setIvLoading(false));
    return () => { cancelled = true; };
  }, [data.symbol]);

  function runMC() {
    setMcLoading(true);
    fetch(`/api/stock/${encodeURIComponent(data.symbol)}/monte-carlo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths, horizonDays: horizon, periodDte, strikeOtmPercent: otmPct, premiumYieldPerPeriod: premYield }),
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((b: MonteCarloResponse) => setMc(b))
      .catch(() => setMc(null))
      .finally(() => setMcLoading(false));
  }

  function runRolling() {
    setRollLoading(true);
    fetch(`/api/stock/${encodeURIComponent(data.symbol)}/rolling-projection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ periodDte: rollDte, strikeOtmPercent: rollOtmPct, premiumYieldPerPeriod: rollPremYield }),
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((b: RollingProjectionResponse) => setRolling(b))
      .catch(() => setRolling(null))
      .finally(() => setRollLoading(false));
  }

  return (
    <div className="space-y-4">
      {/* Risk-adjusted returns */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Risk-adjusted returns</CardTitle>
          <CardDescription>Sharpe, Sortino, and Calmar ratios from 5-year history. Risk-free rate: 4.5% (T-bill approx).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {riskAdjLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {riskAdj && (
            <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-6">
              <Stat label="Sharpe" value={riskAdj.sharpeRatio != null ? formatNumber(riskAdj.sharpeRatio, 2) : "—"} tone={riskAdj.sharpeRatio != null && riskAdj.sharpeRatio > 1 ? "profit" : undefined} />
              <Stat label="Sortino" value={riskAdj.sortinoRatio != null ? formatNumber(riskAdj.sortinoRatio, 2) : "—"} tone={riskAdj.sortinoRatio != null && riskAdj.sortinoRatio > 1 ? "profit" : undefined} />
              <Stat label="Calmar" value={riskAdj.calmarRatio != null ? formatNumber(riskAdj.calmarRatio, 2) : "—"} />
              <Stat label="Ann. return" value={formatPercent(riskAdj.annualizedReturn)} tone={riskAdj.annualizedReturn >= 0 ? "profit" : "loss"} />
              <Stat label="Ann. volatility" value={formatPercent(riskAdj.annualizedVolatility)} />
              <Stat label="Max drawdown" value={formatPercent(riskAdj.maxDrawdown)} tone="loss" />
            </div>
          )}
          {riskAdj?.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}</div>
          ))}
        </CardContent>
      </Card>

      {/* Rolling income projection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rolling income projection</CardTitle>
          <CardDescription>What if you sold this covered call every {rollDte} days for a year? Historical projection, NOT a prediction.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Period DTE"><Input type="number" value={rollDte} onChange={(e) => setRollDte(Number(e.target.value))} /></Field>
            <Field label="Strike OTM %"><Input type="number" step="0.01" value={rollOtmPct} onChange={(e) => setRollOtmPct(Number(e.target.value))} /></Field>
            <Field label="Premium yield/period"><Input type="number" step="0.001" value={rollPremYield} onChange={(e) => setRollPremYield(Number(e.target.value))} /></Field>
          </div>
          <Button size="sm" onClick={runRolling} disabled={rollLoading}>{rollLoading ? "Projecting…" : "Run projection"}</Button>

          {rolling && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-4">
                <Stat label="Periods analyzed" value={rolling.periodsAnalyzed.toString()} />
                <Stat label="Assignment rate" value={formatPercent(rolling.assignmentRate, 0)} tone={rolling.assignmentRate > 0.4 ? "loss" : undefined} />
                <Stat label="Ann. premium income" value={formatPercent(rolling.projectedAnnualPremiumIncome)} tone="profit" />
                <Stat label="Ann. total return" value={formatPercent(rolling.projectedAnnualTotalReturn)} tone={rolling.projectedAnnualTotalReturn >= 0 ? "profit" : "loss"} />
              </div>
              <div className="grid gap-3 sm:grid-cols-4">
                <Stat label="Buy & hold (ann.)" value={formatPercent(rolling.projectedAnnualUncappedReturn)} />
                <Stat label="Capture efficiency" value={formatPercent(rolling.incomeCaptureEfficiency)} tone={rolling.incomeCaptureEfficiency > 0.8 ? "profit" : undefined} />
                <Stat label="Avg period return" value={formatPercent(rolling.avgPeriodReturn)} />
                <Stat label="Periods/year" value={rolling.periodsPerYear.toString()} />
              </div>
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Per-period return distribution</div>
                <div className="grid grid-cols-5 gap-2 text-center">
                  <div><div className="text-xs text-muted-foreground">P10</div><div className="font-medium tabular">{formatPercent(rolling.distribution.p10)}</div></div>
                  <div><div className="text-xs text-muted-foreground">P25</div><div className="font-medium tabular">{formatPercent(rolling.distribution.p25)}</div></div>
                  <div><div className="text-xs text-muted-foreground">P50</div><div className="font-medium tabular">{formatPercent(rolling.distribution.p50)}</div></div>
                  <div><div className="text-xs text-muted-foreground">P75</div><div className="font-medium tabular">{formatPercent(rolling.distribution.p75)}</div></div>
                  <div><div className="text-xs text-muted-foreground">P90</div><div className="font-medium tabular">{formatPercent(rolling.distribution.p90)}</div></div>
                </div>
              </div>
              {rolling.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}</div>
              ))}
              <p className="text-xs text-muted-foreground">
                This projection slides a {rolling.periodsPerYear}-period window across historical data. It assumes similar premium
                opportunities persist and that the future resembles the past. Capture efficiency shows how much of buy-and-hold
                return you keep while writing calls.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Implied volatility &amp; expected move</CardTitle>
          <CardDescription>IV percentile/rank use rolling 30-day historical vol as a proxy when per-day IV history is unavailable.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {ivLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {iv && (
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="ATM IV" value={iv.currentAtmIv != null ? formatPercent(iv.currentAtmIv) : "—"} />
              <Stat label="IV percentile" value={iv.ivPercentile != null ? formatPercent(iv.ivPercentile) : "—"} tone={iv.ivPercentile != null && iv.ivPercentile > 0.7 ? "profit" : undefined} hint={iv.ivPercentile != null && iv.ivPercentile > 0.7 ? "premium-rich" : undefined} />
              <Stat label="IV rank" value={iv.ivRank != null ? formatNumber(iv.ivRank, 2) : "—"} />
              <Stat label="Expected move (1σ)" value={iv.expectedMove ? `${formatCurrency(iv.expectedMove.oneStdDev)} (${formatPercent(iv.expectedMove.oneStdDevPercent, 1)})` : "—"} />
            </div>
          )}
          {iv?.expectedMove && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              Over the next <strong>{iv.expectedMove.dte} days</strong>, the options market implies a 1-standard-deviation band of{" "}
              <strong>{formatCurrency(iv.expectedMove.lower1sd)} – {formatCurrency(iv.expectedMove.upper1sd)}</strong> (~68% probability under the lognormal model).
              <div className="mt-1 text-xs text-muted-foreground">{iv.expectedMove.note}</div>
            </div>
          )}
          {iv?.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}</div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monte Carlo: covered call vs buy-and-hold</CardTitle>
          <CardDescription>Bootstraps historical daily returns to simulate both strategies. NOT a prediction.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Field label="Paths"><Input type="number" value={paths} onChange={(e) => setPaths(Number(e.target.value))} /></Field>
            <Field label="Horizon (days)"><Input type="number" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} /></Field>
            <Field label="Period DTE"><Input type="number" value={periodDte} onChange={(e) => setPeriodDte(Number(e.target.value))} /></Field>
            <Field label="Strike OTM %"><Input type="number" step="0.01" value={otmPct} onChange={(e) => setOtmPct(Number(e.target.value))} /></Field>
            <Field label="Premium yield/period"><Input type="number" step="0.001" value={premYield} onChange={(e) => setPremYield(Number(e.target.value))} /></Field>
          </div>
          <Button size="sm" onClick={runMC} disabled={mcLoading}>{mcLoading ? "Simulating…" : "Run simulation"}</Button>

          {mc && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border p-3">
                  <div className="mb-2 text-sm font-semibold">Buy &amp; hold</div>
                  <Row label="Mean final value" value={formatCurrency(mc.buyAndHold.meanFinalValue, 0)} />
                  <Row label="Median" value={formatCurrency(mc.buyAndHold.medianFinalValue, 0)} />
                  <Row label="5th / 95th pct" value={`${formatCurrency(mc.buyAndHold.p5, 0)} / ${formatCurrency(mc.buyAndHold.p95, 0)}`} />
                  <Row label="Mean return" value={formatPercent(mc.buyAndHold.meanReturn)} tone={mc.buyAndHold.meanReturn >= 0 ? "profit" : "loss"} />
                  <Row label="Prob. positive" value={formatPercent(mc.buyAndHold.probPositive)} />
                </div>
                <div className="rounded-md border p-3">
                  <div className="mb-2 text-sm font-semibold">Covered call</div>
                  <Row label="Mean final value" value={formatCurrency(mc.coveredCall.meanFinalValue, 0)} />
                  <Row label="Median" value={formatCurrency(mc.coveredCall.medianFinalValue, 0)} />
                  <Row label="5th / 95th pct" value={`${formatCurrency(mc.coveredCall.p5, 0)} / ${formatCurrency(mc.coveredCall.p95, 0)}`} />
                  <Row label="Mean return" value={formatPercent(mc.coveredCall.meanReturn)} tone={mc.coveredCall.meanReturn >= 0 ? "profit" : "loss"} />
                  <Row label="Mean premium income" value={formatCurrency(mc.coveredCall.meanPremiumIncome, 0)} tone="profit" />
                  <Row label="Mean times assigned" value={formatNumber(mc.coveredCall.meanTimesAssigned, 1)} />
                </div>
              </div>
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Mean excess return (CC − B&amp;H)</span>
                  <span className={cn("font-medium", mc.comparison.meanExcessReturn >= 0 ? "text-profit" : "text-loss")}>{formatPercent(mc.comparison.meanExcessReturn)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Prob. CC beats B&amp;H</span>
                  <span className="font-medium">{formatPercent(mc.comparison.probCCBeatsBH)}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{mc.comparison.note}</div>
              </div>
              {mc.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}</div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: "profit" | "loss"; hint?: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-lg font-bold tabular", tone === "profit" && "text-profit", tone === "loss" && "text-loss")}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "profit" | "loss" }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular font-medium", tone === "profit" && "text-profit", tone === "loss" && "text-loss")}>{value}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
