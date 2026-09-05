"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, Input, Label, Select } from "@/components/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PayoffChart } from "@/components/charts/payoff-chart";
import { calculateCoveredCall } from "@/lib/calculations/covered-call";
import { coveredCallPayoff, expirationProfitTable } from "@/lib/calculations/payoff";
import { calculateAssignmentProbability } from "@/lib/calculations/historical";
import { resolveOptionPrice } from "@/lib/calculations/core";
import type { CoveredCallCandidate, HistoricalPricePoint, PayoffPoint, PriceAssumption } from "@/lib/types";
import { cn, formatCurrency, formatPercent, formatNumber } from "@/lib/utils";

export function CoveredCallDetail({
  candidate,
  costBasisPerShare,
  currentPrice,
  points,
  earningsDate,
  exDividendDate,
  onClose,
}: {
  candidate: CoveredCallCandidate;
  costBasisPerShare: number | null;
  currentPrice: number;
  points: HistoricalPricePoint[];
  earningsDate: string | null;
  exDividendDate: string | null;
  onClose: () => void;
}) {
  const [assumption, setAssumption] = useState<PriceAssumption>("midpoint");
  const [customPrice, setCustomPrice] = useState<number>(candidate.premiumPerShare);
  const [contracts, setContracts] = useState<number>(candidate.contracts);

  const assignment = useMemo(() =>
    calculateAssignmentProbability(
      points,
      candidate.contract.daysToExpiration,
      currentPrice,
      candidate.contract.strike,
      candidate.contract.greeks.delta,
    ),
    [points, candidate.contract.daysToExpiration, currentPrice, candidate.contract.strike, candidate.contract.greeks.delta]
  );

  const reassessed = useMemo(() => {
    const resolved = resolveOptionPrice(
      candidate.contract,
      assumption,
      assumption === "custom" ? customPrice : undefined,
    );
    return calculateCoveredCall({
      contract: candidate.contract,
      contracts,
      currentPrice,
      costBasisPerShare,
      priceAssumption: resolved,
      earningsDate,
      exDividendDate,
    });
  }, [candidate, assumption, customPrice, contracts, currentPrice, costBasisPerShare, earningsDate, exDividendDate]);

  const payoff = useMemo(
    () =>
      coveredCallPayoff({
        currentPrice,
        strike: candidate.contract.strike,
        premiumPerShare: reassessed.premiumPerShare,
        costBasisPerShare,
        contracts,
      }),
    [reassessed, currentPrice, candidate.contract.strike, costBasisPerShare, contracts],
  );

  const profitPrices = useMemo(() => expirationProfitTable(currentPrice, 0.1, 9), [currentPrice]);

  return (
    <Card className="border-primary/30">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">
          {candidate.contract.underlyingSymbol} {candidate.contract.strike} Call · {candidate.contract.expiration} · {candidate.contract.daysToExpiration} DTE
        </CardTitle>
        <Button size="icon" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Pricing assumption">
            <Select value={assumption} onChange={(e) => setAssumption(e.target.value as PriceAssumption)}>
              <option value="bid">Bid ({formatCurrency(candidate.contract.bid)})</option>
              <option value="midpoint">Midpoint ({formatCurrency(candidate.contract.midpoint)})</option>
              <option value="ask">Ask ({formatCurrency(candidate.contract.ask)})</option>
              <option value="last">Last ({formatCurrency(candidate.contract.last)})</option>
              <option value="custom">Custom</option>
            </Select>
          </Field>
          {assumption === "custom" && (
            <Field label="Expected fill ($/share)">
              <Input type="number" step="0.01" value={customPrice} onChange={(e) => setCustomPrice(Number(e.target.value))} />
            </Field>
          )}
          <Field label="Contracts">
            <Input type="number" min={1} value={contracts} onChange={(e) => setContracts(Math.max(1, Number(e.target.value)))} />
          </Field>
          <div className="flex items-end">
            <div className="text-sm">
              <div className="text-xs text-muted-foreground">Expected fill</div>
              <div className="font-medium tabular">{formatCurrency(reassessed.premiumPerShare)}/share</div>
            </div>
          </div>
        </div>

        {candidate.earningsBeforeExpiration && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
            EARNINGS BEFORE EXPIRATION ({earningsDate}). Implied volatility and assignment risk may be affected.
          </div>
        )}
        {candidate.exDividendBeforeExpiration && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
            Ex-dividend before expiration ({exDividendDate}). Early assignment risk for ITM calls may increase.
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-sm">Payoff at expiration</CardTitle></CardHeader>
            <CardContent><PayoffChart series={payoff} /></CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Returns &amp; risk</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <Metric label="Premium income" value={formatCurrency(reassessed.premiumIncome, 0)} />
              <Metric label="Premium yield (mkt)" value={formatPercent(reassessed.premiumYield)} />
              {reassessed.premiumYieldOnCost != null && (
                <Metric label="Premium yield (cost)" value={formatPercent(reassessed.premiumYieldOnCost)} />
              )}
              <Metric label="Annualized premium yield*" value={formatPercent(reassessed.annualizedPremiumYield)} />
              <Metric label="Strike OTM %" value={formatPercent(reassessed.strikeOtmPercent, 1)} />
              <Metric label="Potential appreciation" value={formatPercent(reassessed.potentialStockAppreciation, 1)} tone="profit" />
              <Metric label="Max total return" value={formatPercent(reassessed.maxTotalReturn, 1)} tone="profit" />
              <Metric label="Annualized max total ret.*" value={formatPercent(reassessed.annualizedMaxTotalReturn)} />
              <Metric label="Break-even" value={formatCurrency(reassessed.breakEven)} />
              <Metric label="Downside protection" value={formatPercent(reassessed.downsideProtectionPercent)} />
              <Metric
                label="Delta / assign. prob."
                value={`${formatNumber(reassessed.delta, 2)} / ${formatPercent(assignment.compositeProbability ?? 0)}`}
                title={`Called away estimate: ${formatPercent(assignment.compositeProbability ?? 0, 0)}\nHistorical: ${assignment.historicalProbability != null ? formatPercent(assignment.historicalProbability, 0) : "—"}\nVol model: ${assignment.monteCarloProbability != null ? formatPercent(assignment.monteCarloProbability, 0) : "—"}\nWindows tested: ${assignment.sampleSize}`}
              />
              <Metric label="Theta / IV" value={`${formatNumber(reassessed.theta, 3)} / ${formatPercent(reassessed.impliedVolatility)}`} />
              <Metric label="Premium per day" value={formatCurrency(reassessed.premiumPerDay, 2)} />
              <Metric label="OI / Volume" value={`${candidate.openInterest ?? "—"} / ${candidate.volume ?? "—"}`} />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">Score breakdown</CardTitle>
            <Badge variant={reassessed.score.total >= 70 ? "profit" : reassessed.score.total >= 50 ? "warning" : "loss"}>
              AI Score: {reassessed.score.total}/100
            </Badge>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 lg:grid-cols-7">
            <ScoreCell label="Income" v={reassessed.score.income} />
            <ScoreCell label="Upside" v={reassessed.score.upsidePreservation} />
            <ScoreCell label="Assign. Risk" v={reassessed.score.assignmentRisk} />
            <ScoreCell label="Liquidity" v={reassessed.score.liquidity} />
            <ScoreCell label="Vol Premium" v={reassessed.score.volatilityPremium} />
            <ScoreCell label="Hist. Dist." v={reassessed.score.historicalDistance} />
            <ScoreCell label="Total Return" v={reassessed.score.totalReturn} />
          </CardContent>
        </Card>

        <Card>
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
                  <TableCell className="font-medium">Covered call P/L</TableCell>
                  {profitPrices.map((p) => {
                    const pt = nearestPayoffPoint(payoff.points, p);
                    return (
                      <TableCell key={p} className={cn("text-right tabular", (pt?.combinedPnl ?? 0) >= 0 ? "text-profit" : "text-loss")}>
                        {formatCurrency(pt?.combinedPnl ?? 0, 0)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          * Annualized rates are mathematical comparison tools. They assume similar opportunities can be repeatedly
          achieved and do NOT represent an expected or guaranteed annual return.
        </p>
      </CardContent>
    </Card>
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

function Metric({ label, value, tone, title }: { label: string; value: string; tone?: "profit" | "loss"; title?: string }) {
  return (
    <div className="flex items-center justify-between" title={title}>
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular font-medium", tone === "profit" && "text-profit", tone === "loss" && "text-loss")}>{value}</span>
    </div>
  );
}

function ScoreCell({ label, v }: { label: string; v: number }) {
  return (
    <div className="rounded-md border p-2 text-center">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-bold tabular", v >= 70 ? "text-profit" : v >= 50 ? "text-amber-500" : "text-loss")}>{v}</div>
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
