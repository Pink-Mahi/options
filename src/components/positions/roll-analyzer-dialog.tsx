"use client";

import { useEffect, useState } from "react";
import { X, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn, formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import type { OptionPosition } from "@/lib/types";
import type { RollAnalysis, RollCandidate } from "@/features/options/roll-analyzer";

export function RollAnalyzerDialog({ position, onClose }: { position: OptionPosition; onClose: () => void }) {
  const [analysis, setAnalysis] = useState<RollAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/positions/roll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position }),
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = (await r.json()) as RollAnalysis;
        if (!cancelled) setAnalysis(body);
      })
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [position]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="max-h-[85vh] w-full max-w-3xl overflow-y-auto">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            Roll &amp; buyback analysis: {position.symbol} {position.strike} {position.optionType} · {position.expiration}
          </CardTitle>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && <p className="text-sm text-muted-foreground">Analyzing current quotes and roll candidates…</p>}
          {error && <p className="text-sm text-loss">{error}</p>}

          {analysis && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Card>
                  <CardContent className="p-3">
                    <div className="text-xs uppercase text-muted-foreground">Current stock</div>
                    <div className="text-lg font-bold">{formatCurrency(analysis.currentStockPrice)}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <div className="text-xs uppercase text-muted-foreground">Days to expiration</div>
                    <div className="text-lg font-bold">{analysis.holdToExpiration.daysToExpiration}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <div className="text-xs uppercase text-muted-foreground">Intrinsic value (ITM)</div>
                    <div className={cn("text-lg font-bold", analysis.holdToExpiration.currentIntrinsicValue > 0 ? "text-loss" : "text-profit")}>
                      {formatCurrency(analysis.holdToExpiration.currentIntrinsicValue)}
                      {analysis.holdToExpiration.currentIntrinsicValue > 0 ? " ITM" : " OTM"}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader><CardTitle className="text-sm">Option 1: Hold to expiration</CardTitle></CardHeader>
                <CardContent className="text-sm">
                  If the option expires worthless, you keep the full original credit of{" "}
                  <span className="font-medium text-profit">{formatCurrency(analysis.holdToExpiration.maxRemainingProfit, 0)}</span>.
                  If assigned, you face the intrinsic value shown above.
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-sm">Option 2: Buy back now</CardTitle></CardHeader>
                <CardContent className="text-sm space-y-1">
                  {analysis.buybackNow.askPrice != null ? (
                    <>
                      <div className="flex justify-between"><span className="text-muted-foreground">Current ask</span><span>{formatCurrency(analysis.buybackNow.askPrice)}/share</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Cost to close</span><span>{formatCurrency(analysis.buybackNow.cost ?? 0, 0)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Realized P/L</span><span className={cn("font-medium", (analysis.buybackNow.realizedProfit ?? 0) >= 0 ? "text-profit" : "text-loss")}>{formatCurrency(analysis.buybackNow.realizedProfit ?? 0, 0)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">% of max captured</span><span>{formatPercent(analysis.buybackNow.percentOfMaxCaptured ?? 0)}</span></div>
                    </>
                  ) : (
                    <p className="text-muted-foreground">Could not fetch the current ask for this contract.</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-sm">Option 3: Roll to a later expiration</CardTitle></CardHeader>
                <CardContent>
                  {analysis.rollCandidates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No roll candidates found in future expirations.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Expiration</TableHead>
                          <TableHead>DTE</TableHead>
                          <TableHead>Strike</TableHead>
                          <TableHead>Buyback</TableHead>
                          <TableHead>New premium</TableHead>
                          <TableHead>Net credit</TableHead>
                          <TableHead>Extra days</TableHead>
                          <TableHead>Ann. net*</TableHead>
                          <TableHead>Δ</TableHead>
                          <TableHead>Rationale</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {analysis.rollCandidates.map((r: RollCandidate, i) => (
                          <TableRow key={i}>
                            <TableCell>{r.expiration}</TableCell>
                            <TableCell>{r.dte}</TableCell>
                            <TableCell>{formatCurrency(r.strike, 0)}</TableCell>
                            <TableCell className="text-loss">{formatCurrency(r.buybackCost)}</TableCell>
                            <TableCell className="text-profit">{formatCurrency(r.newPremium)}</TableCell>
                            <TableCell className={cn("font-medium", r.netCredit >= 0 ? "text-profit" : "text-loss")}>{formatCurrency(r.netCredit)}</TableCell>
                            <TableCell>{r.extraDays}</TableCell>
                            <TableCell>{formatPercent(r.annualizedNetCredit)}</TableCell>
                            <TableCell>{r.newDelta != null ? formatNumber(r.newDelta, 2) : "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{r.rationale}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              {analysis.warnings.length > 0 && (
                <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
                  {analysis.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-1"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}</div>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                * Annualized rates are comparison tools only, not expected returns. Rolling extends commitment and may defer assignment risk rather than eliminate it.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
