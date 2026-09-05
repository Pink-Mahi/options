"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, Input, Label } from "@/components/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import type { PortfolioIncomeAnalysis } from "@/features/portfolio/income-planner";

interface Summary {
  stockValue: number;
  totalCost: number;
  unrealized: number;
  lotCount: number;
  symbolCount: number;
  openOptions: number;
  goal: { monthlyIncomeTarget?: number | null } | null;
}

export function IncomePlannerView({
  initialAnalysis,
  summary,
}: {
  initialAnalysis: PortfolioIncomeAnalysis;
  summary: Summary | null;
}) {
  const [target, setTarget] = useState<number | "">(initialAnalysis.monthlyTarget);
  const [analysis, setAnalysis] = useState<PortfolioIncomeAnalysis>(initialAnalysis);
  const [pending, startTransition] = useTransition();

  function recalc() {
    const t = typeof target === "number" ? target : 0;
    startTransition(async () => {
      const res = await fetch("/api/portfolio/income-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlyTarget: t }),
        cache: "no-store",
      });
      if (res.ok) setAnalysis(await res.json());
    });
  }

  const feasibilityVariant: Record<PortfolioIncomeAnalysis["feasibility"], "profit" | "warning" | "loss" | "secondary"> = {
    easily_supported: "profit",
    potentially_achievable: "warning",
    requires_relaxing: "loss",
    not_supported: "loss",
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Income planner</h1>
        <p className="text-sm text-muted-foreground">
          Estimates how your holdings and available cash could contribute toward a monthly income target.
          All amounts are estimates from deterministic scanners — never guaranteed income.
        </p>
      </div>

      {summary && (
        <div className="grid gap-4 sm:grid-cols-4">
          <Stat label="Stock value" value={formatCurrency(summary.stockValue, 0)} />
          <Stat label="Total cost basis" value={formatCurrency(summary.totalCost, 0)} />
          <Stat label="Unrealized P/L" value={formatCurrency(summary.unrealized, 0)} tone={summary.unrealized >= 0 ? "profit" : "loss"} />
          <Stat label="Open options" value={`${summary.openOptions}`} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly income target</CardTitle>
          <CardDescription>The planner estimates feasibility from current opportunities under your saved goals/filters.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Target ($/month)</Label>
              <Input type="number" value={target} onChange={(e) => setTarget(e.target.value === "" ? "" : Number(e.target.value))} className="w-40" />
            </div>
            <Button onClick={recalc} disabled={pending}>{pending ? "Calculating…" : "Recalculate"}</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Estimated achievable" value={formatCurrency(analysis.estimatedFeasibleIncome, 0)} tone="profit" />
            <Stat label="Target gap" value={formatCurrency(analysis.targetGap, 0)} tone={analysis.targetGap <= 0 ? "profit" : "loss"} />
            <div className="rounded-lg border p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Feasibility</div>
              <div className="mt-1"><Badge variant={feasibilityVariant[analysis.feasibility]}>{analysis.feasibility.replace(/_/g, " ")}</Badge></div>
            </div>
          </div>
          <p className="text-sm">{analysis.classification}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Covered call candidates from your holdings</CardTitle></CardHeader>
        <CardContent>
          {analysis.coveredCallCandidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No covered calls met your filters. Add holdings in{" "}
              <Link href="/portfolio" className="underline">Portfolio</Link> or relax OTM/delta/DTE goals.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Contracts</TableHead>
                  <TableHead>Strike</TableHead>
                  <TableHead>Expiration</TableHead>
                  <TableHead>Est. premium</TableHead>
                  <TableHead>Premium yield</TableHead>
                  <TableHead>Max total ret.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analysis.coveredCallCandidates.map((c, i) => (
                  <TableRow key={`${c.symbol}-${i}`}>
                    <TableCell className="font-medium"><Link href={`/stock/${c.symbol}`} className="hover:underline">{c.symbol}</Link></TableCell>
                    <TableCell>{c.contracts}</TableCell>
                    <TableCell>{c.topStrike ? formatCurrency(c.topStrike, 0) : "—"}</TableCell>
                    <TableCell>{c.expiration ?? "—"}</TableCell>
                    <TableCell className="text-profit font-medium">{formatCurrency(c.expectedPremium, 0)}</TableCell>
                    <TableCell>{c.premiumYield != null ? formatPercent(c.premiumYield) : "—"}</TableCell>
                    <TableCell>{c.maxTotalReturn != null ? formatPercent(c.maxTotalReturn, 1) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Cash-secured put candidates</CardTitle></CardHeader>
        <CardContent>
          {analysis.cashSecuredPutCandidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No CSP candidates under current cash/filters.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Contracts</TableHead>
                  <TableHead>Strike</TableHead>
                  <TableHead>Eff. entry</TableHead>
                  <TableHead>Disc. to current</TableHead>
                  <TableHead>Est. premium</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analysis.cashSecuredPutCandidates.map((c, i) => (
                  <TableRow key={`${c.symbol}-${i}`}>
                    <TableCell className="font-medium"><Link href={`/stock/${c.symbol}`} className="hover:underline">{c.symbol}</Link></TableCell>
                    <TableCell>{c.contracts}</TableCell>
                    <TableCell>{c.topStrike ? formatCurrency(c.topStrike, 0) : "—"}</TableCell>
                    <TableCell className="text-profit">{c.effectiveEntry ? formatCurrency(c.effectiveEntry) : "—"}</TableCell>
                    <TableCell>{c.discountToCurrent != null ? formatPercent(c.discountToCurrent, 1) : "—"}</TableCell>
                    <TableCell className="text-profit font-medium">{formatCurrency(c.expectedPremium, 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {analysis.warnings.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Notes &amp; warnings</CardTitle></CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {analysis.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "profit" | "loss" }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-xl font-bold tabular", tone === "profit" && "text-profit", tone === "loss" && "text-loss")}>{value}</div>
    </div>
  );
}
