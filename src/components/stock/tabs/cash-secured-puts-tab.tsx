"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, Input, Label, Select } from "@/components/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExpirationPicker } from "@/components/stock/expiration-picker";
import { useOptionChain } from "@/components/stock/use-option-chain";
import { CashSecuredPutDetail } from "@/components/stock/cash-secured-put-detail";
import { FieldWithHelp, TableHeadWithHelp, EXPLAINERS } from "@/components/stock/field-with-help";
import { StrategyPresetSelector } from "@/components/stock/strategy-preset-selector";
import { scanCashSecuredPuts } from "@/features/options/scanner";
import { calculateAssignmentProbability, type AssignmentProbability } from "@/lib/calculations/historical";
import { cn, formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import type { CashSecuredPutCandidate, ScannerObjective } from "@/lib/types";
import type { StockData } from "@/features/options/stock-data";
import type { Portfolio } from "@/lib/types";

export function CashSecuredPutsTab({
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
  const [targetEntry, setTargetEntry] = useState<number | "">("");
  // UI fields store percentages as whole numbers (5 = 5%, 35 = 35%).
  // Converted to decimals when passed to the scanner.
  const [maxDelta, setMaxDelta] = useState<number | "">(35);
  const [minDiscount, setMinDiscount] = useState<number | "">(5);
  const [cash, setCash] = useState<number | "">(portfolio?.cashAvailable || 10000);
  const [excludeEarnings, setExcludeEarnings] = useState(true);
  const [selected, setSelected] = useState<CashSecuredPutCandidate | null>(null);

  const candidates = useMemo<CashSecuredPutCandidate[]>(() => {
    if (!chainData) return [];
    return scanCashSecuredPuts(
      chainData.chain,
      {
        symbol: data.symbol,
        cashAvailable: typeof cash === "number" ? cash : 0,
        minDte: null,
        maxDte: null,
        maxDelta: typeof maxDelta === "number" ? maxDelta / 100 : null,
        minDelta: null,
        targetEffectivePurchasePrice: typeof targetEntry === "number" ? targetEntry : null,
        minDiscountPercent: typeof minDiscount === "number" ? minDiscount / 100 : null,
        minPremiumYield: null,
        minAnnualizedYield: null,
        maxCapitalRequired: null,
        minIvPercentile: null,
        excludeEarnings,
        liquidity: { minOpenInterest: null, minVolume: null, maxBidAskSpreadPercent: null },
        objective: "cash_secured_put_entry",
      },
      chainData.events?.earnings[0]?.date ?? null,
      chainData.events?.dividends[0]?.exDate ?? null,
    );
  }, [chainData, data.symbol, cash, maxDelta, targetEntry, minDiscount, excludeEarnings]);

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
        <CardHeader><CardTitle className="text-base">Cash-secured put scanner</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <ExpirationPicker expirations={data.expirations} value={expiration} onChange={onExpirationChange} />
            <StrategyPresetSelector
              strategyType="CASH_SECURED_PUT"
              currentFilters={{
                minDelta: 0,
                maxDelta: typeof maxDelta === "number" ? maxDelta / 100 : 1,
                minDte: 0,
                maxDte: 365,
                minYieldPct: 0,
                minOtmPercent: 0,
                minDiscountPct: typeof minDiscount === "number" ? minDiscount : 0,
                excludeEarnings,
              }}
              onApply={(p) => {
                setMaxDelta(Math.round(p.maxDelta * 100));
                setMinDiscount(p.minDiscountPct);
                setExcludeEarnings(p.excludeEarnings);
                if (data.expirations.length > 0) {
                  const suitable = data.expirations
                    .filter((e) => e.daysToExpiration >= p.minDte && e.daysToExpiration <= p.maxDte)
                    .sort((a, b) => Math.abs(a.daysToExpiration - (p.minDte + p.maxDte) / 2) - Math.abs(b.daysToExpiration - (p.minDte + p.maxDte) / 2));
                  if (suitable[0]) onExpirationChange(suitable[0].expirationDate);
                }
              }}
              onSave={() => {}}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FieldWithHelp label="Target effective entry ($)" help={EXPLAINERS.targetEntry}>
              <Input type="number" min={0} step="0.01" placeholder="optional" value={targetEntry} onChange={(e) => setTargetEntry(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))} />
            </FieldWithHelp>
            <FieldWithHelp label="Max Delta %" help={EXPLAINERS.maxDelta}>
              <Input type="number" min={0} max={100} step="1" value={maxDelta} onChange={(e) => setMaxDelta(e.target.value === "" ? "" : Math.min(100, Math.max(0, Number(e.target.value))))} />
            </FieldWithHelp>
            <FieldWithHelp label="Min discount %" help={EXPLAINERS.minDiscountPercent}>
              <Input type="number" min={0} step="0.5" value={minDiscount} onChange={(e) => setMinDiscount(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))} />
            </FieldWithHelp>
            <FieldWithHelp label="Cash available ($)" help={EXPLAINERS.cashAvailable}>
              <Input type="number" min={0} value={cash} onChange={(e) => setCash(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))} />
            </FieldWithHelp>
            <FieldWithHelp label="Exclude earnings" help={EXPLAINERS.excludeEarnings}>
              <Select value={excludeEarnings ? "yes" : "no"} onChange={(e) => setExcludeEarnings(e.target.value === "yes")}>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            </FieldWithHelp>
          </div>
          <p className="text-xs text-muted-foreground">
            Effective entry = strike − premium. The scanner treats this as the important value, not strike alone.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Ranked puts {chainData && <span className="text-muted-foreground">({candidates.length})</span>}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted-foreground">Loading option chain…</p>}
          {error && <p className="text-sm text-loss">Error: {error}</p>}
          {!loading && !error && candidates.length === 0 && (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No cash-secured puts match your filters. This is a valid result.
            </div>
          )}
          {candidates.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Strike</TableHead>
                    <TableHeadWithHelp label="Disc %" help={EXPLAINERS.discountPercent} />
                    <TableHead>Premium</TableHead>
                    <TableHeadWithHelp label="Eff. Entry" help={EXPLAINERS.effectiveEntry} />
                    <TableHeadWithHelp label="Eff. Disc %" help={EXPLAINERS.effectiveDiscount} />
                    <TableHeadWithHelp label="Ret. (net)" help={EXPLAINERS.returnOnNetCapital} />
                    <TableHeadWithHelp label="Ann. Ret." help={EXPLAINERS.annualizedReturn} />
                    <TableHeadWithHelp label="Delta" help={EXPLAINERS.delta} />
                    <TableHeadWithHelp label="Put to you %" help={EXPLAINERS.calledAway} />
                    <TableHeadWithHelp label="IV" help={EXPLAINERS.iv} />
                    <TableHeadWithHelp label="Collateral" help={EXPLAINERS.collateral} />
                    <TableHeadWithHelp label="Score" help={EXPLAINERS.score} />
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {candidatesWithAssignment.slice(0, 25).map(({ candidate: c, assignment }) => (
                    <TableRow key={c.contract.symbol} className={cn("cursor-pointer", selected?.contract.symbol === c.contract.symbol && "bg-muted")} onClick={() => setSelected(c)}>
                      <TableCell className="font-medium">{formatCurrency(c.contract.strike, 0)}</TableCell>
                      <TableCell>{formatPercent(c.strikeDiscountPercent, 1)}</TableCell>
                      <TableCell>{formatCurrency(c.premiumPerContract, 0)}</TableCell>
                      <TableCell className="font-medium text-profit">{formatCurrency(c.effectivePurchasePrice)}</TableCell>
                      <TableCell>{formatPercent(c.discountToCurrentPrice, 1)}</TableCell>
                      <TableCell>{formatPercent(c.returnOnNetCapital)}</TableCell>
                      <TableCell>{formatPercent(c.annualizedReturnOnNet)}</TableCell>
                      <TableCell>{formatNumber(c.delta, 2)}</TableCell>
                      <TableCell>
                        <span className={cn(
                          "tabular font-medium",
                          (assignment.compositeProbability ?? 0) > 0.5 ? "text-loss" : (assignment.compositeProbability ?? 0) > 0.25 ? "text-warning" : "text-profit"
                        )} title={putTooltip(assignment)}>
                          {formatPercent(assignment.compositeProbability ?? 0, 0)}
                        </span>
                      </TableCell>
                      <TableCell>{formatPercent(c.impliedVolatility)}</TableCell>
                      <TableCell>{formatCurrency(c.grossCollateral, 0)}</TableCell>
                      <TableCell><Badge variant={c.score.total >= 70 ? "profit" : c.score.total >= 50 ? "warning" : "loss"}>{c.score.total}</Badge></TableCell>
                      <TableCell><Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setSelected(c); }}>Analyze</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {selected && (
        <CashSecuredPutDetail
          candidate={selected}
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

function putTooltip(assignment: AssignmentProbability): string {
  return `Put to you estimate: ${formatPercent(assignment.compositeProbability ?? 0, 0)}\n` +
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
