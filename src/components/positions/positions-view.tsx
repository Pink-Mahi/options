"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Trash2, X, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, Input, Label, Select } from "@/components/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { openOptionPosition, closeOptionPosition, deleteOptionPosition } from "@/app/portfolio/actions";
import { RollAnalyzerDialog } from "@/components/positions/roll-analyzer-dialog";
import { cn, formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import type { Portfolio, OptionPosition } from "@/lib/types";

const STATUS_VARIANT: Record<string, "profit" | "warning" | "loss" | "secondary" | "outline"> = {
  OPEN: "warning",
  EXPIRED_WORTHLESS: "profit",
  ASSIGNED: "secondary",
  BOUGHT_BACK: "secondary",
  ROLLED: "outline",
  CLOSED: "secondary",
};

export function PositionsView({ portfolio }: { portfolio: Portfolio }) {
  const [pending, startTransition] = useTransition();
  const [rollTarget, setRollTarget] = useState<OptionPosition | null>(null);

  // Open-position form
  const [symbol, setSymbol] = useState("");
  const [optionType, setOptionType] = useState<"CALL" | "PUT">("CALL");
  const [strategyType, setStrategyType] = useState<"COVERED_CALL" | "CASH_SECURED_PUT" | "NAKED" | "LONG" | "WHEEL" | "OTHER">("COVERED_CALL");
  const [strike, setStrike] = useState<number | "">("");
  const [expiration, setExpiration] = useState("");
  const [contracts, setContracts] = useState<number | "">(1);
  const [openingPrice, setOpeningPrice] = useState<number | "">("");
  const [premium, setPremium] = useState<number | "">("");
  const [reason, setReason] = useState("");

  // Close dialog
  const [closeTarget, setCloseTarget] = useState<OptionPosition | null>(null);
  const [closeStatus, setCloseStatus] = useState<"EXPIRED_WORTHLESS" | "ASSIGNED" | "BOUGHT_BACK" | "ROLLED" | "CLOSED">("BOUGHT_BACK");
  const [closePrice, setClosePrice] = useState<number | "">(0);

  const open = portfolio.optionPositions.filter((p) => p.status === "OPEN");
  const closed = portfolio.optionPositions.filter((p) => p.status !== "OPEN");
  const totalRealized = closed.reduce((s, p) => s + (p.realizedProfitLoss ?? 0), 0);
  const totalOpenPremium = open.reduce((s, p) => s + p.openingCreditDebit * p.contracts * 100, 0);

  function handleOpen(e: React.FormEvent) {
    e.preventDefault();
    if (!symbol || strike === "" || !expiration || contracts === "" || openingPrice === "" || premium === "") return;
    startTransition(async () => {
      await openOptionPosition({
        symbol,
        optionType,
        strategyType,
        strike: Number(strike),
        expiration,
        contracts: Number(contracts),
        openingPrice: Number(openingPrice),
        openingCreditDebit: Number(premium),
        reasonForTrade: reason || null,
      });
      setSymbol(""); setStrike(""); setExpiration(""); setOpeningPrice(""); setPremium(""); setReason("");
    });
  }

  function handleClose(e: React.FormEvent) {
    e.preventDefault();
    if (!closeTarget || closePrice === "") return;
    startTransition(async () => {
      await closeOptionPosition(closeTarget.id, {
        status: closeStatus,
        closingPrice: Number(closePrice),
        closingNotes: null,
      });
      setCloseTarget(null); setClosePrice(0);
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Option positions</h1>
        <p className="text-sm text-muted-foreground">
          Track open and closed short option positions. Analyze rolls and buybacks deterministically.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Open positions" value={`${open.length}`} />
        <Stat label="Open premium (gross)" value={formatCurrency(totalOpenPremium, 0)} tone="profit" />
        <Stat label="Closed positions" value={`${closed.length}`} />
        <Stat label="Realized P/L" value={formatCurrency(totalRealized, 0)} tone={totalRealized >= 0 ? "profit" : "loss"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Open positions</CardTitle>
          <CardDescription>Live positions with roll and buyback analysis.</CardDescription>
        </CardHeader>
        <CardContent>
          {open.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open positions. Record one below.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Strike</TableHead>
                  <TableHead>Expiration</TableHead>
                  <TableHead>DTE</TableHead>
                  <TableHead>Contracts</TableHead>
                  <TableHead>Premium/sh</TableHead>
                  <TableHead>Total credit</TableHead>
                  <TableHead>Open date</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {open.map((p) => {
                  const dte = Math.max(0, Math.round((new Date(p.expiration).getTime() - Date.now()) / 86400000));
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium"><Link href={`/stock/${p.symbol}`} className="hover:underline">{p.symbol}</Link></TableCell>
                      <TableCell><Badge variant="outline">{p.optionType}</Badge></TableCell>
                      <TableCell>{p.strategyType.replace(/_/g, " ")}</TableCell>
                      <TableCell>{formatCurrency(p.strike, 0)}</TableCell>
                      <TableCell>{p.expiration}</TableCell>
                      <TableCell>
                        <Badge variant={dte <= 7 ? "loss" : dte <= 21 ? "warning" : "secondary"}>{dte}</Badge>
                      </TableCell>
                      <TableCell>{p.contracts}</TableCell>
                      <TableCell>{formatCurrency(p.openingCreditDebit)}</TableCell>
                      <TableCell className="text-profit">{formatCurrency(p.openingCreditDebit * p.contracts * 100, 0)}</TableCell>
                      <TableCell>{p.openDate}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => setRollTarget(p)}>
                            <RefreshCw className="mr-1 h-3 w-3" /> Roll
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => { setCloseTarget(p); setClosePrice(0); }}>
                            Close
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-loss" onClick={() => startTransition(() => deleteOptionPosition(p.id))}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Closed positions &amp; trade journal</CardTitle></CardHeader>
        <CardContent>
          {closed.length === 0 ? (
            <p className="text-sm text-muted-foreground">No closed positions yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Strike</TableHead>
                  <TableHead>Expiration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Credit</TableHead>
                  <TableHead>Close cost</TableHead>
                  <TableHead>Realized</TableHead>
                  <TableHead>Close date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {closed.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.symbol}</TableCell>
                    <TableCell>{p.optionType}</TableCell>
                    <TableCell>{formatCurrency(p.strike, 0)}</TableCell>
                    <TableCell>{p.expiration}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[p.status]}>{p.status.replace(/_/g, " ")}</Badge></TableCell>
                    <TableCell className="text-profit">{formatCurrency(p.openingCreditDebit * p.contracts * 100, 0)}</TableCell>
                    <TableCell>{p.closingPrice != null ? formatCurrency(p.closingPrice * p.contracts * 100, 0) : "—"}</TableCell>
                    <TableCell className={cn("font-medium", (p.realizedProfitLoss ?? 0) >= 0 ? "text-profit" : "text-loss")}>
                      {p.realizedProfitLoss != null ? formatCurrency(p.realizedProfitLoss, 0) : "—"}
                    </TableCell>
                    <TableCell>{p.closeDate ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Record new position</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleOpen} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <Field label="Symbol"><Input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="AAPL" required /></Field>
              <Field label="Type">
                <Select value={optionType} onChange={(e) => setOptionType(e.target.value as "CALL" | "PUT")}>
                  <option value="CALL">CALL</option>
                  <option value="PUT">PUT</option>
                </Select>
              </Field>
              <Field label="Strategy">
                <Select value={strategyType} onChange={(e) => setStrategyType(e.target.value as typeof strategyType)}>
                  <option value="COVERED_CALL">Covered Call</option>
                  <option value="CASH_SECURED_PUT">Cash-Secured Put</option>
                  <option value="WHEEL">Wheel</option>
                  <option value="NAKED">Naked</option>
                  <option value="LONG">Long</option>
                  <option value="OTHER">Other</option>
                </Select>
              </Field>
              <Field label="Strike"><Input type="number" step="0.5" value={strike} onChange={(e) => setStrike(e.target.value === "" ? "" : Number(e.target.value))} required /></Field>
              <Field label="Expiration"><Input type="date" value={expiration} onChange={(e) => setExpiration(e.target.value)} required /></Field>
              <Field label="Contracts"><Input type="number" min={1} value={contracts} onChange={(e) => setContracts(e.target.value === "" ? "" : Number(e.target.value))} required /></Field>
              <Field label="Stock price at open"><Input type="number" step="0.01" value={openingPrice} onChange={(e) => setOpeningPrice(e.target.value === "" ? "" : Number(e.target.value))} required /></Field>
              <Field label="Premium $/share (credit positive)"><Input type="number" step="0.01" value={premium} onChange={(e) => setPremium(e.target.value === "" ? "" : Number(e.target.value))} required /></Field>
            </div>
            <Field label="Reason / goal (optional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Monthly income against AAPL lot" /></Field>
            <Button type="submit" disabled={pending}>Record position</Button>
          </form>
        </CardContent>
      </Card>

      {rollTarget && (
        <RollAnalyzerDialog position={rollTarget} onClose={() => setRollTarget(null)} />
      )}

      {closeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Close position</CardTitle>
              <Button size="icon" variant="ghost" onClick={() => setCloseTarget(null)}><X className="h-4 w-4" /></Button>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleClose} className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {closeTarget.symbol} {closeTarget.strike} {closeTarget.optionType} · {closeTarget.contracts} contracts · original credit {formatCurrency(closeTarget.openingCreditDebit)}/share
                </p>
                <Field label="Outcome">
                  <Select value={closeStatus} onChange={(e) => setCloseStatus(e.target.value as typeof closeStatus)}>
                    <option value="BOUGHT_BACK">Bought back (paid to close)</option>
                    <option value="EXPIRED_WORTHLESS">Expired worthless</option>
                    <option value="ASSIGNED">Assigned</option>
                    <option value="ROLLED">Rolled</option>
                    <option value="CLOSED">Other / closed</option>
                  </Select>
                </Field>
                <Field label="Closing cost $/share (0 if expired worthless)">
                  <Input type="number" step="0.01" value={closePrice} onChange={(e) => setClosePrice(e.target.value === "" ? "" : Number(e.target.value))} />
                </Field>
                <div className="text-sm">
                  Realized P/L:{" "}
                  <span className={cn("font-medium", (closeTarget.openingCreditDebit - (typeof closePrice === "number" ? closePrice : 0)) >= 0 ? "text-profit" : "text-loss")}>
                    {formatCurrency((closeTarget.openingCreditDebit - (typeof closePrice === "number" ? closePrice : 0)) * closeTarget.contracts * 100, 0)}
                  </span>
                </div>
                <Button type="submit" disabled={pending}>Confirm close</Button>
              </form>
            </CardContent>
          </Card>
        </div>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
