"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, Input, Select } from "@/components/ui";
import { ExpirationPicker } from "@/components/stock/expiration-picker";
import { useOptionChain } from "@/components/stock/use-option-chain";
import { calculateCoveredCall } from "@/lib/calculations/covered-call";
import { calculateCashSecuredPut } from "@/lib/calculations/cash-secured-put";
import { IVSkewChart } from "@/components/charts/iv-skew-chart";
import { calculateAssignmentProbability, type AssignmentProbability } from "@/lib/calculations/historical";
import { cn, formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import type { OptionContract, HistoricalPricePoint } from "@/lib/types";
import type { StockData } from "@/features/options/stock-data";

const PAGE_SIZE = 40;

export function OptionChainTab({
  data,
  expiration,
  onExpirationChange,
}: {
  data: StockData;
  expiration: string;
  onExpirationChange: (v: string) => void;
}) {
  const { data: chainData, error, loading } = useOptionChain(data.symbol, expiration);
  const [viewMode, setViewMode] = useState<"side-by-side" | "calls" | "puts">("side-by-side");
  const [strikeSearch, setStrikeSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selectedContract, setSelectedContract] = useState<OptionContract | null>(null);

  const spot = chainData?.chain.underlyingPrice ?? data.quote.price;

  // Build paired rows: call + put at each strike.
  const pairedRows = useMemo(() => {
    if (!chainData) return [];
    const callsByStrike = new Map(chainData.chain.calls.map((c) => [c.strike, c]));
    const putsByStrike = new Map(chainData.chain.puts.map((p) => [p.strike, p]));
    const allStrikes = Array.from(new Set([...callsByStrike.keys(), ...putsByStrike.keys()])).sort((a, b) => a - b);
    return allStrikes.map((strike) => ({
      strike,
      call: callsByStrike.get(strike) ?? null,
      put: putsByStrike.get(strike) ?? null,
    }));
  }, [chainData]);

  // Filter by strike search.
  const filteredRows = useMemo(() => {
    if (!strikeSearch.trim()) return pairedRows;
    const q = Number(strikeSearch);
    if (!Number.isFinite(q)) return pairedRows;
    return pairedRows.filter((r) => Math.abs(r.strike - q) < 0.01);
  }, [pairedRows, strikeSearch]);

  // Smart pagination — center on ATM strike by default.
  const pagedRows = useMemo(() => {
    if (filteredRows.length <= PAGE_SIZE) return filteredRows;
    const start = page * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, page]);

  const totalPages = Math.ceil(filteredRows.length / PAGE_SIZE);

  // Find ATM strike index for "center on ATM" button.
  const atmIndex = useMemo(() => {
    if (pairedRows.length === 0) return 0;
    let best = 0;
    let bestDist = Infinity;
    pairedRows.forEach((r, i) => {
      const d = Math.abs(r.strike - spot);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }, [pairedRows, spot]);

  function centerOnATM() {
    setPage(Math.floor(atmIndex / PAGE_SIZE));
  }

  // Reset page when expiration or search changes.
  useEffect(() => {
    setPage(0);
  }, [expiration, strikeSearch]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Option chain</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <ExpirationPicker expirations={data.expirations} value={expiration} onChange={onExpirationChange} />
            <Select value={viewMode} onChange={(e) => setViewMode(e.target.value as typeof viewMode)} className="w-auto">
              <option value="side-by-side">Calls | Strike | Puts</option>
              <option value="calls">Calls only</option>
              <option value="puts">Puts only</option>
            </Select>
            <div className="relative w-32">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="number"
                placeholder="Strike…"
                value={strikeSearch}
                onChange={(e) => setStrikeSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <Button size="sm" variant="outline" onClick={centerOnATM}>Center on ATM</Button>
            {chainData && (
              <Badge variant="outline" className={cn(chainData.dataQuality === "delayed" && "text-amber-500")}>
                {chainData.fromCache ? "cached" : "fresh"} · {chainData.dataQuality}
              </Badge>
            )}
          </div>
          {chainData && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Spot: <span className="font-medium text-foreground">{formatCurrency(spot)}</span></span>
              <span>·</span>
              <span>{filteredRows.length} strikes</span>
              <span>·</span>
              <span>DTE: {chainData.chain.calls[0]?.daysToExpiration ?? "—"}</span>
              <span>·</span>
              <span>Quote: {chainData.fetchedAt ? new Date(chainData.fetchedAt).toLocaleTimeString() : "—"}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-2">
          {loading && <p className="p-4 text-sm text-muted-foreground">Loading chain…</p>}
          {error && <p className="p-4 text-sm text-loss">{error}</p>}
          {!loading && !error && chainData && (
            <IVSkewChart chain={chainData.chain} height={240} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-2">
          {loading && <p className="p-4 text-sm text-muted-foreground">Loading chain…</p>}
          {error && <p className="p-4 text-sm text-loss">{error}</p>}
          {!loading && !error && pagedRows.length > 0 && (
            <div className="overflow-x-auto">
              {viewMode === "side-by-side" ? (
                <SideBySideChain
                  rows={pagedRows}
                  spot={spot}
                  points={data.historical.points}
                  onSelect={setSelectedContract}
                />
              ) : (
                <SingleSideChain
                  rows={pagedRows}
                  side={viewMode}
                  spot={spot}
                  points={data.historical.points}
                  onSelect={setSelectedContract}
                />
              )}
            </div>
          )}
          {!loading && !error && pagedRows.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">No strikes match your search.</p>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button size="sm" variant="outline" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {selectedContract && (
        <QuickAnalysisModal
          contract={selectedContract}
          spot={spot}
          points={data.historical.points}
          onClose={() => setSelectedContract(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side-by-side chain: calls | strike | puts
// ---------------------------------------------------------------------------

function SideBySideChain({
  rows,
  spot,
  points,
  onSelect,
}: {
  rows: { strike: number; call: OptionContract | null; put: OptionContract | null }[];
  spot: number;
  points: HistoricalPricePoint[];
  onSelect: (c: OptionContract) => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b">
          {/* Call side */}
          <th colSpan={10} className="bg-profit/5 px-2 py-1.5 text-center text-xs font-semibold text-profit">
            CALLS
          </th>
          <th className="bg-secondary px-2 py-1.5 text-center text-xs font-semibold">STRIKE</th>
          <th colSpan={10} className="bg-loss/5 px-2 py-1.5 text-center text-xs font-semibold text-loss">
            PUTS
          </th>
        </tr>
        <tr className="border-b text-xs text-muted-foreground">
          <th className="px-1 py-1 text-right">Bid</th>
          <th className="px-1 py-1 text-right">Ask</th>
          <th className="px-1 py-1 text-right">Spread</th>
          <th className="px-1 py-1 text-right">Vol</th>
          <th className="px-1 py-1 text-right">OI</th>
          <th className="px-1 py-1 text-right">IV</th>
          <th className="px-1 py-1 text-right">Δ</th>
          <th className="px-1 py-1 text-right">Assign%</th>
          <th className="px-1 py-1 text-right">Yield</th>
          <th className="px-1 py-1 text-right">MaxRet</th>
          <th className="px-2 py-1 text-center font-semibold text-foreground">$</th>
          <th className="px-1 py-1 text-right">MaxRet</th>
          <th className="px-1 py-1 text-right">Yield</th>
          <th className="px-1 py-1 text-right">Assign%</th>
          <th className="px-1 py-1 text-right">Δ</th>
          <th className="px-1 py-1 text-right">IV</th>
          <th className="px-1 py-1 text-right">OI</th>
          <th className="px-1 py-1 text-right">Vol</th>
          <th className="px-1 py-1 text-right">Spread</th>
          <th className="px-1 py-1 text-right">Ask</th>
          <th className="px-1 py-1 text-right">Bid</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const isAtm = Math.abs(r.strike - spot) < (spot * 0.02);
          const callItm = r.call?.inTheMoney ?? false;
          const putItm = r.put?.inTheMoney ?? false;
          return (
            <tr
              key={r.strike}
              className={cn(
                "border-b transition-colors hover:bg-muted/40",
                isAtm && "bg-primary/10 font-semibold",
              )}
            >
              {/* Call columns (right-aligned, ITM shaded) */}
              <ContractCells contract={r.call} side="call" itm={callItm} spot={spot} points={points} onSelect={onSelect} />
              {/* Strike (center) */}
              <td className={cn("px-2 py-1 text-center font-bold tabular", isAtm && "text-primary")}>
                {formatCurrency(r.strike, 0)}
                {isAtm && <div className="text-[9px] text-primary">ATM</div>}
              </td>
              {/* Put columns */}
              <ContractCells contract={r.put} side="put" itm={putItm} spot={spot} points={points} onSelect={onSelect} reverse />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ContractCells({
  contract,
  side,
  itm,
  spot,
  points,
  onSelect,
  reverse,
}: {
  contract: OptionContract | null;
  side: "call" | "put";
  itm: boolean;
  spot: number;
  points: HistoricalPricePoint[];
  onSelect: (c: OptionContract) => void;
  reverse?: boolean;
}) {
  if (!contract) {
    return <>{Array.from({ length: 10 }).map((_, i) => <td key={i} className="px-1 py-1 text-right text-muted-foreground">—</td>)}</>;
  }

  const assignment = calculateAssignmentProbability(points, contract.daysToExpiration, spot, contract.strike, contract.greeks.delta);

  const bid = contract.bid ?? 0;
  const ask = contract.ask ?? 0;
  const mid = contract.midpoint ?? 0;
  const spread = ask - bid;
  const spreadPct = mid > 0 ? spread / mid : 0;

  const cc = side === "call" ? calculateCoveredCall({ contract, contracts: 1, currentPrice: spot }) : null;
  const csp = side === "put" ? calculateCashSecuredPut({ contract, contracts: 1, currentPrice: spot }) : null;

  const assignProb = assignment.compositeProbability ?? 0;
  const cells = [
    { label: "bid", value: formatCurrency(bid), tone: undefined },
    { label: "ask", value: formatCurrency(ask), tone: undefined },
    { label: "spread", value: formatCurrency(spread), tone: spreadPct > 0.05 ? "loss" : spreadPct > 0.02 ? "warning" : undefined },
    { label: "vol", value: contract.volume?.toString() ?? "—", tone: undefined },
    { label: "oi", value: contract.openInterest?.toString() ?? "—", tone: undefined },
    { label: "iv", value: formatPercent(contract.impliedVolatility), tone: undefined },
    { label: "delta", value: formatNumber(contract.greeks.delta, 2), tone: undefined },
    { label: "assign", value: formatPercent(assignProb, 0), tone: assignProb > 0.5 ? "loss" : assignProb > 0.25 ? "warning" : "profit" },
    { label: "yield", value: formatPercent(side === "call" ? cc?.premiumYield : csp?.returnOnNetCapital), tone: "profit" },
    { label: "maxret", value: side === "call" ? formatPercent(cc?.maxTotalReturn, 1) : formatCurrency(csp?.effectivePurchasePrice), tone: "profit" },
  ];

  const orderedCells = reverse ? [...cells].reverse() : cells;

  return (
    <>
      {orderedCells.map((cell, i) => (
        <td
          key={i}
          className={cn(
            "px-1 py-1 text-right tabular cursor-pointer text-xs",
            itm && "bg-muted/20",
            cell.tone === "profit" && "text-profit",
            cell.tone === "loss" && "text-loss",
            cell.tone === "warning" && "text-amber-500",
          )}
          onClick={() => onSelect(contract)}
          title={cell.label === "assign" ? calledAwayTooltip(assignment) : undefined}
        >
          {cell.value}
        </td>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Single-side chain (calls only or puts only)
// ---------------------------------------------------------------------------

function SingleSideChain({
  rows,
  side,
  spot,
  points,
  onSelect,
}: {
  rows: { strike: number; call: OptionContract | null; put: OptionContract | null }[];
  side: "calls" | "puts";
  spot: number;
  points: HistoricalPricePoint[];
  onSelect: (c: OptionContract) => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-xs text-muted-foreground">
          <th className="px-2 py-1 text-right">Strike</th>
          <th className="px-1 py-1 text-right">Bid</th>
          <th className="px-1 py-1 text-right">Ask</th>
          <th className="px-1 py-1 text-right">Spread</th>
          <th className="px-1 py-1 text-right">Last</th>
          <th className="px-1 py-1 text-right">Vol</th>
          <th className="px-1 py-1 text-right">OI</th>
          <th className="px-1 py-1 text-right">Vol/OI</th>
          <th className="px-1 py-1 text-right">IV</th>
          <th className="px-1 py-1 text-right">Δ</th>
          <th className="px-1 py-1 text-right">Γ</th>
          <th className="px-1 py-1 text-right">Θ</th>
          <th className="px-1 py-1 text-right">ν</th>
          <th className="px-1 py-1 text-right">Yield</th>
          <th className="px-1 py-1 text-right">Ann.Yield</th>
          <th className="px-1 py-1 text-right">BE</th>
          <th className="px-1 py-1 text-right">Assign%</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const contract = side === "calls" ? r.call : r.put;
          if (!contract) return null;
          const isAtm = Math.abs(r.strike - spot) < spot * 0.02;
          const bid = contract.bid ?? 0;
          const ask = contract.ask ?? 0;
          const mid = contract.midpoint ?? 0;
          const spread = ask - bid;
          const spreadPct = mid > 0 ? spread / mid : 0;
          const volOi = contract.openInterest && contract.openInterest > 0 ? (contract.volume ?? 0) / contract.openInterest : 0;
          const cc = side === "calls" ? calculateCoveredCall({ contract, contracts: 1, currentPrice: spot }) : null;
          const csp = side === "puts" ? calculateCashSecuredPut({ contract, contracts: 1, currentPrice: spot }) : null;
          const be = cc?.breakEven ?? csp?.breakEven ?? 0;
          const assignment = calculateAssignmentProbability(points, contract.daysToExpiration, spot, contract.strike, contract.greeks.delta);
          const assignProb = assignment.compositeProbability ?? 0;
          return (
            <tr
              key={r.strike}
              className={cn(
                "border-b cursor-pointer transition-colors hover:bg-muted/40",
                isAtm && "bg-primary/10 font-semibold",
                contract.inTheMoney && !isAtm && "bg-muted/20",
              )}
              onClick={() => onSelect(contract)}
            >
              <td className={cn("px-2 py-1 text-right font-bold tabular", isAtm && "text-primary")}>
                {formatCurrency(r.strike, 0)}
                {isAtm && <div className="text-[9px] text-primary">ATM</div>}
              </td>
              <td className="px-1 py-1 text-right tabular">{formatCurrency(contract.bid)}</td>
              <td className="px-1 py-1 text-right tabular">{formatCurrency(contract.ask)}</td>
              <td className={cn("px-1 py-1 text-right tabular text-xs", spreadPct > 0.05 ? "text-loss" : spreadPct > 0.02 ? "text-amber-500" : "")}>
                {formatCurrency(spread)}
              </td>
              <td className="px-1 py-1 text-right tabular">{formatCurrency(contract.last)}</td>
              <td className="px-1 py-1 text-right tabular">{contract.volume ?? "—"}</td>
              <td className="px-1 py-1 text-right tabular">{contract.openInterest ?? "—"}</td>
              <td className={cn("px-1 py-1 text-right tabular text-xs", volOi > 1 ? "text-profit" : volOi > 0.5 ? "text-amber-500" : "")}>
                {volOi > 0 ? volOi.toFixed(2) : "—"}
              </td>
              <td className="px-1 py-1 text-right tabular">{formatPercent(contract.impliedVolatility)}</td>
              <td className="px-1 py-1 text-right tabular">{formatNumber(contract.greeks.delta, 2)}</td>
              <td className="px-1 py-1 text-right tabular text-xs">{formatNumber(contract.greeks.gamma, 4)}</td>
              <td className="px-1 py-1 text-right tabular text-xs">{formatNumber(contract.greeks.theta, 3)}</td>
              <td className="px-1 py-1 text-right tabular text-xs">{formatNumber(contract.greeks.vega, 3)}</td>
              <td className="px-1 py-1 text-right tabular text-profit">
                {formatPercent(side === "calls" ? cc?.premiumYield : csp?.returnOnNetCapital)}
              </td>
              <td className="px-1 py-1 text-right tabular">
                {formatPercent(side === "calls" ? cc?.annualizedPremiumYield : csp?.annualizedReturnOnNet)}
              </td>
              <td className="px-1 py-1 text-right tabular">{formatCurrency(be)}</td>
              <td className={cn("px-1 py-1 text-right tabular text-xs", assignProb > 0.5 ? "text-loss" : assignProb > 0.25 ? "text-amber-500" : "text-profit")} title={calledAwayTooltip(assignment)}>
                {formatPercent(assignProb, 0)}
              </td>
              <td className="px-1 py-1">
                {contract.inTheMoney && <Badge variant="warning" className="text-[9px]">ITM</Badge>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Quick analysis modal
// ---------------------------------------------------------------------------

function QuickAnalysisModal({
  contract,
  spot,
  points,
  onClose,
}: {
  contract: OptionContract;
  spot: number;
  points: HistoricalPricePoint[];
  onClose: () => void;
}) {
  const isCall = contract.optionType === "CALL";
  const cc = isCall ? calculateCoveredCall({ contract, contracts: 1, currentPrice: spot }) : null;
  const csp = !isCall ? calculateCashSecuredPut({ contract, contracts: 1, currentPrice: spot }) : null;
  const assignment = calculateAssignmentProbability(points, contract.daysToExpiration, spot, contract.strike, contract.greeks.delta);
  const assignProb = assignment.compositeProbability ?? 0;
  const spread = (contract.ask ?? 0) - (contract.bid ?? 0);
  const spreadPct = (contract.midpoint ?? 0) > 0 ? spread / (contract.midpoint ?? 1) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <Card
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            {contract.underlyingSymbol} {formatCurrency(contract.strike, 0)} {isCall ? "Call" : "Put"} · {contract.expiration} · {contract.daysToExpiration} DTE
          </CardTitle>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Market data */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Market Data</h4>
            <div className="grid grid-cols-3 gap-2 text-sm sm:grid-cols-4">
              <Cell label="Bid" value={formatCurrency(contract.bid)} />
              <Cell label="Ask" value={formatCurrency(contract.ask)} />
              <Cell label="Mid" value={formatCurrency(contract.midpoint)} />
              <Cell label="Last" value={formatCurrency(contract.last)} />
              <Cell label="Spread" value={formatCurrency(spread)} tone={spreadPct > 0.05 ? "loss" : undefined} />
              <Cell label="Spread %" value={formatPercent(spreadPct, 2)} tone={spreadPct > 0.05 ? "loss" : spreadPct > 0.02 ? "warning" : "profit"} />
              <Cell label="Volume" value={contract.volume?.toString() ?? "—"} />
              <Cell label="Open Int" value={contract.openInterest?.toString() ?? "—"} />
            </div>
          </div>

          {/* Greeks */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              Greeks <span className="normal-case text-muted-foreground/70">({contract.greeksProvenance})</span>
            </h4>
            <div className="grid grid-cols-5 gap-2 text-sm">
              <Cell label="Delta" value={formatNumber(contract.greeks.delta, 3)} />
              <Cell label="Gamma" value={formatNumber(contract.greeks.gamma, 4)} />
              <Cell label="Theta" value={formatNumber(contract.greeks.theta, 3)} />
              <Cell label="Vega" value={formatNumber(contract.greeks.vega, 3)} />
              <Cell label="Rho" value={formatNumber(contract.greeks.rho, 3)} />
            </div>
          </div>

          {/* Strategy metrics */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              {isCall ? "Covered Call Metrics" : "Cash-Secured Put Metrics"}
            </h4>
            {cc && (
              <div className="grid grid-cols-3 gap-2 text-sm sm:grid-cols-4">
                <Cell label="Premium/sh" value={formatCurrency(cc.premiumPerShare)} />
                <Cell label="Premium/contract" value={formatCurrency(cc.premiumPerContract, 0)} />
                <Cell label="Premium yield" value={formatPercent(cc.premiumYield)} tone="profit" />
                <Cell label="Ann. premium yield*" value={formatPercent(cc.annualizedPremiumYield)} />
                <Cell label="OTM %" value={formatPercent(cc.strikeOtmPercent, 1)} />
                <Cell label="Appreciation cap" value={formatPercent(cc.potentialStockAppreciation, 1)} tone="profit" />
                <Cell label="Max total return" value={formatPercent(cc.maxTotalReturn, 1)} tone="profit" />
                <Cell label="Ann. max total ret.*" value={formatPercent(cc.annualizedMaxTotalReturn)} />
                <Cell label="Break-even" value={formatCurrency(cc.breakEven)} />
                <Cell label="Downside protection" value={formatPercent(cc.downsideProtectionPercent)} />
                <Cell label="Assign prob" value={formatPercent(assignProb)} tone={assignProb > 0.4 ? "loss" : assignProb > 0.25 ? "warning" : undefined} title={calledAwayTooltip(assignment)} />
                <Cell label="Premium/day" value={formatCurrency(cc.premiumPerDay, 2)} />
              </div>
            )}
            {csp && (
              <div className="grid grid-cols-3 gap-2 text-sm sm:grid-cols-4">
                <Cell label="Premium/sh" value={formatCurrency(csp.premiumPerShare)} />
                <Cell label="Premium/contract" value={formatCurrency(csp.premiumPerContract, 0)} />
                <Cell label="Gross collateral" value={formatCurrency(csp.grossCollateral, 0)} />
                <Cell label="Net capital" value={formatCurrency(csp.netCapitalAtRisk, 0)} />
                <Cell label="Return (net)" value={formatPercent(csp.returnOnNetCapital)} tone="profit" />
                <Cell label="Ann. return (net)*" value={formatPercent(csp.annualizedReturnOnNet)} />
                <Cell label="Eff. entry" value={formatCurrency(csp.effectivePurchasePrice)} tone="profit" />
                <Cell label="Discount to spot" value={formatPercent(csp.discountToCurrentPrice, 1)} tone="profit" />
                <Cell label="Break-even" value={formatCurrency(csp.breakEven)} />
                <Cell label="Assign prob" value={formatPercent(assignProb)} tone={assignProb > 0.4 ? "loss" : assignProb > 0.25 ? "warning" : undefined} title={calledAwayTooltip(assignment)} />
                <Cell label="IV" value={formatPercent(csp.impliedVolatility)} />
                <Cell label="Premium/day" value={formatCurrency(csp.premiumPerDay, 2)} />
              </div>
            )}
          </div>

          {/* Intrinsic/extrinsic */}
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="grid grid-cols-4 gap-2">
              <Cell label="Intrinsic" value={contract.intrinsicValue != null ? formatCurrency(contract.intrinsicValue) : "—"} />
              <Cell label="Extrinsic" value={contract.extrinsicValue != null ? formatCurrency(contract.extrinsicValue) : "—"} />
              <Cell label="ITM" value={contract.inTheMoney ? "Yes" : "No"} tone={contract.inTheMoney ? "warning" : "profit"} />
              <Cell label="Liquidity score" value={cc?.liquidityScore?.toString() ?? csp?.liquidityScore?.toString() ?? "—"} />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            * Annualized rates are comparison tools only, not expected returns. Click the Covered Calls or
            Cash-Secured Puts tab for full payoff graphs and profit tables.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function calledAwayTooltip(assignment: AssignmentProbability): string {
  return `Called away estimate: ${formatPercent(assignment.compositeProbability ?? 0, 0)}\n` +
    `Historical: ${assignment.historicalProbability != null ? formatPercent(assignment.historicalProbability, 0) : "—"}\n` +
    `Vol model: ${assignment.monteCarloProbability != null ? formatPercent(assignment.monteCarloProbability, 0) : "—"}\n` +
    `Delta proxy: ${formatPercent(assignment.deltaProxy ?? 0, 0)}\n` +
    `Windows tested: ${assignment.sampleSize}`;
}

function Cell({ label, value, tone, title }: { label: string; value: string; tone?: "profit" | "loss" | "warning"; title?: string }) {
  return (
    <div title={title}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("tabular font-medium", tone === "profit" && "text-profit", tone === "loss" && "text-loss", tone === "warning" && "text-amber-500")}>
        {value}
      </div>
    </div>
  );
}
