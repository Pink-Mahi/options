"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PriceHistoryChart } from "@/components/charts/price-history-chart";
import { ExpirationPicker } from "@/components/stock/expiration-picker";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import type { StockData } from "@/features/options/stock-data";
import type { Portfolio } from "@/lib/types";

export function OverviewTab({
  data,
  portfolio,
  expiration,
  onExpirationChange,
}: {
  data: StockData;
  portfolio: Portfolio | null;
  expiration: string;
  onExpirationChange: (v: string) => void;
}) {
  const r = data.historicalReturns;
  const position = portfolio?.stockLots.find((l) => l.symbol === data.symbol) ?? null;
  const nextEarnings = data.events.earnings[0];
  const nextDiv = data.events.dividends[0];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Price history (5y)</CardTitle>
        </CardHeader>
        <CardContent>
          <PriceHistoryChart points={data.historical.points} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Returns &amp; volatility</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="1-month return" value={formatPercent(r.oneMonthReturn)} />
          <Row label="3-month return" value={formatPercent(r.threeMonthReturn)} />
          <Row label="6-month return" value={formatPercent(r.sixMonthReturn)} />
          <Row label="1-year return" value={formatPercent(r.oneYearReturn)} />
          <Row label="3-year return" value={formatPercent(r.threeYearReturn)} />
          <Row label="5-year return" value={formatPercent(r.fiveYearReturn)} />
          <Row label="Annualized volatility" value={formatPercent(r.annualizedVolatility)} />
          <Row label="Max drawdown" value={formatPercent(r.maxDrawdown)} tone="loss" />
          <Row label="From 52w high" value={formatPercent(r.distanceFrom52WeekHigh)} tone="loss" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Moving averages</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data.movingAverages.length === 0 && (
            <p className="text-muted-foreground">Insufficient history.</p>
          )}
          {data.movingAverages.map((m) => (
            <Row
              key={m.period}
              label={`MA ${m.period}`}
              value={formatCurrency(m.value)}
              tone={m.priceAbove ? "profit" : "loss"}
              hint={m.priceAbove ? "price above" : "price below"}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Corporate events</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {nextEarnings ? (
            <div>
              <div className="text-xs uppercase text-muted-foreground">Next earnings</div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{nextEarnings.date}</span>
                <Badge variant={nextEarnings.timing === "pre" || nextEarnings.timing === "post" ? "warning" : "outline"}>
                  {nextEarnings.timing ?? "TBD"}
                </Badge>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">No upcoming earnings date available.</p>
          )}
          {nextDiv && (
            <div>
              <div className="text-xs uppercase text-muted-foreground">Next ex-dividend</div>
              <div className="font-medium">
                {nextDiv.exDate} · {formatCurrency(nextDiv.amount)}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your position</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {position ? (
            <>
              <Row label="Shares" value={`${position.shares}`} />
              <Row label="Cost basis" value={formatCurrency(position.costBasisPerShare)} />
              <Row label="Total cost" value={formatCurrency(position.totalCostBasis)} />
              <Row
                label="Unrealized"
                value={formatCurrency((data.quote.price - position.costBasisPerShare) * position.shares)}
                tone={data.quote.price >= position.costBasisPerShare ? "profit" : "loss"}
              />
              {position.protectedFromCalls && <Badge variant="secondary">Protected from calls</Badge>}
            </>
          ) : (
            <p className="text-muted-foreground">
              You don&apos;t own this stock. Add it in the Portfolio page to analyze covered calls against your shares.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle className="text-base">Select expiration for analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <ExpirationPicker
            expirations={data.expirations}
            value={expiration}
            onChange={onExpirationChange}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "profit" | "loss";
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className={cn("tabular font-medium", tone === "profit" && "text-profit", tone === "loss" && "text-loss")}>
          {value}
        </span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
    </div>
  );
}
