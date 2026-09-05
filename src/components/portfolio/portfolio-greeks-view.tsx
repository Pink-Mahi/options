"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn, formatCurrency, formatPercent, formatNumber } from "@/lib/utils";

interface PositionGreeks {
  positionId: string;
  symbol: string;
  optionType: "CALL" | "PUT";
  strike: number;
  expiration: string;
  contracts: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  deltaDollars: number;
}

interface AssignmentRisk {
  symbol: string;
  positionId: string;
  optionType: "CALL" | "PUT";
  strike: number;
  expiration: string;
  dte: number;
  currentPrice: number;
  intrinsicValue: number;
  itm: boolean;
  estimatedAssignmentProb: number;
  contracts: number;
  sharesAtRisk: number;
}

interface PortfolioGreeksResponse {
  stockDelta: number;
  optionDelta: number;
  totalDelta: number;
  totalDeltaDollars: number;
  optionGamma: number;
  optionTheta: number;
  optionVega: number;
  netTheta: number;
  positions: PositionGreeks[];
  assignmentRisk: AssignmentRisk[];
  warnings: string[];
}

export function PortfolioGreeksView() {
  const [data, setData] = useState<PortfolioGreeksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/portfolio/greeks", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<PortfolioGreeksResponse>;
      })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground">Calculating portfolio Greeks…</p>;
  if (error) return <p className="text-sm text-loss">{error}</p>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-3">
            <div className="text-xs uppercase text-muted-foreground">Stock delta (shares)</div>
            <div className="text-xl font-bold tabular">{formatNumber(data.stockDelta, 0)}</div>
            <div className="text-xs text-muted-foreground">{formatCurrency(data.stockDelta * 100, 0)} notional</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs uppercase text-muted-foreground">Option delta</div>
            <div className={cn("text-xl font-bold tabular", data.optionDelta < 0 ? "text-loss" : "text-profit")}>
              {formatNumber(data.optionDelta, 0)}
            </div>
            <div className="text-xs text-muted-foreground">short calls reduce delta</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs uppercase text-muted-foreground">Net portfolio delta</div>
            <div className={cn("text-xl font-bold tabular", data.totalDelta < 0 ? "text-loss" : "text-profit")}>
              {formatNumber(data.totalDelta, 0)}
            </div>
            <div className="text-xs text-muted-foreground">{formatCurrency(data.totalDeltaDollars, 0)}/1% move</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs uppercase text-muted-foreground">Net theta ($/day)</div>
            <div className={cn("text-xl font-bold tabular", data.netTheta > 0 ? "text-profit" : "text-loss")}>
              {formatCurrency(data.netTheta, 2)}
            </div>
            <div className="text-xs text-muted-foreground">{data.netTheta > 0 ? "collecting decay" : "paying decay"}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-xs uppercase text-muted-foreground">Portfolio gamma</div>
            <div className="text-lg font-bold tabular">{formatNumber(data.optionGamma, 2)}</div>
            <div className="text-xs text-muted-foreground">delta change per $1 move</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs uppercase text-muted-foreground">Portfolio vega</div>
            <div className="text-lg font-bold tabular">{formatNumber(data.optionVega, 2)}</div>
            <div className="text-xs text-muted-foreground">$ per 1% IV change</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs uppercase text-muted-foreground">Open positions</div>
            <div className="text-lg font-bold tabular">{data.positions.length}</div>
            <div className="text-xs text-muted-foreground">{data.assignmentRisk.filter((a) => a.itm).length} ITM</div>
          </CardContent>
        </Card>
      </div>

      {data.warnings.length > 0 && (
        <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
          {data.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}</div>
          ))}
        </div>
      )}

      {/* Assignment risk heatmap */}
      {data.assignmentRisk.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Assignment risk</CardTitle>
            <CardDescription>Estimated probability of assignment for each open short position. ITM positions expiring soon are highest risk.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Strike</TableHead>
                  <TableHead>Expiration</TableHead>
                  <TableHead>DTE</TableHead>
                  <TableHead>Current</TableHead>
                  <TableHead>Intrinsic</TableHead>
                  <TableHead>ITM</TableHead>
                  <TableHead>Assign prob</TableHead>
                  <TableHead>Contracts</TableHead>
                  <TableHead>Shares at risk</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.assignmentRisk.map((a) => (
                  <TableRow
                    key={a.positionId}
                    className={cn(
                      a.estimatedAssignmentProb > 0.6 && "bg-loss/10",
                      a.estimatedAssignmentProb > 0.3 && a.estimatedAssignmentProb <= 0.6 && "bg-amber-500/10",
                    )}
                  >
                    <TableCell className="font-medium">{a.symbol}</TableCell>
                    <TableCell><Badge variant="outline">{a.optionType}</Badge></TableCell>
                    <TableCell>{formatCurrency(a.strike, 0)}</TableCell>
                    <TableCell>{a.expiration}</TableCell>
                    <TableCell>
                      <Badge variant={a.dte <= 7 ? "loss" : a.dte <= 21 ? "warning" : "secondary"}>{a.dte}</Badge>
                    </TableCell>
                    <TableCell>{formatCurrency(a.currentPrice)}</TableCell>
                    <TableCell className={cn(a.intrinsicValue > 0 && "text-loss")}>{formatCurrency(a.intrinsicValue)}</TableCell>
                    <TableCell>{a.itm ? <Badge variant="warning">ITM</Badge> : <Badge variant="outline">OTM</Badge>}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {a.estimatedAssignmentProb > 0.5 ? (
                          <TrendingDown className="h-3 w-3 text-loss" />
                        ) : a.estimatedAssignmentProb > 0.3 ? (
                          <AlertTriangle className="h-3 w-3 text-amber-500" />
                        ) : (
                          <TrendingUp className="h-3 w-3 text-profit" />
                        )}
                        <span className={cn(
                          "font-medium tabular",
                          a.estimatedAssignmentProb > 0.5 && "text-loss",
                          a.estimatedAssignmentProb > 0.3 && a.estimatedAssignmentProb <= 0.5 && "text-amber-500",
                          a.estimatedAssignmentProb <= 0.3 && "text-profit",
                        )}>
                          {formatPercent(a.estimatedAssignmentProb, 0)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>{a.contracts}</TableCell>
                    <TableCell>{a.sharesAtRisk}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Position Greeks table */}
      {data.positions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Position Greeks (seller&apos;s perspective)</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Strike</TableHead>
                  <TableHead>Expiration</TableHead>
                  <TableHead>Contracts</TableHead>
                  <TableHead>Δ</TableHead>
                  <TableHead>Γ</TableHead>
                  <TableHead>Θ ($/day)</TableHead>
                  <TableHead>ν</TableHead>
                  <TableHead>Δ$ /1%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.positions.map((p) => (
                  <TableRow key={p.positionId}>
                    <TableCell className="font-medium">{p.symbol}</TableCell>
                    <TableCell><Badge variant="outline">{p.optionType}</Badge></TableCell>
                    <TableCell>{formatCurrency(p.strike, 0)}</TableCell>
                    <TableCell>{p.expiration}</TableCell>
                    <TableCell>{p.contracts}</TableCell>
                    <TableCell className={cn("tabular", p.delta < 0 ? "text-loss" : "text-profit")}>{formatNumber(p.delta, 0)}</TableCell>
                    <TableCell className="tabular">{formatNumber(p.gamma, 2)}</TableCell>
                    <TableCell className={cn("tabular", p.theta > 0 ? "text-profit" : "text-loss")}>{formatCurrency(p.theta, 2)}</TableCell>
                    <TableCell className="tabular">{formatNumber(p.vega, 2)}</TableCell>
                    <TableCell className="tabular">{formatCurrency(p.deltaDollars, 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {data.positions.length === 0 && (
        <p className="text-sm text-muted-foreground">No open option positions. Record positions on the Positions page to see portfolio Greeks.</p>
      )}
    </div>
  );
}
