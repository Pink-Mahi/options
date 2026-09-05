"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, Input, Label, Select } from "@/components/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExpirationPicker } from "@/components/stock/expiration-picker";
import { useOptionChain } from "@/components/stock/use-option-chain";
import { PayoffChart } from "@/components/charts/payoff-chart";
import { calculateCoveredCall } from "@/lib/calculations/covered-call";
import { calculateCashSecuredPut } from "@/lib/calculations/cash-secured-put";
import { coveredCallPayoff, cashSecuredPutPayoff, expirationProfitTable } from "@/lib/calculations/payoff";
import { resolveOptionPrice } from "@/lib/calculations/core";
import { cn, formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import type { OptionContract, PayoffPoint, PriceAssumption } from "@/lib/types";
import type { StockData } from "@/features/options/stock-data";

export function CalculatorTab({
  data,
  expiration,
  onExpirationChange,
}: {
  data: StockData;
  expiration: string;
  onExpirationChange: (v: string) => void;
}) {
  const { data: chainData, error, loading } = useOptionChain(data.symbol, expiration);
  const [strategy, setStrategy] = useState<"covered_call" | "csp">("covered_call");
  const [strike, setStrike] = useState<number | "">("");
  const [assumption, setAssumption] = useState<PriceAssumption>("midpoint");
  const [customPrice, setCustomPrice] = useState<number>(0);
  const [contracts, setContracts] = useState<number>(1);
  const [costBasis, setCostBasis] = useState<number | "">("");

  const chain = chainData?.chain;
  const list = useMemo(
    () => (chain ? (strategy === "covered_call" ? chain.calls : chain.puts) : []),
    [chain, strategy],
  );
  const contract: OptionContract | undefined = useMemo(() => {
    if (!chain || strike === "") return undefined;
    return list.find((c) => c.strike === Number(strike));
  }, [chain, list, strike]);

  const result = useMemo(() => {
    if (!contract || !chain) return null;
    const resolved = resolveOptionPrice(contract, assumption, assumption === "custom" ? customPrice : undefined);
    if (strategy === "covered_call") {
      return { kind: "cc" as const, r: calculateCoveredCall({ contract, contracts, currentPrice: chain.underlyingPrice, costBasisPerShare: typeof costBasis === "number" ? costBasis : null, priceAssumption: resolved }) };
    }
    return { kind: "csp" as const, r: calculateCashSecuredPut({ contract, contracts, currentPrice: chain.underlyingPrice, priceAssumption: resolved }) };
  }, [contract, chain, strategy, assumption, customPrice, contracts, costBasis]);

  const payoff = useMemo(() => {
    if (!result || !chain) return null;
    if (result.kind === "cc") {
      return coveredCallPayoff({ currentPrice: chain.underlyingPrice, strike: contract!.strike, premiumPerShare: result.r.premiumPerShare, costBasisPerShare: typeof costBasis === "number" ? costBasis : null, contracts });
    }
    return cashSecuredPutPayoff({ currentPrice: chain.underlyingPrice, strike: contract!.strike, premiumPerShare: result.r.premiumPerShare, contracts });
  }, [result, chain, contract, costBasis, contracts]);

  const profitPrices = useMemo(() => expirationProfitTable(chain?.underlyingPrice ?? 100, 0.1, 9), [chain]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Profit calculator</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <ExpirationPicker expirations={data.expirations} value={expiration} onChange={onExpirationChange} />
            <Select value={strategy} onChange={(e) => setStrategy(e.target.value as "covered_call" | "csp")} className="w-auto">
              <option value="covered_call">Covered Call</option>
              <option value="csp">Cash-Secured Put</option>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Strike">
              <Select value={String(strike)} onChange={(e) => setStrike(e.target.value === "" ? "" : Number(e.target.value))}>
                <option value="">Select strike…</option>
                {list.map((c) => <option key={c.symbol} value={c.strike}>{formatCurrency(c.strike, 0)}{c.inTheMoney ? " (ITM)" : ""}</option>)}
              </Select>
            </Field>
            <Field label="Pricing assumption">
              <Select value={assumption} onChange={(e) => setAssumption(e.target.value as PriceAssumption)}>
                <option value="bid">Bid</option>
                <option value="midpoint">Midpoint</option>
                <option value="ask">Ask</option>
                <option value="last">Last</option>
                <option value="custom">Custom</option>
              </Select>
            </Field>
            {assumption === "custom" && (
              <Field label="Custom fill ($/share)">
                <Input type="number" step="0.01" value={customPrice} onChange={(e) => setCustomPrice(Number(e.target.value))} />
              </Field>
            )}
            <Field label="Contracts">
              <Input type="number" min={1} value={contracts} onChange={(e) => setContracts(Math.max(1, Number(e.target.value)))} />
            </Field>
            {strategy === "covered_call" && (
              <Field label="Cost basis ($/share, optional)">
                <Input type="number" step="0.01" placeholder="optional" value={costBasis} onChange={(e) => setCostBasis(e.target.value === "" ? "" : Number(e.target.value))} />
              </Field>
            )}
          </div>
        </CardContent>
      </Card>

      {loading && <p className="text-sm text-muted-foreground">Loading chain…</p>}
      {error && <p className="text-sm text-loss">{error}</p>}

      {result && payoff && contract && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-sm">Payoff at expiration</CardTitle></CardHeader>
            <CardContent><PayoffChart series={payoff} showStockOnly={strategy === "covered_call"} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Metrics</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <Metric label="Premium income" value={formatCurrency(result.r.premiumIncome, 0)} />
              <Metric label="Premium per share" value={formatCurrency(result.r.premiumPerShare)} />
              {result.kind === "cc" ? (
                <>
                  <Metric label="Premium yield" value={formatPercent(result.r.premiumYield)} />
                  <Metric label="Annualized premium yield*" value={formatPercent(result.r.annualizedPremiumYield)} />
                  <Metric label="Strike OTM %" value={formatPercent(result.r.strikeOtmPercent, 1)} />
                  <Metric label="Potential appreciation" value={formatPercent(result.r.potentialStockAppreciation, 1)} tone="profit" />
                  <Metric label="Max total return" value={formatPercent(result.r.maxTotalReturn, 1)} tone="profit" />
                  <Metric label="Annualized max total ret.*" value={formatPercent(result.r.annualizedMaxTotalReturn)} />
                  <Metric label="Break-even" value={formatCurrency(result.r.breakEven)} />
                  <Metric label="Downside protection" value={formatPercent(result.r.downsideProtectionPercent)} />
                </>
              ) : (
                <>
                  <Metric label="Gross collateral" value={formatCurrency(result.r.grossCollateral, 0)} />
                  <Metric label="Net capital at risk" value={formatCurrency(result.r.netCapitalAtRisk, 0)} />
                  <Metric label="Return on net capital" value={formatPercent(result.r.returnOnNetCapital)} />
                  <Metric label="Annualized (net)*" value={formatPercent(result.r.annualizedReturnOnNet)} />
                  <Metric label="Effective purchase price" value={formatCurrency(result.r.effectivePurchasePrice)} tone="profit" />
                  <Metric label="Discount to current" value={formatPercent(result.r.discountToCurrentPrice, 1)} />
                  <Metric label="Break-even" value={formatCurrency(result.r.breakEven)} />
                </>
              )}
              <Metric label="Delta / assignment prob." value={`${formatNumber(result.r.delta, 2)} / ${formatPercent(result.r.estimatedAssignmentProbability)}`} />
              <Metric label="IV" value={formatPercent(result.r.impliedVolatility)} />
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-sm">Expiration profit table</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stock @ exp</TableHead>
                    {profitPrices.map((p) => <TableHead key={p} className="text-right">{formatCurrency(p, 0)}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">{strategy === "covered_call" ? "Covered call P/L" : "CSP P/L"}</TableCell>
                    {profitPrices.map((p) => {
                      const pt = nearestPayoffPoint(payoff.points, p);
                      return <TableCell key={p} className={cn("text-right tabular", (pt?.combinedPnl ?? 0) >= 0 ? "text-profit" : "text-loss")}>{formatCurrency(pt?.combinedPnl ?? 0, 0)}</TableCell>;
                    })}
                  </TableRow>
                  {strategy === "covered_call" && (
                    <TableRow>
                      <TableCell className="font-medium">Stock only P/L</TableCell>
                      {profitPrices.map((p) => {
                        const pt = nearestPayoffPoint(payoff.points, p);
                        return <TableCell key={p} className={cn("text-right tabular", (pt?.stockOnlyPnl ?? 0) >= 0 ? "text-profit" : "text-loss")}>{formatCurrency(pt?.stockOnlyPnl ?? 0, 0)}</TableCell>;
                      })}
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
      {!result && !loading && !error && (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Select a strike to calculate.
        </div>
      )}
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

function Metric({ label, value, tone }: { label: string; value: string; tone?: "profit" | "loss" }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular font-medium", tone === "profit" && "text-profit", tone === "loss" && "text-loss")}>{value}</span>
    </div>
  );
}

function nearestPayoffPoint(points: PayoffPoint[], price: number): PayoffPoint | undefined {
  let best: PayoffPoint | undefined;
  let bestDist = Infinity;
  for (const pt of points) {
    const d = Math.abs(pt.stockPrice - price);
    if (d < bestDist) {
      bestDist = d;
      best = pt;
    }
  }
  return best;
}
