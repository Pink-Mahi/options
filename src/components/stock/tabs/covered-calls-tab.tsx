"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, Input, Label, Select } from "@/components/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExpirationPicker } from "@/components/stock/expiration-picker";
import { useOptionChain } from "@/components/stock/use-option-chain";
import { CoveredCallDetail } from "@/components/stock/covered-call-detail";
import { FieldWithHelp, TableHeadWithHelp, EXPLAINERS } from "@/components/stock/field-with-help";
import { scanCoveredCalls } from "@/features/options/scanner";
import { calculateAssignmentProbability, type AssignmentProbability } from "@/lib/calculations/historical";
import { cn, formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import type { CoveredCallCandidate, OptionChain, ScannerObjective } from "@/lib/types";
import type { StockData } from "@/features/options/stock-data";
import type { Portfolio } from "@/lib/types";

const OBJECTIVES: { value: ScannerObjective; label: string; description: string }[] = [
  { value: "balanced_income_upside", label: "Balanced income + upside", description: "Shows all calls that pass your filters, ranked by a balance of income and upside." },
  { value: "max_immediate_income", label: "Max immediate income", description: "Only shows calls with ≥ 0.5% premium yield, ranked by highest income." },
  { value: "max_annualized_premium", label: "Max annualized premium", description: "Only shows calls with ≥ 10% annualized yield, favoring short-dated high-theta calls." },
  { value: "max_total_return", label: "Max total return", description: "Only shows calls with positive max total return (premium + stock upside to strike)." },
  { value: "max_upside_retained", label: "Max upside retained", description: "Only shows calls ≥ 3% OTM with delta ≤ 0.35, keeping most of the stock's upside." },
  { value: "lowest_assignment_probability", label: "Lowest assignment risk", description: "Only shows calls with delta ≤ 0.25 (very low assignment probability)." },
  { value: "leaps_income_growth", label: "LEAPS income + growth", description: "Only shows calls with ≥ 180 days to expiration. Auto-switches to the nearest ≥ 180 DTE expiration." },
  { value: "long_term_tax_aware", label: "Long-term / tax-aware", description: "Only shows calls with ≥ 365 days to expiration. Auto-switches to the nearest ≥ 365 DTE expiration." },
];

/** Minimum DTE implied by each objective. When the objective changes, the
 * expiration auto-switches to the nearest one that meets this minimum.
 * Objectives not listed here don't require a specific DTE. */
const OBJECTIVE_MIN_DTE: Partial<Record<ScannerObjective, number>> = {
  leaps_income_growth: 180,
  long_term_tax_aware: 365,
};

export function CoveredCallsTab({
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
  const { data: chainData, error, loading } = useOptionChain(data.symbol, expiration);
  const position = portfolio?.stockLots.find((l) => l.symbol === data.symbol) ?? null;
  const goal = portfolio?.goals[0] ?? null;

  const [objective, setObjective] = useState<ScannerObjective>("balanced_income_upside");
  // UI fields store percentages as whole numbers (5 = 5%, 1 = 1%, 30 = 30%).
  // Converted to decimals (0.05, 0.01, 0.30) when passed to the scanner.
  const [minOtm, setMinOtm] = useState<number | "">((goal?.minimumOTMPercent ?? 0.05) * 100);
  const [maxDelta, setMaxDelta] = useState<number | "">((goal?.maximumDelta ?? 0.3) * 100);
  const [minYield, setMinYield] = useState<number | "">((goal?.minimumPremiumYield ?? 0) * 100);
  const [minAnnualizedYield, setMinAnnualizedYield] = useState<number | "">("");
  const [excludeEarnings, setExcludeEarnings] = useState(true);
  const [minOi, setMinOi] = useState<number | "">(0);
  const [selected, setSelected] = useState<CoveredCallCandidate | null>(null);

  const sharesAvailable = position ? position.shares : 100;

  // When the objective implies a specific DTE range, auto-switch the expiration
  // to the nearest one that fits. This prevents the confusing case where the user
  // picks "LEAPS income + growth" but has a 2-DTE expiration selected (which would
  // show zero results).
  useEffect(() => {
    if (!data.expirations.length) return;
    const minDte = OBJECTIVE_MIN_DTE[objective];
    if (minDte == null) return; // objective doesn't require a specific DTE
    const current = data.expirations.find((e) => e.expirationDate === expiration);
    if (current && current.daysToExpiration >= minDte) return; // already suitable
    // Find the nearest expiration that meets the minimum DTE.
    const suitable = data.expirations
      .filter((e) => e.daysToExpiration >= minDte)
      .sort((a, b) => a.daysToExpiration - b.daysToExpiration);
    if (suitable.length > 0 && suitable[0]) {
      onExpirationChange(suitable[0].expirationDate);
    }
  }, [objective, data.expirations, expiration, onExpirationChange]);

  const candidates = useMemo<CoveredCallCandidate[]>(() => {
    if (!chainData) return [];
    return scanCoveredCalls(
      chainData.chain,
      {
        symbol: data.symbol,
        sharesAvailable,
        costBasisPerShare: position?.costBasisPerShare ?? null,
        minDte: null,
        maxDte: null,
        minOtmPercent: typeof minOtm === "number" ? minOtm / 100 : null,
        maxOtmPercent: null,
        minDelta: null,
        maxDelta: typeof maxDelta === "number" ? maxDelta / 100 : null,
        minPremiumPerContract: null,
        minPremiumYield: typeof minYield === "number" ? minYield / 100 : null,
        minAnnualizedPremiumYield: typeof minAnnualizedYield === "number" ? minAnnualizedYield / 100 : null,
        minMaxTotalReturn: null,
        minAnnualizedMaxTotalReturn: null,
        minHistoricalProbabilityBelowStrike: null,
        requireStrikeAboveCostBasis: false,
        requireStrikeAboveTargetPrice: null,
        excludeEarnings,
        excludeDividends: false,
        liquidity: {
          minOpenInterest: typeof minOi === "number" ? minOi : null,
          minVolume: null,
          maxBidAskSpreadPercent: null,
        },
        objective,
      },
      chainData.events?.earnings[0]?.date ?? null,
      chainData.events?.dividends[0]?.exDate ?? null,
    );
  }, [chainData, data.symbol, sharesAvailable, position, minOtm, maxDelta, minYield, minAnnualizedYield, excludeEarnings, minOi, objective]);

  const candidatesWithAssignment = useMemo(() => {
    return candidates.map((c) => ({
      candidate: c,
      assignment: calculateAssignmentProbability(
        data.historical.points,
        c.contract.daysToExpiration,
        data.quote.price,
        c.contract.strike,
        c.contract.greeks.delta,
      ),
    }));
  }, [candidates, data.historical.points, data.quote.price]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Covered call scanner</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ExpirationPicker expirations={data.expirations} value={expiration} onChange={onExpirationChange} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FieldWithHelp label="Objective" help={EXPLAINERS.objective}>
              <Select value={objective} onChange={(e) => setObjective(e.target.value as ScannerObjective)}>
                {OBJECTIVES.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </FieldWithHelp>
            <FieldWithHelp label="Min OTM %" help={EXPLAINERS.minOtmPercent}>
              <Input type="number" min={0} step="0.5" value={minOtm} onChange={(e) => setMinOtm(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))} />
            </FieldWithHelp>
            <FieldWithHelp label="Max Delta %" help={EXPLAINERS.maxDelta}>
              <Input type="number" min={0} max={100} step="1" value={maxDelta} onChange={(e) => setMaxDelta(e.target.value === "" ? "" : Math.min(100, Math.max(0, Number(e.target.value))))} />
            </FieldWithHelp>
            <FieldWithHelp label="Min Premium Yield %" help={EXPLAINERS.minPremiumYield}>
              <Input type="number" min={0} step="0.1" value={minYield} onChange={(e) => setMinYield(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))} />
            </FieldWithHelp>
            <FieldWithHelp label="Min Ann. Yield %" help={EXPLAINERS.minAnnualizedPremiumYield}>
              <Input type="number" min={0} step="1" placeholder="e.g. 12" value={minAnnualizedYield} onChange={(e) => setMinAnnualizedYield(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))} />
            </FieldWithHelp>
            <FieldWithHelp label="Min Open Interest" help={EXPLAINERS.minOpenInterest}>
              <Input type="number" min={0} value={minOi} onChange={(e) => setMinOi(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))} />
            </FieldWithHelp>
            <FieldWithHelp label="Exclude earnings" help={EXPLAINERS.excludeEarnings}>
              <Select value={excludeEarnings ? "yes" : "no"} onChange={(e) => setExcludeEarnings(e.target.value === "yes")}>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            </FieldWithHelp>
            <Field label="Shares available">
              <Input value={sharesAvailable} disabled />
            </Field>
          </div>
          {position && (
            <p className="text-xs text-muted-foreground">
              Using your position: {position.shares} shares @ {formatCurrency(position.costBasisPerShare)} cost basis.
              {!position.protectedFromCalls ? "" : " This lot is marked protected from calls."}
            </p>
          )}
          {!position && (
            <p className="text-xs text-muted-foreground">
              No position found — assuming 100 shares for analysis. Add the holding in Portfolio for personalized calculations.
            </p>
          )}
        </CardContent>
      </Card>

      {chainData && candidates.length > 0 && (
        <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{OBJECTIVES.find((o) => o.value === objective)?.label}: </span>
          {OBJECTIVES.find((o) => o.value === objective)?.description}
        </div>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            Ranked candidates {chainData && <span className="text-muted-foreground">({candidates.length})</span>}
          </CardTitle>
          {chainData && (
            <Badge variant="outline">
              {chainData.fromCache ? "cached" : "fresh"} · {chainData.dataQuality}
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted-foreground">Loading option chain…</p>}
          {error && <p className="text-sm text-loss">Error: {error}</p>}
          {!loading && !error && candidates.length === 0 && (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No covered calls match your filters. This is a valid result — try widening OTM, delta, or yield constraints.
            </div>
          )}
          {candidates.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Strike</TableHead>
                    <TableHeadWithHelp label="OTM %" help={EXPLAINERS.otmPercent} />
                    <TableHead>Premium</TableHead>
                    <TableHeadWithHelp label="Yield" help={EXPLAINERS.premiumYield} />
                    <TableHeadWithHelp label="Ann. Yield" help={EXPLAINERS.annualizedYield} />
                    <TableHeadWithHelp label="Max Tot. Ret." help={EXPLAINERS.maxTotalReturn} />
                    <TableHeadWithHelp label="Ann. MTR" help={EXPLAINERS.annualizedMtr} />
                    <TableHeadWithHelp label="Delta" help={EXPLAINERS.delta} />
                    <TableHeadWithHelp label="Called away %" help={EXPLAINERS.calledAway} />
                    <TableHeadWithHelp label="IV" help={EXPLAINERS.iv} />
                    <TableHeadWithHelp label="Liq" help={EXPLAINERS.liqScore} />
                    <TableHeadWithHelp label="Score" help={EXPLAINERS.score} />
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {candidatesWithAssignment.slice(0, 25).map(({ candidate: c, assignment }) => (
                    <TableRow
                      key={c.contract.symbol}
                      className={cn("cursor-pointer", selected?.contract.symbol === c.contract.symbol && "bg-muted")}
                      onClick={() => setSelected(c)}
                    >
                      <TableCell className="font-medium">{formatCurrency(c.contract.strike, 0)}</TableCell>
                      <TableCell>{formatPercent(c.strikeOtmPercent, 1)}</TableCell>
                      <TableCell>{formatCurrency(c.premiumPerContract, 0)}</TableCell>
                      <TableCell>{formatPercent(c.premiumYield)}</TableCell>
                      <TableCell>{formatPercent(c.annualizedPremiumYield)}</TableCell>
                      <TableCell className="font-medium text-profit">{formatPercent(c.maxTotalReturn, 1)}</TableCell>
                      <TableCell>{formatPercent(c.annualizedMaxTotalReturn)}</TableCell>
                      <TableCell>{formatNumber(c.delta, 2)}</TableCell>
                      <TableCell>
                        <span className={cn(
                          "tabular font-medium",
                          (assignment.compositeProbability ?? 0) > 0.5 ? "text-loss" : (assignment.compositeProbability ?? 0) > 0.25 ? "text-warning" : "text-profit"
                        )} title={calledAwayTooltip(c, assignment)}>
                          {formatPercent(assignment.compositeProbability ?? 0, 0)}
                        </span>
                      </TableCell>
                      <TableCell>{formatPercent(c.impliedVolatility)}</TableCell>
                      <TableCell>
                        <Badge variant={c.liquidityScore >= 60 ? "profit" : c.liquidityScore >= 30 ? "warning" : "loss"}>
                          {c.liquidityScore}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={c.score.total >= 70 ? "profit" : c.score.total >= 50 ? "warning" : "loss"}>
                          {c.score.total}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setSelected(c); }}>
                          Analyze
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {selected && (
        <CoveredCallDetail
          candidate={selected}
          costBasisPerShare={position?.costBasisPerShare ?? null}
          currentPrice={data.quote.price}
          points={data.historical.points}
          earningsDate={chainData?.events?.earnings[0]?.date ?? null}
          exDividendDate={chainData?.events?.dividends[0]?.exDate ?? null}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function calledAwayTooltip(candidate: CoveredCallCandidate, assignment: AssignmentProbability): string {
  return `Called away estimate: ${formatPercent(assignment.compositeProbability ?? 0, 0)}\n` +
    `Historical: ${assignment.historicalProbability != null ? formatPercent(assignment.historicalProbability, 0) : "—"}\n` +
    `Vol model: ${assignment.monteCarloProbability != null ? formatPercent(assignment.monteCarloProbability, 0) : "—"}\n` +
    `Delta proxy: ${formatPercent(assignment.deltaProxy ?? 0, 0)}\n` +
    `Windows tested: ${assignment.sampleSize}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
