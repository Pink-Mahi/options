"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { scanCoveredCalls } from "@/features/options/scanner";
import { calculateAssignmentProbability, type AssignmentProbability } from "@/lib/calculations/historical";
import { cn, formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import type { CoveredCallCandidate, OptionChain, ScannerObjective } from "@/lib/types";
import type { StockData } from "@/features/options/stock-data";

const BUCKETS = [
  { label: "30 DTE", targetDte: 30 },
  { label: "45 DTE", targetDte: 45 },
  { label: "90 DTE", targetDte: 90 },
  { label: "180 DTE", targetDte: 180 },
  { label: "365 DTE", targetDte: 365 },
  { label: "LEAP (longest)", targetDte: 730 },
];

export function ComparisonTab({ data }: { data: StockData }) {
  const [objective, setObjective] = useState<ScannerObjective>("balanced_income_upside");
  const [chains, setChains] = useState<Record<string, OptionChain | null>>({});
  const [loading, setLoading] = useState(true);

  // Pick one representative expiration per bucket (closest to target DTE).
  const bucketExpirations = useMemo(() => {
    return BUCKETS.map((b) => {
      const sorted = [...data.expirations].sort(
        (a, c) => Math.abs(a.daysToExpiration - b.targetDte) - Math.abs(c.daysToExpiration - b.targetDte),
      );
      const pick = sorted[0];
      return { ...b, expiration: pick?.expirationDate ?? null, dte: pick?.daysToExpiration ?? 0 };
    });
  }, [data.expirations]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(
      bucketExpirations.map(async (b) => {
        if (!b.expiration) return { key: b.label, chain: null };
        try {
          const res = await fetch(
            `/api/stock/${encodeURIComponent(data.symbol)}/chain?expiration=${encodeURIComponent(b.expiration)}`,
            { cache: "no-store" },
          );
          if (!res.ok) return { key: b.label, chain: null };
          const body = await res.json();
          return { key: b.label, chain: body.chain as OptionChain };
        } catch {
          return { key: b.label, chain: null };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const map: Record<string, OptionChain | null> = {};
      for (const r of results) map[r.key] = r.chain;
      setChains(map);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [bucketExpirations, data.symbol]);

  const rows = useMemo(() => {
    return bucketExpirations.map((b) => {
      const chain = chains[b.label];
      if (!chain) return { ...b, candidate: null, assignment: null };
      const candidates = scanCoveredCalls(
        chain,
        {
          symbol: data.symbol,
          sharesAvailable: 100,
          costBasisPerShare: null,
          minDte: null,
          maxDte: null,
          minOtmPercent: 0.05,
          maxOtmPercent: null,
          minDelta: null,
          maxDelta: 0.4,
          minPremiumPerContract: null,
          minPremiumYield: null,
          minAnnualizedPremiumYield: null,
          minMaxTotalReturn: null,
          minAnnualizedMaxTotalReturn: null,
          minHistoricalProbabilityBelowStrike: null,
          requireStrikeAboveCostBasis: false,
          requireStrikeAboveTargetPrice: null,
          excludeEarnings: false,
          excludeDividends: false,
          liquidity: { minOpenInterest: null, minVolume: null, maxBidAskSpreadPercent: null },
          objective,
        },
      );
      const candidate = candidates[0] ?? null;
      const assignment = candidate
        ? calculateAssignmentProbability(
            data.historical.points,
            candidate.contract.daysToExpiration,
            data.quote.price,
            candidate.contract.strike,
            candidate.contract.greeks.delta,
          )
        : null;
      return { ...b, candidate, assignment };
    });
  }, [bucketExpirations, chains, data.symbol, objective, data.historical.points, data.quote.price]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Short-term vs LEAPS comparison</CardTitle>
          <Select value={objective} onChange={(e) => setObjective(e.target.value as ScannerObjective)} className="w-auto">
            <option value="balanced_income_upside">Balanced</option>
            <option value="max_total_return">Max total return</option>
            <option value="max_annualized_premium">Max annualized premium</option>
            <option value="leaps_income_growth">LEAPS income + growth</option>
          </Select>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            Picks the best-ranked call near each DTE bucket. Compares premium income against the stock appreciation
            you would surrender. Annualized rates are comparison tools only, not expected returns.
          </p>
          <p className="mb-3 text-xs text-muted-foreground">
            <strong>Called away %</strong> is an estimated probability your shares would be assigned if the stock is above the strike at expiration.
            It blends rolling historical returns with a lognormal volatility model. Delta is used as a fallback when history is insufficient.
            This is descriptive, not a guarantee.
          </p>
          {loading && <p className="text-sm text-muted-foreground">Loading chains…</p>}
          {!loading && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bucket</TableHead>
                    <TableHead>Expiration</TableHead>
                    <TableHead>DTE</TableHead>
                    <TableHead>Strike</TableHead>
                    <TableHead>OTM %</TableHead>
                    <TableHead>Delta</TableHead>
                    <TableHead>Premium</TableHead>
                    <TableHead>Premium %</TableHead>
                    <TableHead>Ann. Prem %</TableHead>
                    <TableHead>Appreciation</TableHead>
                    <TableHead>Max Tot Ret</TableHead>
                    <TableHead>Ann. MTR</TableHead>
                    <TableHead>Called away %</TableHead>
                    <TableHead>Score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.label}>
                      <TableCell className="font-medium">{r.label}</TableCell>
                      <TableCell>{r.candidate ? r.candidate.contract.expiration : "—"}</TableCell>
                      <TableCell>{r.dte}</TableCell>
                      <TableCell>{r.candidate ? formatCurrency(r.candidate.contract.strike, 0) : "—"}</TableCell>
                      <TableCell>{r.candidate ? formatPercent(r.candidate.strikeOtmPercent, 1) : "—"}</TableCell>
                      <TableCell>{r.candidate ? formatNumber(r.candidate.delta, 2) : "—"}</TableCell>
                      <TableCell>{r.candidate ? formatCurrency(r.candidate.premiumPerContract, 0) : "—"}</TableCell>
                      <TableCell>{r.candidate ? formatPercent(r.candidate.premiumYield) : "—"}</TableCell>
                      <TableCell>{r.candidate ? formatPercent(r.candidate.annualizedPremiumYield) : "—"}</TableCell>
                      <TableCell className="text-profit">{r.candidate ? formatPercent(r.candidate.potentialStockAppreciation, 1) : "—"}</TableCell>
                      <TableCell className={cn("font-medium", r.candidate && "text-profit")}>{r.candidate ? formatPercent(r.candidate.maxTotalReturn, 1) : "—"}</TableCell>
                      <TableCell>{r.candidate ? formatPercent(r.candidate.annualizedMaxTotalReturn) : "—"}</TableCell>
                      <TableCell>
                        {r.candidate && r.assignment ? (
                          <span className="group relative inline-block">
                            <span className={cn(
                              "tabular font-medium",
                              (r.assignment.compositeProbability ?? 0) > 0.5 ? "text-loss" : (r.assignment.compositeProbability ?? 0) > 0.25 ? "text-warning" : "text-profit"
                            )}>
                              {formatPercent(r.assignment.compositeProbability ?? 0, 0)}
                            </span>
                            <AssignmentTooltip assignment={r.assignment} candidate={r.candidate} />
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        {r.candidate ? (
                          <Badge variant={r.candidate.score.total >= 70 ? "profit" : r.candidate.score.total >= 50 ? "warning" : "loss"}>
                            {r.candidate.score.total}
                          </Badge>
                        ) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {!loading && rows.some((r) => r.candidate) && (
            <div className="mt-3 rounded-md border bg-muted/40 p-3 text-sm">
              <p className="font-medium">Opportunity-cost readout</p>
              {rows.filter((r) => r.candidate).length >= 2 && (
                <OpportunityCostReadout rows={rows.filter((r) => r.candidate).map((r) => r.candidate!) as CoveredCallCandidate[]} />
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AssignmentTooltip({ assignment, candidate }: { assignment: AssignmentProbability | null; candidate: CoveredCallCandidate | null }) {
  if (!assignment || !candidate) return null;
  return (
    <div className="absolute left-0 top-full z-10 mt-1 hidden w-64 rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-md group-hover:block">
      <div className="space-y-1">
        <div className="flex justify-between"><span className="text-muted-foreground">Composite</span><span className="font-medium">{formatPercent(assignment.compositeProbability ?? 0, 0)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Historical</span><span>{assignment.historicalProbability != null ? formatPercent(assignment.historicalProbability, 0) : "—"}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Vol model</span><span>{assignment.monteCarloProbability != null ? formatPercent(assignment.monteCarloProbability, 0) : "—"}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Delta proxy</span><span>{formatPercent(assignment.deltaProxy ?? 0, 0)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Windows tested</span><span>{assignment.sampleSize}</span></div>
      </div>
      {assignment.warnings.map((w, i) => (
        <div key={i} className="mt-1 text-amber-600 dark:text-amber-400">{w}</div>
      ))}
      <div className="mt-1 text-muted-foreground">Strike {formatCurrency(candidate.contract.strike)} with DTE {candidate.contract.daysToExpiration}.</div>
    </div>
  );
}

function OpportunityCostReadout({ rows }: { rows: CoveredCallCandidate[] }) {
  // Compare the shortest-DTE candidate vs the longest-DTE candidate.
  const sorted = [...rows].sort((a, b) => a.contract.daysToExpiration - b.contract.daysToExpiration);
  const short = sorted[0];
  const long = sorted[sorted.length - 1];
  if (!short || !long || short === long) return null;
  const extraPremium = short.premiumPerShare - long.premiumPerShare;
  const extraUpsideSurrendered = long.contract.strike - short.contract.strike;
  return (
    <p className="mt-1 text-muted-foreground">
      The {short.contract.daysToExpiration}-DTE call pays{" "}
      <span className={cn("font-medium", extraPremium >= 0 ? "text-profit" : "text-loss")}>
        {extraPremium >= 0 ? "extra" : "less"} {formatCurrency(Math.abs(extraPremium))}/share
      </span>{" "}
      in premium versus the {long.contract.daysToExpiration}-DTE call, but surrenders{" "}
      <span className="font-medium text-loss">{formatCurrency(Math.abs(extraUpsideSurrendered))}/share</span>{" "}
      of additional upside. Choosing the longer call preserves more appreciation for a longer commitment.
    </p>
  );
}
