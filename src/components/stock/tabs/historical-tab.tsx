"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, Input, Label, Select } from "@/components/ui";
import { PriceHistoryChart } from "@/components/charts/price-history-chart";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import type { HistoricalPricePoint } from "@/lib/types";
import type { StockData } from "@/features/options/stock-data";

const RANGES = [
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
  { value: "6m", label: "6M" },
  { value: "1y", label: "1Y" },
  { value: "5y", label: "5Y (default)" },
] as const;

export function HistoricalTab({ data }: { data: StockData }) {
  const [range, setRange] = useState<(typeof RANGES)[number]["value"]>("5y");
  const [threshold, setThreshold] = useState<number>(0.15);
  const [windowDays, setWindowDays] = useState<number>(45);
  const [dist, setDist] = useState<null | {
    sampleSize: number;
    median: number;
    p10: number;
    p90: number;
    percentExceeding: number;
    percentDeclining: number;
  }>(null);
  const [loading, setLoading] = useState(false);

  async function runDistribution() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/stock/${encodeURIComponent(data.symbol)}/rolling?window=${windowDays}&threshold=${threshold}`,
        { cache: "no-store" },
      );
      if (res.ok) setDist(await res.json());
      else setDist(null);
    } finally {
      setLoading(false);
    }
  }

  const r = data.historicalReturns;
  const points = data.historical.points;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Price history</CardTitle>
          <Select value={range} onChange={(e) => setRange(e.target.value as typeof range)} className="w-auto">
            {RANGES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </Select>
        </CardHeader>
        <CardContent>
          <PriceHistoryChart points={sliceRange(points, range)} height={300} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Returns &amp; drawdowns</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Row label="1-month" value={formatPercent(r.oneMonthReturn)} />
            <Row label="3-month" value={formatPercent(r.threeMonthReturn)} />
            <Row label="6-month" value={formatPercent(r.sixMonthReturn)} />
            <Row label="1-year" value={formatPercent(r.oneYearReturn)} />
            <Row label="3-year" value={formatPercent(r.threeYearReturn)} />
            <Row label="5-year" value={formatPercent(r.fiveYearReturn)} />
            <Row label="Annualized volatility" value={formatPercent(r.annualizedVolatility)} />
            <Row label="Max drawdown" value={formatPercent(r.maxDrawdown)} tone="loss" />
            <Row label="Avg monthly return" value={formatPercent(r.avgMonthlyReturn)} />
            <Row label="Avg annual return" value={formatPercent(r.avgAnnualReturn)} />
            <Row label="From 52w high" value={formatPercent(r.distanceFrom52WeekHigh)} tone="loss" />
            <Row label="From 52w low" value={formatPercent(r.distanceFrom52WeekLow)} tone="profit" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Historical strike probability</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Examines rolling {windowDays}-day windows over the available history. Reports how often the stock
              moved more than {formatPercent(threshold, 0)} within that window. Historical description, NOT a prediction.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Window (days)">
                <Input type="number" value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))} />
              </Field>
              <Field label="Threshold return (e.g. 0.15 = 15%)">
                <Input type="number" step="0.01" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
              </Field>
            </div>
            <Button size="sm" onClick={runDistribution} disabled={loading}>
              {loading ? "Calculating…" : "Calculate"}
            </Button>
            {dist && (
              <div className="rounded-md border p-3 text-sm space-y-1.5">
                <Row label="Sample size" value={`${dist.sampleSize} windows`} />
                <Row label="Median return" value={formatPercent(dist.median)} />
                <Row label="10th percentile" value={formatPercent(dist.p10)} tone="loss" />
                <Row label="90th percentile" value={formatPercent(dist.p90)} tone="profit" />
                <Row
                  label={`Exceeded ${formatPercent(threshold, 0)}`}
                  value={formatPercent(dist.percentExceeding)}
                  tone="profit"
                />
                <Row label="Declined below threshold" value={formatPercent(dist.percentDeclining)} tone="loss" />

                <div className="mt-3 space-y-1.5 border-t pt-3 text-xs text-muted-foreground">
                  <p>
                    <strong>Sample size:</strong> number of rolling {windowDays}-day windows that could be tested over the selected history. Larger samples are more reliable.
                  </p>
                  <p>
                    <strong>Median return:</strong> the middle return observed across all windows. Half the windows did better, half did worse.
                  </p>
                  <p>
                    <strong>10th percentile:</strong> 10% of windows had a return this low or lower — think of it as a downside stress level.
                  </p>
                  <p>
                    <strong>90th percentile:</strong> 10% of windows had a return this high or higher — an upside reference, not a target.
                  </p>
                  <p>
                    <strong>Exceeded threshold:</strong> share of windows where the stock gained more than {formatPercent(threshold, 0)}. Useful for estimating how often a call strike at that moneyness would have been hit historically.
                  </p>
                  <p>
                    <strong>Declined below threshold:</strong> share of windows where the stock finished with a gain of less than {formatPercent(threshold, 0)} (including losses). This is the probability the strike would have been missed or expired worthless.
                  </p>
                  <p className="italic">
                    These figures describe the past, not predict the future. Past behavior may not repeat.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function sliceRange(points: HistoricalPricePoint[], range: string): HistoricalPricePoint[] {
  const days = range === "1m" ? 31 : range === "3m" ? 91 : range === "6m" ? 182 : range === "1y" ? 365 : points.length;
  return points.slice(Math.max(0, points.length - days));
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "profit" | "loss" }) {
  return (
    <div className="flex items-center justify-between">
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
