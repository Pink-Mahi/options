"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, Input, Label, Select } from "@/components/ui";
import { PayoffChart } from "@/components/charts/payoff-chart";
import { calculateCashSecuredPut } from "@/lib/calculations/cash-secured-put";
import { cashSecuredPutPayoff } from "@/lib/calculations/payoff";
import { calculateAssignmentProbability } from "@/lib/calculations/historical";
import { resolveOptionPrice } from "@/lib/calculations/core";
import type { CashSecuredPutCandidate, HistoricalPricePoint, PriceAssumption } from "@/lib/types";
import { cn, formatCurrency, formatPercent, formatNumber } from "@/lib/utils";

export function CashSecuredPutDetail({
  candidate,
  currentPrice,
  points,
  earningsDate,
  exDividendDate,
  onClose,
}: {
  candidate: CashSecuredPutCandidate;
  currentPrice: number;
  points: HistoricalPricePoint[];
  earningsDate: string | null;
  exDividendDate: string | null;
  onClose: () => void;
}) {
  const [assumption, setAssumption] = useState<PriceAssumption>("midpoint");
  const [customPrice, setCustomPrice] = useState(candidate.premiumPerShare);
  const [contracts, setContracts] = useState(candidate.contracts);

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
    const resolved = resolveOptionPrice(candidate.contract, assumption, assumption === "custom" ? customPrice : undefined);
    return calculateCashSecuredPut({
      contract: candidate.contract,
      contracts,
      currentPrice,
      priceAssumption: resolved,
      earningsDate,
      exDividendDate,
    });
  }, [candidate, assumption, customPrice, contracts, currentPrice, earningsDate, exDividendDate]);

  const payoff = useMemo(
    () => cashSecuredPutPayoff({ currentPrice, strike: candidate.contract.strike, premiumPerShare: reassessed.premiumPerShare, contracts }),
    [reassessed, currentPrice, candidate.contract.strike, contracts],
  );

  return (
    <Card className="border-primary/30">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">
          {candidate.contract.underlyingSymbol} {candidate.contract.strike} Put · {candidate.contract.expiration} · {candidate.contract.daysToExpiration} DTE
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
          <Field label="Contracts"><Input type="number" min={1} value={contracts} onChange={(e) => setContracts(Math.max(1, Number(e.target.value)))} /></Field>
        </div>

        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          You are being paid <span className="font-semibold text-profit">{formatCurrency(reassessed.premiumIncome, 0)}</span> to agree to
          purchase {contracts * 100} shares at an effective price of <span className="font-semibold">{formatCurrency(reassessed.effectivePurchasePrice)}</span> if assigned.
        </div>

        {candidate.earningsBeforeExpiration && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
            EARNINGS BEFORE EXPIRATION ({earningsDate}).
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-sm">Payoff at expiration</CardTitle></CardHeader>
            <CardContent><PayoffChart series={payoff} showStockOnly={false} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Returns &amp; risk</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <Metric label="Premium income" value={formatCurrency(reassessed.premiumIncome, 0)} />
              <Metric label="Gross collateral" value={formatCurrency(reassessed.grossCollateral, 0)} />
              <Metric label="Net capital at risk" value={formatCurrency(reassessed.netCapitalAtRisk, 0)} />
              <Metric label="Return on gross" value={formatPercent(reassessed.returnOnGrossCollateral)} />
              <Metric label="Return on net capital" value={formatPercent(reassessed.returnOnNetCapital)} />
              <Metric label="Annualized (net)*" value={formatPercent(reassessed.annualizedReturnOnNet)} />
              <Metric label="Effective purchase price" value={formatCurrency(reassessed.effectivePurchasePrice)} tone="profit" />
              <Metric label="Break-even" value={formatCurrency(reassessed.breakEven)} />
              <Metric label="Discount to current" value={formatPercent(reassessed.discountToCurrentPrice, 1)} />
              <Metric
                label="Delta / assign. prob."
                value={`${formatNumber(reassessed.delta, 2)} / ${formatPercent(assignment.compositeProbability ?? 0)}`}
                title={`Put to you estimate: ${formatPercent(assignment.compositeProbability ?? 0, 0)}\nHistorical: ${assignment.historicalProbability != null ? formatPercent(assignment.historicalProbability, 0) : "—"}\nVol model: ${assignment.monteCarloProbability != null ? formatPercent(assignment.monteCarloProbability, 0) : "—"}\nWindows tested: ${assignment.sampleSize}`}
              />
              <Metric label="IV" value={formatPercent(reassessed.impliedVolatility)} />
              <Metric label="Premium per day" value={formatCurrency(reassessed.premiumPerDay, 2)} />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">Score breakdown</CardTitle>
            <Badge variant={reassessed.score.total >= 70 ? "profit" : reassessed.score.total >= 50 ? "warning" : "loss"}>
              Score: {reassessed.score.total}/100
            </Badge>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
            <ScoreCell label="Income" v={reassessed.score.income} />
            <ScoreCell label="Entry Quality" v={reassessed.score.entryQuality} />
            <ScoreCell label="Assign. Risk" v={reassessed.score.assignmentRisk} />
            <ScoreCell label="Liquidity" v={reassessed.score.liquidity} />
            <ScoreCell label="Vol Premium" v={reassessed.score.volatilityPremium} />
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          * Annualized rates are comparison tools only. Assignment would expose you to the same downside as owning shares from the effective entry price downward.
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
