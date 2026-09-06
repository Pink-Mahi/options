"use client";

import { useState, useMemo } from "react";
import {
  Line,
  LineChart,
  Bar,
  BarChart,
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
import type { MarketContext } from "@/lib/calculations/market-context";

type StrategyOption = "COVERED_CALL" | "CASH_SECURED_PUT" | "WHEEL";

interface BacktestResponse extends BacktestResult {
  startingCapital: number;
  underlyingPrice: number;
  modelCaveat: string;
  _label?: string;
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
  const [minYieldPct, setMinYieldPct] = useState(0);
  const [contracts, setContracts] = useState(1);
  const [averageDown, setAverageDown] = useState(false);
  const [fillAssumption, setFillAssumption] = useState<"bid" | "mid">("bid");
  const [startingCapital, setStartingCapital] = useState(0);
  const [buyBackPct, setBuyBackPct] = useState(0);
  const [minPutYieldPct, setMinPutYieldPct] = useState(0);
  const [rollOnAssignment, setRollOnAssignment] = useState(false);
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [comparisonResults, setComparisonResults] = useState<BacktestResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          strategy,
          deltaTarget,
          dteTarget,
          range,
          neverSellCallBelowCostBasis: neverBelowCost,
          minCallPremiumYieldPct: minYieldPct > 0 ? minYieldPct / 100 : undefined,
          contracts,
          averageDownWithPremium: averageDown,
          fillAssumption,
          startingCapital: startingCapital > 0 ? startingCapital : undefined,
          buyBackPct: buyBackPct > 0 ? buyBackPct / 100 : undefined,
          minPutPremiumYieldPct: minPutYieldPct > 0 ? minPutYieldPct / 100 : undefined,
          rollOnAssignment,
        }),
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Backtest failed.");
        setResult(null);
      } else {
        setResult(data);
        setComparisonResults([]);
      }
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  async function runComparison() {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    setComparisonResults([]);
    const variants = [
      { label: "30 DTE", dte: 30, buyBack: 0, delta: deltaTarget },
      { label: "45 DTE", dte: 45, buyBack: 0, delta: deltaTarget },
      { label: "45 DTE + 50% buy-back", dte: 45, buyBack: 50, delta: deltaTarget },
    ];
    try {
      const results: BacktestResponse[] = [];
      for (const v of variants) {
        const res = await fetch("/api/backtest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol, strategy, range, contracts, fillAssumption,
            neverSellCallBelowCostBasis: neverBelowCost,
            averageDownWithPremium: averageDown,
            startingCapital: startingCapital > 0 ? startingCapital : undefined,
            minCallPremiumYieldPct: minYieldPct > 0 ? minYieldPct / 100 : undefined,
            minPutPremiumYieldPct: minPutYieldPct > 0 ? minPutYieldPct / 100 : undefined,
            rollOnAssignment,
            deltaTarget: v.delta,
            dteTarget: v.dte,
            buyBackPct: v.buyBack > 0 ? v.buyBack / 100 : undefined,
          }),
          cache: "no-store",
        });
        const data = await res.json();
        if (res.ok) results.push({ ...data, _label: v.label } as BacktestResponse);
      }
      setComparisonResults(results);
      if (results.length > 0) setResult(results[0]!);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function exportCsv() {
    if (!result) return;
    const rows = [
      ["Open", "Close", "Type", "Strike", "Stock Open", "Stock Close", "Premium", "Yield", "Outcome", "Cycle P/L", "Days", "Contracts"],
      ...result.trades.map((t) => [
        t.openDate, t.closeDate, t.optionType, t.strike.toFixed(2),
        t.stockPriceAtOpen.toFixed(2), t.stockPriceAtClose.toFixed(2),
        t.premiumIncome.toFixed(2), (t.premiumYield * 100).toFixed(2) + "%",
        t.outcome, t.cyclePnl.toFixed(2), String(t.daysHeld), String(t.contracts),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backtest_${result.symbol}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const monthlyData = useMemo(() => {
    if (!result) return [];
    const map = new Map<string, { month: string; premium: number; pnl: number }>();
    for (const t of result.trades) {
      const month = t.openDate.slice(0, 7);
      const entry = map.get(month) ?? { month, premium: 0, pnl: 0 };
      entry.premium += t.premiumIncome;
      entry.pnl += t.cyclePnl;
      map.set(month, entry);
    }
    return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
  }, [result]);

  const benchmarkMap = useMemo(() => {
    if (!result?.marketContext) return new Map<string, number>();
    return new Map(result.marketContext.benchmarkEquity.map((p) => [p.date, Math.round(p.equity)]));
  }, [result]);

  const chartData =
    result?.equityCurve.map((p) => ({
      date: p.date,
      Strategy: Math.round(p.strategyEquity),
      "Buy & hold": Math.round(p.buyHoldEquity),
      ...(benchmarkMap.has(p.date) ? { SPY: benchmarkMap.get(p.date) } : {}),
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
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
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
              <Label htmlFor="bt-contracts">Contracts</Label>
              <Input
                id="bt-contracts"
                type="number"
                step="1"
                min="1"
                max="50"
                value={contracts}
                onChange={(e) => setContracts(Math.max(1, Number(e.target.value)))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bt-minyield">Min call yield %</Label>
              <Input
                id="bt-minyield"
                type="number"
                step="0.1"
                min="0"
                max="20"
                value={minYieldPct}
                onChange={(e) => setMinYieldPct(Number(e.target.value))}
                placeholder="0 = off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bt-fill">Fill price</Label>
              <select
                id="bt-fill"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={fillAssumption}
                onChange={(e) => setFillAssumption(e.target.value as "bid" | "mid")}
              >
                <option value="bid">Bid (conservative)</option>
                <option value="mid">Mid (optimistic)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bt-capital">Starting capital</Label>
              <Input
                id="bt-capital"
                type="number"
                step="1000"
                min="0"
                value={startingCapital || ""}
                onChange={(e) => setStartingCapital(Number(e.target.value))}
                placeholder="Auto"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bt-minputyield">Min put yield %</Label>
              <Input
                id="bt-minputyield"
                type="number"
                step="0.1"
                min="0"
                max="20"
                value={minPutYieldPct}
                onChange={(e) => setMinPutYieldPct(Number(e.target.value))}
                placeholder="0 = off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bt-buyback">Buy back at % profit</Label>
              <Input
                id="bt-buyback"
                type="number"
                step="5"
                min="0"
                max="95"
                value={buyBackPct || ""}
                onChange={(e) => setBuyBackPct(Number(e.target.value))}
                placeholder="0 = hold to expiry"
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
          <div className="mt-4 flex gap-2">
            <Button onClick={run} disabled={loading || !symbol}>
              {loading ? "Running…" : "Run backtest"}
            </Button>
            <Button variant="outline" onClick={runComparison} disabled={loading || !symbol}>
              {loading ? "Running…" : "Compare variants"}
            </Button>
            {result && (
              <Button variant="outline" onClick={exportCsv}>
                Export CSV
              </Button>
            )}
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
            <p>
              <strong className="text-foreground">Min call yield %</strong> simulates a resting GTC limit
              order: the call is only sold if the premium is at least this % of the stock price (e.g. 2.5 =
              sell only if you collect $2.50 per $100 of stock). The backtester re-checks every 5 trading days
              within the cycle — if it never reaches your price, the order doesn&apos;t fill and your shares sit
              uncovered that cycle. Set to 0 to always sell at market.
            </p>
            <p>
              <strong className="text-foreground">Think of it like renting out a house:</strong> the
              cost-basis floor sets the <em>terms</em> (never rent in a way that forces a sale below what you
              paid) and the yield floor sets the <em>rent</em> (don&apos;t accept a tenant paying less than your
              rate). If neither condition is met, you simply don&apos;t rent that month — you keep the house and
              wait for a better offer.
            </p>
            <p>
              <strong className="text-foreground">Reinvest premium to average down:</strong> when the stock
              drops below your cost basis, accumulated premium buys extra 100-share lots. Each lot lowers your
              average cost basis — so your strike floor drops too, and each extra 100 shares means one more
              call contract you can sell next cycle.
            </p>
            <p>
              <strong className="text-foreground">Fill price:</strong> <em>Bid</em> assumes you sell 5% below
              the modeled mid (realistic for marketable orders). <em>Mid</em> assumes perfect fills —
              optimistic. <strong className="text-foreground">Starting capital</strong> sets the buy &amp;
              hold comparison baseline; leave blank to auto-size it to the position (spot × contracts × 100).
              <strong className="text-foreground">Buy back at % profit</strong> places a GTC order to close
              the option early once it decays to that profit level. E.g. 50 = if you sold for $2.00, the order
              buys back at $1.00 — you keep $1.00 and free the position for a new cycle immediately. Checked
              daily. Common values: 50% (Tastytrade-style), 75%, 80%. 0 = hold to expiration.
            </p>
            <p>
              <strong className="text-foreground">Min put yield %</strong> is the same GTC limit-order
              simulation, but for put entries. If the premium you collect is too low relative to the stock
              price, you skip selling that put and keep your cash on the sidelines.
            </p>
            <p>
              <strong className="text-foreground">Roll on assignment</strong> — instead of letting shares
              be called away when a call finishes ITM, the backtester buys back the call at intrinsic value
              and keeps holding the shares. This avoids resetting the wheel to the put phase.
            </p>
            <p>
              <strong className="text-foreground">Compare variants</strong> runs three parameter sets
              side by side (30 DTE, 45 DTE, 45 DTE + 50% buy-back) so you can see the effect of each tweak
              in one click.
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
          <label className="mt-2 flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={averageDown}
              onChange={(e) => setAverageDown(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <span>
              <strong>Reinvest premium to average down.</strong>{" "}
              <span className="text-muted-foreground">
                When the stock is below your cost basis, spend collected premium on 100-share lots — lowering
                your floor and increasing the number of calls you can sell.
              </span>
            </span>
          </label>
          <label className="mt-2 flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={rollOnAssignment}
              onChange={(e) => setRollOnAssignment(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <span>
              <strong>Roll on assignment.</strong>{" "}
              <span className="text-muted-foreground">
                When a call finishes ITM, buy it back at intrinsic value instead of letting shares be called
                away. Keeps you in the covered-call phase.
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
            {result.noFillCount > 0 && (
              <Stat
                label="GTC orders not filled"
                value={`${result.noFillCount} (${formatPercent(1 - result.callFillRate, 0)} of calls)`}
              />
            )}
            {result.avgCallPremiumYield > 0 && (
              <Stat
                label="Avg call yield"
                value={formatPercent(result.avgCallPremiumYield, 2)}
              />
            )}
            {result.averagedDownLots > 0 && (
              <Stat
                label="Lots bought (avg down)"
                value={`${result.averagedDownLots} (${formatCurrency(result.reinvestedPremium, 0)})`}
              />
            )}
            {result.endingCostBasis != null && result.averagedDownLots > 0 && (
              <Stat
                label="Ending cost basis"
                value={`${formatCurrency(result.endingCostBasis, 2)} × ${result.endingShares} sh`}
              />
            )}
            {result.earlyCloseCount > 0 && (
              <Stat
                label="Closed early (buy-back)"
                value={`${result.earlyCloseCount} of ${result.totalCycles}`}
              />
            )}
            {result.rolledCount > 0 && (
              <Stat
                label="Calls rolled"
                value={String(result.rolledCount)}
              />
            )}
            {result.putNoFillCount > 0 && (
              <Stat
                label="Put GTC not filled"
                value={`${result.putNoFillCount} (${formatPercent(1 - result.putFillRate, 0)} of puts)`}
              />
            )}
            {result.avgPutPremiumYield > 0 && (
              <Stat
                label="Avg put yield"
                value={formatPercent(result.avgPutPremiumYield, 2)}
              />
            )}
            <Stat label="Expired worthless" value={formatPercent(result.winRate)} />
            <Stat label="Total premium" value={formatCurrency(result.totalPremiumIncome, 0)} />
            <Stat
              label="Sharpe (per-cycle)"
              value={result.sharpeRatio != null ? result.sharpeRatio.toFixed(2) : "—"}
            />
          </div>

          {monthlyData.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Monthly premium income</CardTitle>
                <CardDescription>Premium collected and cycle P/L by month.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} minTickGap={30} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${Number(v).toFixed(0)}`} />
                      <Tooltip formatter={(v) => formatCurrency(Number(v), 0)} contentStyle={{ fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="premium" name="Premium" fill="#2563eb" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="pnl" name="Cycle P/L" fill="#16a34a" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {comparisonResults.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Comparison</CardTitle>
                <CardDescription>Side-by-side results for different parameter sets.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Variant</TableHead>
                      <TableHead className="text-right">Return</TableHead>
                      <TableHead className="text-right">Annualized</TableHead>
                      <TableHead className="text-right">Premium</TableHead>
                      <TableHead className="text-right">Cycles</TableHead>
                      <TableHead className="text-right">Max DD</TableHead>
                      <TableHead className="text-right">Sharpe</TableHead>
                      <TableHead className="text-right">Win rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {comparisonResults.map((r, i) => (
                      <TableRow key={i} className={cn("cursor-pointer", r === result && "bg-muted/50")} onClick={() => setResult(r)}>
                        <TableCell className="font-medium">{r._label ?? `Variant ${i + 1}`}</TableCell>
                        <TableCell className={cn("text-right", r.strategyReturn >= 0 ? "text-profit" : "text-loss")}>
                          {formatPercent(r.strategyReturn)}
                        </TableCell>
                        <TableCell className="text-right">{formatPercent(r.strategyAnnualizedReturn)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(r.totalPremiumIncome, 0)}</TableCell>
                        <TableCell className="text-right">{r.totalCycles}</TableCell>
                        <TableCell className="text-right text-loss">{formatPercent(r.maxDrawdown)}</TableCell>
                        <TableCell className="text-right">{r.sharpeRatio != null ? r.sharpeRatio.toFixed(2) : "—"}</TableCell>
                        <TableCell className="text-right">{formatPercent(r.winRate)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="mt-2 text-xs text-muted-foreground">Click a row to view its full results above.</p>
              </CardContent>
            </Card>
          )}

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
                      {result.marketContext && (
                        <Line type="monotone" dataKey="SPY" stroke="#f59e0b" dot={false} strokeWidth={1.5} strokeDasharray="4 4" />
                      )}
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

          {result.marketContext && (
            <MarketContextCard context={result.marketContext} />
          )}

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
                {result.noFillCount > 0 && (
                  <Row label="GTC orders not filled" value={String(result.noFillCount)} />
                )}
                {result.avgCallPremiumYield > 0 && (
                  <Row label="Avg call yield / cycle" value={formatPercent(result.avgCallPremiumYield, 2)} />
                )}
                {result.averagedDownLots > 0 && (
                  <>
                    <Row label="Lots bought (avg down)" value={String(result.averagedDownLots)} />
                    <Row label="Premium reinvested" value={formatCurrency(result.reinvestedPremium, 0)} />
                    <Row label="Ending shares" value={String(result.endingShares)} />
                    {result.endingCostBasis != null && (
                      <Row label="Ending cost basis" value={formatCurrency(result.endingCostBasis, 2)} />
                    )}
                  </>
                )}
                {result.earlyCloseCount > 0 && (
                  <Row label="Closed early (buy-back)" value={String(result.earlyCloseCount)} />
                )}
                {result.rolledCount > 0 && (
                  <Row label="Calls rolled" value={String(result.rolledCount)} />
                )}
                {result.putNoFillCount > 0 && (
                  <Row label="Put GTC not filled" value={String(result.putNoFillCount)} />
                )}
                {result.avgPutPremiumYield > 0 && (
                  <Row label="Avg put yield / cycle" value={formatPercent(result.avgPutPremiumYield, 2)} />
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
                      <TableHead className="text-right">Yield</TableHead>
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
                        <TableCell className="text-right">
                          {t.outcome === "NO_FILL" ? "—" : formatPercent(t.premiumYield, 2)}
                        </TableCell>
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
  if (outcome === "EXPIRED_WORTHLESS" || outcome === "BOUGHT_BACK") return "profit";
  if (outcome === "CALLED_AWAY") return "warning";
  if (outcome === "ASSIGNED") return "loss";
  return "secondary"; // NO_FILL, ROLLED
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

const REGIME_COLORS: Record<string, string> = {
  BULL: "bg-profit/15 text-profit border-profit/30",
  BEAR: "bg-loss/15 text-loss border-loss/30",
  CRISIS: "bg-destructive/20 text-destructive border-destructive/40",
  RECOVERY: "bg-warning/15 text-warning border-warning/30",
};

function MarketContextCard({ context }: { context: MarketContext }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Market context — {context.benchmarkSymbol} benchmark</CardTitle>
        <CardDescription>
          Is this stock&apos;s performance driven by the broader market, or is it company-specific?
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Avg beta (90d)" value={context.avgBeta.toFixed(2)} />
          <Stat label="Avg correlation" value={context.avgCorrelation.toFixed(2)} />
          <Stat
            label="Alpha vs market"
            value={formatPercent(context.alpha, 1)}
            tone={context.alpha >= 0 ? "profit" : "loss"}
          />
          <Stat
            label="Current regime"
            value={context.currentRegime}
            tone={context.currentRegime === "BULL" ? "profit" : context.currentRegime === "CRISIS" || context.currentRegime === "BEAR" ? "loss" : undefined}
          />
          <Stat label={`${context.benchmarkSymbol} return`} value={formatPercent(context.benchmarkReturn)} tone={context.benchmarkReturn >= 0 ? "profit" : "loss"} />
          <Stat label={`${context.benchmarkSymbol} max DD`} value={formatPercent(context.benchmarkMaxDrawdown)} tone="loss" />
          <Stat
            label="Systemic drawdown %"
            value={formatPercent(context.systemicDrawdownPct, 0)}
          />
          <Stat
            label="Drawdowns attributed"
            value={`${context.drawdownAttributions.length} (${context.drawdownAttributions.filter((d) => d.type === "SYSTEMIC").length} systemic, ${context.drawdownAttributions.filter((d) => d.type === "IDIOSYNCRATIC").length} company-specific)`}
          />
        </div>

        <div className="rounded-md border bg-muted/30 p-3 text-sm leading-relaxed">
          {context.summary}
        </div>

        {context.regimes.length > 1 && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Market regime timeline</p>
            <div className="flex flex-wrap gap-1.5">
              {context.regimes.map((r, i) => (
                <div
                  key={i}
                  className={cn("rounded border px-2 py-1 text-xs", REGIME_COLORS[r.type] ?? "bg-muted text-muted-foreground border-border")}
                  title={r.description}
                >
                  <span className="font-medium">{r.type}</span>
                  <span className="ml-1 opacity-70">
                    {r.startDate.slice(0, 7)}–{r.endDate.slice(0, 7)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {context.drawdownAttributions.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Drawdown attribution ({">"}10% stock drawdowns)</p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Stock DD</TableHead>
                    <TableHead className="text-right">Market DD</TableHead>
                    <TableHead className="text-right">Systemic %</TableHead>
                    <TableHead>Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {context.drawdownAttributions.map((d, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {d.startDate.slice(0, 10)} → {d.endDate.slice(0, 10)}
                      </TableCell>
                      <TableCell className="text-right text-loss">{formatPercent(d.stockDrawdown)}</TableCell>
                      <TableCell className="text-right">{formatPercent(d.marketDrawdown)}</TableCell>
                      <TableCell className="text-right">{formatPercent(d.systemicFraction, 0)}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            d.type === "SYSTEMIC" ? "secondary" :
                            d.type === "IDIOSYNCRATIC" ? "loss" : "warning"
                          }
                        >
                          {d.type === "SYSTEMIC" ? "Market-driven" : d.type === "IDIOSYNCRATIC" ? "Company-specific" : "Mixed"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="mt-2 space-y-1">
              {context.drawdownAttributions.map((d, i) => (
                <p key={i} className="text-xs text-muted-foreground">
                  <span className={cn(
                    "font-medium",
                    d.type === "SYSTEMIC" && "text-secondary",
                    d.type === "IDIOSYNCRATIC" && "text-loss",
                    d.type === "MIXED" && "text-warning",
                  )}>
                    {d.startDate.slice(0, 10)}:
                  </span>{" "}
                  {d.description}
                </p>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
