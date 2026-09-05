"use client";

import { useState } from "react";
import { X, Plus, GitCompare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, Select } from "@/components/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOptionChain } from "@/components/stock/use-option-chain";
import { ExpirationPicker } from "@/components/stock/expiration-picker";
import { calculateCoveredCall } from "@/lib/calculations/covered-call";
import { calculateCashSecuredPut } from "@/lib/calculations/cash-secured-put";
import { cn, formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import type { OptionContract } from "@/lib/types";
import type { StockData } from "@/features/options/stock-data";

const MAX_COMPARE = 5;

interface SelectedContract {
  contract: OptionContract;
  strategy: "covered_call" | "csp";
}

export function ContractComparisonTab({
  data,
  expiration,
  onExpirationChange,
}: {
  data: StockData;
  expiration: string;
  onExpirationChange: (v: string) => void;
}) {
  const { data: chainData, error, loading } = useOptionChain(data.symbol, expiration);
  const [selected, setSelected] = useState<SelectedContract[]>([]);
  const [addStrike, setAddStrike] = useState<string>("");
  const [addSide, setAddSide] = useState<"call" | "put">("call");

  const spot = chainData?.chain.underlyingPrice ?? data.quote.price;

  function addContract() {
    if (selected.length >= MAX_COMPARE || !chainData || !addStrike) return;
    const strike = Number(addStrike);
    const list = addSide === "call" ? chainData.chain.calls : chainData.chain.puts;
    const contract = list.find((c) => Math.abs(c.strike - strike) < 1e-6);
    if (!contract) return;
    // Don't add duplicates.
    if (selected.some((s) => s.contract.symbol === contract.symbol && s.strategy === (addSide === "call" ? "covered_call" : "csp"))) return;
    setSelected((prev) => [...prev, { contract, strategy: addSide === "call" ? "covered_call" : "csp" }]);
    setAddStrike("");
  }

  function removeContract(idx: number) {
    setSelected((prev) => prev.filter((_, i) => i !== idx));
  }

  const availableStrikes = chainData
    ? addSide === "call"
      ? chainData.chain.calls
      : chainData.chain.puts
    : [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitCompare className="h-4 w-4" /> Contract comparison
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <ExpirationPicker expirations={data.expirations} value={expiration} onChange={onExpirationChange} />
            <Badge variant="outline">{selected.length}/{MAX_COMPARE} selected</Badge>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Side</label>
              <Select value={addSide} onChange={(e) => setAddSide(e.target.value as "call" | "put")} className="w-auto">
                <option value="call">Call (Covered Call)</option>
                <option value="put">Put (Cash-Secured Put)</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Strike</label>
              <Select value={addStrike} onChange={(e) => setAddStrike(e.target.value)} className="w-auto">
                <option value="">Select strike…</option>
                {availableStrikes.map((c) => (
                  <option key={c.symbol} value={c.strike}>
                    {formatCurrency(c.strike, 0)}{c.inTheMoney ? " (ITM)" : ""} · {formatCurrency(c.midpoint ?? 0)} · IV {formatPercent(c.impliedVolatility)}
                  </option>
                ))}
              </Select>
            </div>
            <Button size="sm" onClick={addContract} disabled={!addStrike || selected.length >= MAX_COMPARE || loading}>
              <Plus className="mr-1 h-4 w-4" /> Add to comparison
            </Button>
          </div>
          {loading && <p className="text-sm text-muted-foreground">Loading chain…</p>}
          {error && <p className="text-sm text-loss">{error}</p>}
        </CardContent>
      </Card>

      {selected.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Side-by-side comparison</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <ComparisonTable selected={selected} spot={spot} onRemove={removeContract} />
            </div>
          </CardContent>
        </Card>
      )}

      {selected.length === 0 && !loading && (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Select strikes above to compare up to {MAX_COMPARE} contracts side-by-side.
          Mix calls and puts to compare covered-call income vs cash-secured-put entry strategies.
        </div>
      )}
    </div>
  );
}

function ComparisonTable({
  selected,
  spot,
  onRemove,
}: {
  selected: SelectedContract[];
  spot: number;
  onRemove: (idx: number) => void;
}) {
  // Build a metric-by-contract matrix.
  const metrics = selected.map((s) => {
    const c = s.contract;
    const cc = s.strategy === "covered_call" ? calculateCoveredCall({ contract: c, contracts: 1, currentPrice: spot }) : null;
    const csp = s.strategy === "csp" ? calculateCashSecuredPut({ contract: c, contracts: 1, currentPrice: spot }) : null;
    return { s, cc, csp };
  });

  const rows: { label: string; values: (string | null)[]; tone?: "profit" | "loss" }[] = [
    {
      label: "Strategy",
      values: selected.map((s) => (s.strategy === "covered_call" ? "Covered Call" : "Cash-Secured Put")),
    },
    {
      label: "Type",
      values: selected.map((s) => s.contract.optionType),
    },
    {
      label: "Strike",
      values: selected.map((s) => formatCurrency(s.contract.strike, 0)),
    },
    {
      label: "Expiration",
      values: selected.map((s) => s.contract.expiration),
    },
    {
      label: "DTE",
      values: selected.map((s) => s.contract.daysToExpiration.toString()),
    },
    {
      label: "Bid",
      values: selected.map((s) => formatCurrency(s.contract.bid ?? 0)),
    },
    {
      label: "Ask",
      values: selected.map((s) => formatCurrency(s.contract.ask ?? 0)),
    },
    {
      label: "Mid",
      values: selected.map((s) => formatCurrency(s.contract.midpoint ?? 0)),
    },
    {
      label: "Spread",
      values: selected.map((s) => formatCurrency((s.contract.ask ?? 0) - (s.contract.bid ?? 0))),
    },
    {
      label: "Volume",
      values: selected.map((s) => s.contract.volume?.toString() ?? "—"),
    },
    {
      label: "Open Interest",
      values: selected.map((s) => s.contract.openInterest?.toString() ?? "—"),
    },
    {
      label: "IV",
      values: selected.map((s) => formatPercent(s.contract.impliedVolatility)),
    },
    {
      label: "Delta",
      values: selected.map((s) => formatNumber(s.contract.greeks.delta, 3)),
    },
    {
      label: "Gamma",
      values: selected.map((s) => formatNumber(s.contract.greeks.gamma, 4)),
    },
    {
      label: "Theta",
      values: selected.map((s) => formatNumber(s.contract.greeks.theta, 3)),
    },
    {
      label: "Vega",
      values: selected.map((s) => formatNumber(s.contract.greeks.vega, 3)),
    },
    {
      label: "Premium/contract",
      values: metrics.map((m) => formatCurrency(m.cc?.premiumPerContract ?? m.csp?.premiumPerContract ?? 0, 0)),
      tone: "profit",
    },
    {
      label: "Premium yield",
      values: metrics.map((m) => formatPercent(m.cc?.premiumYield ?? m.csp?.returnOnNetCapital ?? 0)),
      tone: "profit",
    },
    {
      label: "Annualized yield*",
      values: metrics.map((m) => formatPercent(m.cc?.annualizedPremiumYield ?? m.csp?.annualizedReturnOnNet ?? 0)),
    },
    {
      label: "OTM % (calls) / Discount % (puts)",
      values: metrics.map((m) => formatPercent(m.cc?.strikeOtmPercent ?? m.csp?.discountToCurrentPrice ?? 0, 1)),
    },
    {
      label: "Max total return (CC) / Eff. entry (CSP)",
      values: metrics.map((m) => (m.cc ? formatPercent(m.cc.maxTotalReturn, 1) : formatCurrency(m.csp?.effectivePurchasePrice ?? 0))),
      tone: "profit",
    },
    {
      label: "Annualized max total ret.*",
      values: metrics.map((m) => formatPercent(m.cc?.annualizedMaxTotalReturn ?? 0)),
    },
    {
      label: "Break-even",
      values: metrics.map((m) => formatCurrency(m.cc?.breakEven ?? m.csp?.breakEven ?? 0)),
    },
    {
      label: "Downside protection (CC) / Net capital (CSP)",
      values: metrics.map((m) => (m.cc ? formatPercent(m.cc.downsideProtectionPercent) : formatCurrency(m.csp?.netCapitalAtRisk ?? 0, 0))),
    },
    {
      label: "Assign probability",
      values: metrics.map((m) => formatPercent(m.cc?.estimatedAssignmentProbability ?? m.csp?.estimatedAssignmentProbability ?? 0)),
    },
    {
      label: "Liquidity score",
      values: metrics.map((m) => (m.cc?.liquidityScore ?? m.csp?.liquidityScore ?? 0).toString()),
    },
    {
      label: "Premium per day",
      values: metrics.map((m) => formatCurrency(m.cc?.premiumPerDay ?? m.csp?.premiumPerDay ?? 0, 2)),
    },
    {
      label: "Score (0-100)",
      values: metrics.map((m) => (m.cc?.score.total ?? m.csp?.score.total ?? 0).toString()),
    },
  ];

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-48">Metric</TableHead>
          {selected.map((s, i) => (
            <TableHead key={i} className="text-center">
              <div className="flex items-center justify-center gap-1">
                <span className="font-semibold">{s.contract.strike}</span>
                <Badge variant={s.strategy === "covered_call" ? "profit" : "loss"} className="text-[9px]">
                  {s.contract.optionType}
                </Badge>
                <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => onRemove(i)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.label}>
            <TableCell className="font-medium text-muted-foreground">{row.label}</TableCell>
            {row.values.map((v, i) => (
              <TableCell
                key={i}
                className={cn(
                  "text-center tabular",
                  row.tone === "profit" && "text-profit",
                  row.tone === "loss" && "text-loss",
                )}
              >
                {v ?? "—"}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
