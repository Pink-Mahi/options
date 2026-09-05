"use client";

import { useState } from "react";
import {
  Line,
  LineChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, Input, Label } from "@/components/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import type { BacktestResult } from "@/lib/calculations/backtester";

type StrategyOption = "COVERED_CALL" | "CASH_SECURED_PUT" | "WHEEL";

interface BacktestResponse extends BacktestResult {
  startingCapital: number;
  underlyingPrice: number;
  modelCaveat: string;
}

const STRATEGY_LABELS: Record<StrategyOption, string> = {
  COVERED_CALL: "Covered call",
  CASH_SECURED_PUT: "Cash-secured put",
  WHEEL: "Wheel",
};

export function BacktestView() {
  const [symbol, setSymbol] = useState("AAPL");
  const [strategy, setStrategy] = useState<StrategyOption>("COVERED_CALL");
  const [deltaTarget, setDeltaTarget] = useState(0.3);
  const [dteTarget, setDteTarget] = useState(45);
  const [range, setRange] = useState("3y");
  const [neverBelowCost, setNeverBelowCost] = useState(true);
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, strategy, deltaTarget, dteTarget, range, neverSellCallBelowCostBasis: neverBelowCost }),
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Backtest failed.");
        setResult(null);
      } else {
        setResult(data);
      }
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const chartData =
    result?.equityCurve.map((p) => ({
      date: p.date,
      Strategy: Math.round(p.strategyEquity),
      "Buy & hold": Math.round(p.buyHoldEquity),
    })) ?? [];

  const beatsBuyHold = result != null && result.outperformance > 0;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Strategy backtester</h1>
        <p className="text-sm text-muted-foreground">
          Walks a repeating options income strategy forward through real historical prices and compares it
          to simply holding the shares.
        </p>
      </div>

      <Card className="border-warning/40 bg-warning/5">
        <CardContent className="pt-6 text-sm">
          <p className="font-semibold">Read this before trusting any number below</p>
          <p className="mt-1 text-muted-foreground">
            Historical option quotes are not available, so each cycle&apos;s premium is{" "}
            <strong>modeled with Black-Scholes</strong> using trailing 30-day realized volatility. Real
            markets price volatility above realized (the variance risk premium), so modeled premiums are
            usually <em>conservative</em> — but strike availability, spreads, and fills all differ. Treat
            this as a rough shape of the strategy, not a track record you could have achieved.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parameters</CardTitle>
          <CardDescription>Strikes are chosen each cycle by closest match to the delta target.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <div className="space-y-1.5">
              <Label htmlFor="bt-symbol">Symbol</Label>
              <Input
                id="bt-symbol"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                placeholder="AAPL"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bt-strategy">Strategy</Label>
              <select
                id="bt-strategy"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={strategy}
                onChange={(e) => setStrategy(e.target.value as StrategyOption)}
              >
                {(Object.keys(STRATEGY_LABELS) as StrategyOption[]).map((s) => (
                  <option key={s} value={s}>
                    {STRATEGY_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bt-delta">Delta target</Label>
              <Input
                id="bt-delta"
                type="number"
                step="0.05"
                min="0.05"
                max="0.95"
                value={deltaTarget}
                onChange={(e) => setDeltaTarget(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bt-dte">DTE per cycle</Label>
              <Input
                id="bt-dte"
                type="number"
                step="1"
                min="7"
                max="365"
                value={dteTarget}
                onChange={(e) => setDteTarget(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bt-range">History</Label>
              <select
                id="bt-range"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={range}
                onChange={(e) => setRange(e.target.value)}
              >
                <option value="1y">1 year</option>
                <option value="3y">3 years</option>
                <option value="5y">5 years</option>
                <option value="10y">10 years</option>
              </select>
            </div>
          </div>
          <div className="mt-4">
            <Button onClick={run} disabled={loading || !symbol}>
              {loading ? "Running…" : "Run backtest"}
            </Button>
          </div>
          <div className="mt-4 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1.5">
            <p>
              <strong className="text-foreground">What is delta?</strong> Delta is a shortcut for{" "}
              <em>how likely the option is to be exercised against you</em>. A delta of 0.30 means roughly a
              30% chance the stock ends up past your strike at expiration — and about a 70% chance the option
              expires worthless and you keep the full premium.
            </p>
            <p>
              <strong className="text-foreground">Lower delta (0.10–0.20):</strong> strike is further away →
              safer, you keep your shares more often, but collect less premium.
            </p>
            <p>
              <strong className="text-foreground">Higher delta (0.40–0.50):</strong> strike is closer to the
              current price → more premium income, but you&apos;ll be assigned / called away more often.
            </p>
            <p>
              <strong className="text-foreground">DTE per cycle</strong> is how many days each option lasts
              before it expires and a new one is sold. 30–60 days is the common sweet spot for income sellers.
            </p>
          </div>
          <label className="mt-3 flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={neverBelowCost}
              onChange={(e) => setNeverBelowCost(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <span>
              <strong>Never sell calls below my cost basis.</strong>{" "}
              <span className="text-muted-foreground">
                If a put is assigned at $300, later covered calls are only sold at strikes of $300 or higher —
                so you can&apos;t be called away at a loss. Premiums may be tiny while the stock is underwater.
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {result && (
        <>
          {result.warnings.length > 0 && (
            <Card className="border-warning/40">
              <CardContent className="space-y-1 pt-6 text-sm">
                {result.warnings.map((w, i) => (
                  <p key={i} className="text-muted-foreground">
                    {w}
                  </p>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Strategy return"
              value={formatPercent(result.strategyReturn)}
              tone={result.strategyReturn >= 0 ? "profit" : "loss"}
            />
            <Stat
              label="Buy & hold return"
              value={formatPercent(result.buyHoldReturn)}
              tone={result.buyHoldReturn >= 0 ? "profit" : "loss"}
            />
            <Stat
              label="Outperformance"
              value={formatPercent(result.outperformance)}
              tone={beatsBuyHold ? "profit" : "loss"}
            />
            <Stat label="Max drawdown" value={formatPercent(result.maxDrawdown)} tone="loss" />
            <Stat label="Cycles" value={String(result.totalCycles)} />
            {result.costBasisFlooredCount > 0 && (
              <Stat
                label="Calls floored at cost basis"
                value={String(result.costBasisFlooredCount)}
              />
            )}
            <Stat label="Expired worthless" value={formatPercent(result.winRate)} />
            <Stat label="Total premium" value={formatCurrency(result.totalPremiumIncome, 0)} />
            <Stat
              label="Sharpe (per-cycle)"
              value={result.sharpeRatio != null ? result.sharpeRatio.toFixed(2) : "—"}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Equity curve</CardTitle>
              <CardDescription>
                Both lines start from the same capital ({formatCurrency(result.startingCapital, 0)}), so the
                gap is the strategy&apos;s contribution versus holding shares.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {chartData.length > 1 ? (
                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={40} />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}k`}
                      />
                      <Tooltip
                        formatter={(v) => formatCurrency(Number(v), 0)}
                        contentStyle={{ fontSize: 12 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="Strategy" stroke="#2563eb" dot={false} strokeWidth={2} />
                      <Line type="monotone" dataKey="Buy & hold" stroke="#94a3b8" dot={false} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Not enough completed cycles to plot an equity curve. Try a longer history window or a
                  shorter DTE.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Outcome breakdown</CardTitle>
                <CardDescription>
                  {result.totalCycles} cycles between {result.startDate} and {result.endDate}.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Expired worthless" value={String(result.expiredWorthlessCount)} />
                <Row label="Assigned (put)" value={String(result.assignmentCount)} />
                <Row label="Called away (call)" value={String(result.calledAwayCount)} />
                <Row label="Avg premium / cycle" value={formatCurrency(result.avgPremiumPerCycle, 2)} />
                <Row label="Avg days / cycle" value={`${Math.round(result.avgDaysPerCycle)}`} />
                {result.costBasisFlooredCount > 0 && (
                  <Row
                    label="Cycles floored at cost basis"
                    value={String(result.costBasisFlooredCount)}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Annualized comparison</CardTitle>
                <CardDescription>Annualized figures are comparison tools, not expected returns.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Strategy annualized" value={formatPercent(result.strategyAnnualizedReturn)} />
                <Row label="Buy & hold annualized" value={formatPercent(result.buyHoldAnnualizedReturn)} />
                <Row label="Period" value={`${result.startDate} → ${result.endDate}`} />
                <Row label="Underlying now" value={formatCurrency(result.underlyingPrice, 2)} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Trade log</CardTitle>
              <CardDescription>Last {Math.min(result.trades.length, 25)} cycles.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Opened</TableHead>
                      <TableHead>Closed</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Strike</TableHead>
                      <TableHead className="text-right">Stock open</TableHead>
                      <TableHead className="text-right">Stock close</TableHead>
                      <TableHead className="text-right">Premium</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead className="text-right">Cycle P/L</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.trades.slice(-25).reverse().map((t, i) => (
                      <TableRow key={i}>
                        <TableCell className="whitespace-nowrap">{t.openDate}</TableCell>
                        <TableCell className="whitespace-nowrap">{t.closeDate}</TableCell>
                        <TableCell>{t.optionType}</TableCell>
                        <TableCell className="text-right">{formatCurrency(t.strike, 2)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(t.stockPriceAtOpen, 2)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(t.stockPriceAtClose, 2)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(t.premiumIncome, 2)}</TableCell>
                        <TableCell>
                          <Badge variant={outcomeVariant(t.outcome)}>{t.outcome.replace(/_/g, " ").toLowerCase()}</Badge>
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-medium",
                            t.cyclePnl >= 0 ? "text-profit" : "text-loss",
                          )}
                        >
                          {formatCurrency(t.cyclePnl, 2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function outcomeVariant(outcome: string): "profit" | "warning" | "loss" | "secondary" {
  if (outcome === "EXPIRED_WORTHLESS") return "profit";
  if (outcome === "CALLED_AWAY") return "warning";
  if (outcome === "ASSIGNED") return "loss";
  return "secondary";
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "profit" | "loss";
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={cn(
            "mt-1 text-xl font-semibold",
            tone === "profit" && "text-profit",
            tone === "loss" && "text-loss",
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
