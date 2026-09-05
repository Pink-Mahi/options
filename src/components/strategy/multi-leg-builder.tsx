"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, Input, Label } from "@/components/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn, formatCurrency } from "@/lib/utils";
import type { MultiLegResult } from "@/lib/calculations/multi-leg";

interface LegDraft {
  action: "BUY" | "SELL";
  optionType: "CALL" | "PUT";
  strike: number;
  pricePerShare: number;
  contracts: number;
  daysToExpiration: number;
}

const PRESETS: Record<string, { label: string; underlying: number; legs: LegDraft[] }> = {
  bullPut: {
    label: "Bull put spread",
    underlying: 100,
    legs: [
      { action: "SELL", optionType: "PUT", strike: 100, pricePerShare: 2.0, contracts: 1, daysToExpiration: 45 },
      { action: "BUY", optionType: "PUT", strike: 95, pricePerShare: 0.75, contracts: 1, daysToExpiration: 45 },
    ],
  },
  bearCall: {
    label: "Bear call spread",
    underlying: 100,
    legs: [
      { action: "SELL", optionType: "CALL", strike: 100, pricePerShare: 2.0, contracts: 1, daysToExpiration: 45 },
      { action: "BUY", optionType: "CALL", strike: 105, pricePerShare: 0.75, contracts: 1, daysToExpiration: 45 },
    ],
  },
  ironCondor: {
    label: "Iron condor",
    underlying: 100,
    legs: [
      { action: "BUY", optionType: "PUT", strike: 90, pricePerShare: 0.5, contracts: 1, daysToExpiration: 45 },
      { action: "SELL", optionType: "PUT", strike: 95, pricePerShare: 1.5, contracts: 1, daysToExpiration: 45 },
      { action: "SELL", optionType: "CALL", strike: 105, pricePerShare: 1.5, contracts: 1, daysToExpiration: 45 },
      { action: "BUY", optionType: "CALL", strike: 110, pricePerShare: 0.5, contracts: 1, daysToExpiration: 45 },
    ],
  },
  collar: {
    label: "Collar",
    underlying: 100,
    legs: [
      { action: "BUY", optionType: "PUT", strike: 95, pricePerShare: 1.5, contracts: 1, daysToExpiration: 90 },
      { action: "SELL", optionType: "CALL", strike: 110, pricePerShare: 1.0, contracts: 1, daysToExpiration: 90 },
    ],
  },
  pmcc: {
    label: "Poor man's covered call",
    underlying: 100,
    legs: [
      { action: "BUY", optionType: "CALL", strike: 80, pricePerShare: 25.0, contracts: 1, daysToExpiration: 365 },
      { action: "SELL", optionType: "CALL", strike: 110, pricePerShare: 1.5, contracts: 1, daysToExpiration: 45 },
    ],
  },
};

export function MultiLegBuilder() {
  const [underlyingPrice, setUnderlyingPrice] = useState(100);
  const [legs, setLegs] = useState<LegDraft[]>(PRESETS.bullPut!.legs);
  const [result, setResult] = useState<MultiLegResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyPreset(key: string) {
    const preset = PRESETS[key];
    if (!preset) return;
    setUnderlyingPrice(preset.underlying);
    setLegs(preset.legs.map((l) => ({ ...l })));
    setResult(null);
  }

  function updateLeg(index: number, patch: Partial<LegDraft>) {
    setLegs((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function addLeg() {
    setLegs((prev) => [
      ...prev,
      { action: "SELL", optionType: "CALL", strike: underlyingPrice, pricePerShare: 1, contracts: 1, daysToExpiration: 45 },
    ]);
  }

  function removeLeg(index: number) {
    setLegs((prev) => prev.filter((_, i) => i !== index));
  }

  async function analyze() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/multi-leg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ underlyingPrice, legs }),
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Analysis failed.");
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
    result?.payoffPoints.map((p) => ({
      price: Math.round(p.stockPrice * 100) / 100,
      pnl: Math.round(p.optionPnl),
    })) ?? [];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Multi-leg strategy builder</h1>
        <p className="text-sm text-muted-foreground">
          Build any combination of calls and puts. The structure is classified automatically and analyzed for
          net premium, breakevens, defined risk, and combined Greeks.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Start from a preset</CardTitle>
          <CardDescription>Presets are editable starting points, not recommendations.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {Object.entries(PRESETS).map(([key, preset]) => (
              <Button key={key} variant="outline" size="sm" onClick={() => applyPreset(key)}>
                {preset.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Legs</CardTitle>
          <CardDescription>
            Premium is per share. A 1-contract leg at $2.00 premium is $200 of cash.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="w-40 space-y-1.5">
            <Label htmlFor="ml-underlying">Underlying price</Label>
            <Input
              id="ml-underlying"
              type="number"
              step="0.01"
              min="0.01"
              value={underlyingPrice}
              onChange={(e) => setUnderlyingPrice(Number(e.target.value))}
            />
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Strike</TableHead>
                  <TableHead>Premium</TableHead>
                  <TableHead>Contracts</TableHead>
                  <TableHead>DTE</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {legs.map((leg, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <select
                        aria-label={`Leg ${i + 1} action`}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={leg.action}
                        onChange={(e) => updateLeg(i, { action: e.target.value as LegDraft["action"] })}
                      >
                        <option value="BUY">BUY</option>
                        <option value="SELL">SELL</option>
                      </select>
                    </TableCell>
                    <TableCell>
                      <select
                        aria-label={`Leg ${i + 1} type`}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={leg.optionType}
                        onChange={(e) => updateLeg(i, { optionType: e.target.value as LegDraft["optionType"] })}
                      >
                        <option value="CALL">CALL</option>
                        <option value="PUT">PUT</option>
                      </select>
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={`Leg ${i + 1} strike`}
                        className="w-24"
                        type="number"
                        step="0.5"
                        value={leg.strike}
                        onChange={(e) => updateLeg(i, { strike: Number(e.target.value) })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={`Leg ${i + 1} premium`}
                        className="w-24"
                        type="number"
                        step="0.05"
                        value={leg.pricePerShare}
                        onChange={(e) => updateLeg(i, { pricePerShare: Number(e.target.value) })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={`Leg ${i + 1} contracts`}
                        className="w-20"
                        type="number"
                        step="1"
                        min="1"
                        value={leg.contracts}
                        onChange={(e) => updateLeg(i, { contracts: Number(e.target.value) })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={`Leg ${i + 1} days to expiration`}
                        className="w-20"
                        type="number"
                        step="1"
                        min="1"
                        value={leg.daysToExpiration}
                        onChange={(e) => updateLeg(i, { daysToExpiration: Number(e.target.value) })}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeLeg(i)}
                        disabled={legs.length <= 1}
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={addLeg}>
              Add leg
            </Button>
            <Button onClick={analyze} disabled={loading || legs.length === 0}>
              {loading ? "Analyzing…" : "Analyze strategy"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {result && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="secondary" className="text-sm">
              {result.kind.replace(/_/g, " ")}
            </Badge>
            <Badge variant={result.netPremiumTotal >= 0 ? "profit" : "warning"}>
              {result.netPremiumTotal >= 0 ? "Net credit" : "Net debit"}{" "}
              {formatCurrency(Math.abs(result.netPremiumTotal), 2)}
            </Badge>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Max profit"
              value={result.maxProfit != null ? formatCurrency(result.maxProfit, 2) : "Unlimited"}
              tone="profit"
            />
            <Stat
              label="Max loss"
              value={result.maxLoss != null ? formatCurrency(result.maxLoss, 2) : "Undefined risk"}
              tone="loss"
            />
            <Stat
              label="Risk / reward"
              value={result.riskRewardRatio != null ? result.riskRewardRatio.toFixed(2) : "—"}
            />
            <Stat
              label="Margin estimate"
              value={result.marginRequirement != null ? formatCurrency(result.marginRequirement, 0) : "—"}
            />
          </div>

          {result.maxLoss == null && (
            <Card className="border-destructive/50 bg-destructive/5">
              <CardContent className="pt-6 text-sm">
                <p className="font-semibold text-destructive">Undefined risk</p>
                <p className="mt-1 text-muted-foreground">
                  This structure has no long option capping one side, so the theoretical loss is unbounded.
                  Brokers require margin for it and a fast adverse move can exceed the premium collected many
                  times over.
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payoff at expiration</CardTitle>
              <CardDescription>
                Breakevens:{" "}
                {result.breakevens.length > 0
                  ? result.breakevens.map((b) => formatCurrency(b, 2)).join(", ")
                  : "none within the plotted range"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="price"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => `$${v}`}
                      minTickGap={30}
                    />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                    <Tooltip
                      formatter={(v) => formatCurrency(Number(v), 2)}
                      labelFormatter={(l) => `Underlying ${formatCurrency(Number(l), 2)}`}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.5} />
                    <ReferenceLine
                      x={Math.round(underlyingPrice * 100) / 100}
                      stroke="#2563eb"
                      strokeDasharray="4 4"
                      label={{ value: "Now", fontSize: 11, position: "top" }}
                    />
                    <Area type="monotone" dataKey="pnl" stroke="#2563eb" fill="#2563eb" fillOpacity={0.15} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Combined position Greeks</CardTitle>
                <CardDescription>Summed across all legs and scaled by contracts.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Delta" value={fmtGreek(result.combinedGreeks.delta)} />
                <Row label="Gamma" value={fmtGreek(result.combinedGreeks.gamma)} />
                <Row label="Theta" value={fmtGreek(result.combinedGreeks.theta)} />
                <Row label="Vega" value={fmtGreek(result.combinedGreeks.vega)} />
                <Row label="Rho" value={fmtGreek(result.combinedGreeks.rho)} />
                <p className="pt-2 text-xs text-muted-foreground">
                  Greeks are only populated when supplied per leg. Legs entered manually here have no Greeks,
                  so these will read zero — pull legs from a live chain to get real values.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Notes</CardTitle>
                <CardDescription>Deterministic observations from the structure.</CardDescription>
              </CardHeader>
              <CardContent>
                {result.notes.length > 0 ? (
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {result.notes.map((n, i) => (
                      <li key={i}>• {n}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No notes for this structure.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function fmtGreek(v: number | null): string {
  if (v == null) return "—";
  return v.toFixed(2);
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "profit" | "loss" }) {
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
