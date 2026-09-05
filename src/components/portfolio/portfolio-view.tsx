"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Trash2, Shield, ShieldOff } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, Input, Label, Select } from "@/components/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addStockLot, deleteStockLot, toggleLotProtection, saveGoals } from "@/app/portfolio/actions";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import type { Portfolio, RiskProfile } from "@/lib/types";

const RISK_PROFILES: { value: RiskProfile; label: string }[] = [
  { value: "conservative", label: "Conservative — preserve shares" },
  { value: "balanced", label: "Balanced income + growth" },
  { value: "income", label: "Income focused" },
  { value: "max_total_return", label: "Maximum total return" },
  { value: "leaps", label: "LEAPS income + growth" },
  { value: "put_entry", label: "Cash-secured put entry" },
];

export function PortfolioView({ portfolio }: { portfolio: Portfolio }) {
  const [pending, startTransition] = useTransition();
  const goal = portfolio.goals[0];

  // Add lot form state
  const [symbol, setSymbol] = useState("");
  const [shares, setShares] = useState<number | "">("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [costBasis, setCostBasis] = useState<number | "">("");

  // Goals form state
  const [monthlyIncome, setMonthlyIncome] = useState<number | "">(goal?.monthlyIncomeTarget ?? "");
  const [annualReturn, setAnnualReturn] = useState<number | "">(goal?.annualTotalReturnTarget ?? "");
  const [minOtm, setMinOtm] = useState<number | "">(goal?.minimumOTMPercent ?? 0.15);
  const [maxDelta, setMaxDelta] = useState<number | "">(goal?.maximumDelta ?? 0.25);
  const [dteMin, setDteMin] = useState<number | "">(goal?.preferredDteMin ?? 30);
  const [dteMax, setDteMax] = useState<number | "">(goal?.preferredDteMax ?? 45);
  const [riskProfile, setRiskProfile] = useState<RiskProfile>(goal?.riskProfile ?? "balanced");

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!symbol || shares === "" || !purchaseDate || costBasis === "") return;
    startTransition(async () => {
      await addStockLot({
        symbol,
        shares: Number(shares),
        purchaseDate,
        costBasisPerShare: Number(costBasis),
      });
      setSymbol(""); setShares(""); setPurchaseDate(""); setCostBasis("");
    });
  }

  function handleSaveGoals(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      await saveGoals({
        monthlyIncomeTarget: monthlyIncome === "" ? null : Number(monthlyIncome),
        annualIncomeTarget: monthlyIncome === "" ? null : Number(monthlyIncome) * 12,
        annualTotalReturnTarget: annualReturn === "" ? null : Number(annualReturn) / 100,
        minimumOTMPercent: minOtm === "" ? null : Number(minOtm),
        maximumDelta: maxDelta === "" ? null : Number(maxDelta),
        preferredDteMin: dteMin === "" ? null : Number(dteMin),
        preferredDteMax: dteMax === "" ? null : Number(dteMax),
        riskProfile,
        earningsPreference: "warn",
        dividendPreference: "warn",
      });
    });
  }

  const totalCost = portfolio.stockLots.reduce((s, l) => s + l.totalCostBasis, 0);
  const totalShares = portfolio.stockLots.reduce((s, l) => s + l.shares, 0);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Portfolio</h1>
        <p className="text-sm text-muted-foreground">
          Track holdings with cost basis and purchase dates. Set income goals and strategy preferences.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total lots" value={`${portfolio.stockLots.length}`} />
        <Stat label="Total shares" value={`${totalShares}`} />
        <Stat label="Total cost basis" value={formatCurrency(totalCost, 0)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Holdings</CardTitle>
          <CardDescription>Tax lots with cost basis and purchase dates.</CardDescription>
        </CardHeader>
        <CardContent>
          {portfolio.stockLots.length === 0 ? (
            <p className="text-sm text-muted-foreground">No holdings yet. Add one below.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Shares</TableHead>
                  <TableHead>Cost basis</TableHead>
                  <TableHead>Purchased</TableHead>
                  <TableHead>Total cost</TableHead>
                  <TableHead>Protected</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {portfolio.stockLots.map((lot) => (
                  <TableRow key={lot.id}>
                    <TableCell className="font-medium">
                      <Link href={`/stock/${lot.symbol}`} className="hover:underline">{lot.symbol}</Link>
                    </TableCell>
                    <TableCell>{lot.shares}</TableCell>
                    <TableCell>{formatCurrency(lot.costBasisPerShare)}</TableCell>
                    <TableCell>{lot.purchaseDate}</TableCell>
                    <TableCell>{formatCurrency(lot.totalCostBasis, 0)}</TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => startTransition(() => toggleLotProtection(lot.id, !lot.protectedFromCalls))}
                        aria-label="Toggle protection"
                      >
                        {lot.protectedFromCalls ? <Shield className="h-4 w-4 text-profit" /> : <ShieldOff className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                    </TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-loss" onClick={() => { if (confirm(`Delete ${lot.shares} shares of ${lot.symbol}? This cannot be undone.`)) startTransition(() => deleteStockLot(lot.id)); }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Add holding</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleAdd} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Symbol"><Input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z.]/g, "").slice(0, 5))} placeholder="AAPL" maxLength={5} required /></Field>
                <Field label="Shares"><Input type="number" min={1} step="1" value={shares} onChange={(e) => setShares(e.target.value === "" ? "" : Math.max(1, Number(e.target.value)))} required /></Field>
                <Field label="Cost basis ($/share)"><Input type="number" min={0} step="0.01" value={costBasis} onChange={(e) => setCostBasis(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))} required /></Field>
                <Field label="Purchase date"><Input type="date" max={new Date().toISOString().split("T")[0]!} value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} required /></Field>
              </div>
              <Button type="submit" disabled={pending}>Add lot</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Goals &amp; strategy</CardTitle>
            <CardDescription>Used to pre-fill scanners and (Phase 5) AI context.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveGoals} className="space-y-3">
              <Field label="Monthly income target ($)">
                <Input type="number" value={monthlyIncome} onChange={(e) => setMonthlyIncome(e.target.value === "" ? "" : Number(e.target.value))} placeholder="5000" />
              </Field>
              <Field label="Annual total return target (%)">
                <Input type="number" value={annualReturn} onChange={(e) => setAnnualReturn(e.target.value === "" ? "" : Number(e.target.value))} placeholder="20" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Min OTM %"><Input type="number" step="0.01" value={minOtm} onChange={(e) => setMinOtm(e.target.value === "" ? "" : Number(e.target.value))} /></Field>
                <Field label="Max Delta"><Input type="number" step="0.01" value={maxDelta} onChange={(e) => setMaxDelta(e.target.value === "" ? "" : Number(e.target.value))} /></Field>
                <Field label="Preferred DTE min"><Input type="number" value={dteMin} onChange={(e) => setDteMin(e.target.value === "" ? "" : Number(e.target.value))} /></Field>
                <Field label="Preferred DTE max"><Input type="number" value={dteMax} onChange={(e) => setDteMax(e.target.value === "" ? "" : Number(e.target.value))} /></Field>
              </div>
              <Field label="Risk profile">
                <Select value={riskProfile} onChange={(e) => setRiskProfile(e.target.value as RiskProfile)}>
                  {RISK_PROFILES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </Select>
              </Field>
              <Button type="submit" disabled={pending}>Save goals</Button>
              {goal && <Badge variant="secondary" className="ml-2">Saved</Badge>}
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-bold tabular">{value}</div>
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
