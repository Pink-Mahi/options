"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { TrendingUp, TrendingDown, Activity, AlertTriangle, FlaskConical } from "lucide-react";
import { cn, formatPercent, formatNumber } from "@/lib/utils";

interface FoldData {
  fold: number;
  trainRange: { startDate: string; endDate: string; bars: number };
  testRange: { startDate: string; endDate: string; bars: number };
  selectedWeights: Record<string, number>;
  trainSharpe: number | null;
  testSharpe: number | null;
  testReturn: number;
  testTrades: number;
  timeInMarket: number;
}

interface WalkForwardResponse {
  symbol: string;
  folds: FoldData[];
  candidatesPerFold: number;
  totalTrials: number;
  oosReturns: number[];
  oosEquityCurve: { date: string; equity: number; buyHoldEquity: number }[];
  oosSharpe: number | null;
  oosSortino: number | null;
  oosTotalReturn: number;
  oosMaxDrawdown: number;
  oosHitRate: number;
  oosTimeInMarket: number;
  totalTrades: number;
  meanTrainSharpe: number | null;
  sharpeDegradation: number | null;
  deflated: {
    deflatedSharpe: number | null;
    verdict: string;
    trials: number;
    psr: number | null;
  };
  buyHoldReturn: number;
  buyHoldSharpe: number | null;
  excessReturn: number;
  warnings: string[];
  dataSource?: string;
  dataRange?: string;
  barsAnalyzed?: number;
  modelCaveat?: string;
}

export function WalkForwardView() {
  const [symbol, setSymbol] = useState("");
  const [range, setRange] = useState("10y");
  const [folds, setFolds] = useState("4");
  const [costBps, setCostBps] = useState("10");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<WalkForwardResponse | null>(null);

  async function runValidation() {
    if (!symbol.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch("/api/walk-forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: symbol.toUpperCase().trim(),
          range,
          folds: Number(folds),
          costBps: Number(costBps),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Validation failed");
      setData(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (!data && !loading && !error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            Walk-Forward Signal Validation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Run out-of-sample validation on a symbol&apos;s historical prices. The signal engine extracts
            point-in-time factors (momentum, trend, mean reversion, volatility), sweeps candidate weight
            vectors on each training fold, selects the best on train only, and applies it to the test fold.
            The Deflated Sharpe Ratio corrects for the number of strategies searched.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="wf-symbol" className="text-sm font-medium">Symbol</label>
              <Input
                id="wf-symbol"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="e.g. AAPL"
                onKeyDown={(e) => e.key === "Enter" && runValidation()}
              />
            </div>
            <div>
              <label htmlFor="wf-range" className="text-sm font-medium">History Range</label>
              <select
                id="wf-range"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={range}
                onChange={(e) => setRange(e.target.value)}
              >
                <option value="3y">3 Years</option>
                <option value="5y">5 Years</option>
                <option value="10y">10 Years</option>
                <option value="max">Max</option>
              </select>
            </div>
            <div>
              <label htmlFor="wf-folds" className="text-sm font-medium">Folds (2-8)</label>
              <Input
                id="wf-folds"
                type="number"
                min={2}
                max={8}
                value={folds}
                onChange={(e) => setFolds(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="wf-cost" className="text-sm font-medium">Cost (bps)</label>
              <Input
                id="wf-cost"
                type="number"
                min={0}
                value={costBps}
                onChange={(e) => setCostBps(e.target.value)}
              />
            </div>
          </div>
          <Button onClick={runValidation} disabled={!symbol.trim() || loading}>
            <FlaskConical className="mr-2 h-4 w-4" />
            Run Validation
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center space-y-2">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">Running walk-forward validation...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="space-y-4 py-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <span className="font-medium">Error</span>
          </div>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={() => { setError(null); setSymbol(""); }}>
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const oosBeatsBuyHold = data.excessReturn > 0;
  const isOverfit = data.sharpeDegradation != null && data.sharpeDegradation > 1;

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5" />
              Walk-Forward Validation: {data.symbol}
            </span>
            <Button variant="outline" size="sm" onClick={() => { setData(null); setSymbol(""); }}>
              New Run
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.dataRange && (
            <p className="text-xs text-muted-foreground">
              {data.barsAnalyzed} bars analyzed ({data.dataRange}) via {data.dataSource}
            </p>
          )}
          {data.modelCaveat && (
            <p className="text-xs italic text-muted-foreground">{data.modelCaveat}</p>
          )}
        </CardContent>
      </Card>

      {/* Key Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">OOS Sharpe</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data.oosSharpe != null ? formatNumber(data.oosSharpe, 2) : "—"}
            </div>
            {data.buyHoldSharpe != null && (
              <p className="text-xs text-muted-foreground">
                Buy &amp; Hold: {formatNumber(data.buyHoldSharpe, 2)}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">Deflated Sharpe</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data.deflated.deflatedSharpe != null ? formatNumber(data.deflated.deflatedSharpe, 2) : "—"}
            </div>
            <Badge
              variant={
                data.deflated.verdict === "significant" ? "profit" :
                data.deflated.verdict === "inconclusive" ? "warning" : "loss"
              }
              className="mt-1"
            >
              {data.deflated.verdict}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">OOS Total Return</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn(
              "text-2xl font-bold flex items-center gap-1",
              data.oosTotalReturn >= 0 ? "text-profit" : "text-loss",
            )}>
              {data.oosTotalReturn >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
              {formatPercent(data.oosTotalReturn, 2)}
            </div>
            <p className="text-xs text-muted-foreground">
              vs Buy &amp; Hold: {formatPercent(data.buyHoldReturn, 2)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">Sharpe Degradation</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn(
              "text-2xl font-bold",
              isOverfit ? "text-loss" : data.sharpeDegradation != null && data.sharpeDegradation > 0.5 ? "text-warning" : "",
            )}>
              {data.sharpeDegradation != null ? formatNumber(data.sharpeDegradation, 2) : "—"}
            </div>
            <p className="text-xs text-muted-foreground">
              {isOverfit ? "Overfitting detected" : "Train vs OOS gap"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Overfitting & Excess Return Summary */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4" />
              Overfitting Assessment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Mean Train Sharpe</span>
              <span className="font-mono">{data.meanTrainSharpe != null ? formatNumber(data.meanTrainSharpe, 2) : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">OOS Sharpe</span>
              <span className="font-mono">{data.oosSharpe != null ? formatNumber(data.oosSharpe, 2) : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Degradation</span>
              <span className={cn("font-mono", isOverfit && "text-loss")}>
                {data.sharpeDegradation != null ? formatNumber(data.sharpeDegradation, 2) : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Candidates searched</span>
              <span className="font-mono">{data.candidatesPerFold} per fold</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total trials</span>
              <span className="font-mono">{data.totalTrials}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">PSR</span>
              <span className="font-mono">{data.deflated.psr != null ? formatNumber(data.deflated.psr, 4) : "—"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <TrendingUp className="h-4 w-4" />
              Strategy vs Buy &amp; Hold
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Strategy return</span>
              <span className={cn("font-mono", data.oosTotalReturn >= 0 ? "text-profit" : "text-loss")}>
                {formatPercent(data.oosTotalReturn, 2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Buy &amp; Hold return</span>
              <span className="font-mono">{formatPercent(data.buyHoldReturn, 2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Excess return</span>
              <span className={cn("font-mono", oosBeatsBuyHold ? "text-profit" : "text-loss")}>
                {formatPercent(data.excessReturn, 2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Hit rate</span>
              <span className="font-mono">{formatPercent(data.oosHitRate, 1)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Time in market</span>
              <span className="font-mono">{formatPercent(data.oosTimeInMarket, 1)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max drawdown</span>
              <span className="font-mono text-loss">{formatPercent(data.oosMaxDrawdown, 2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total trades</span>
              <span className="font-mono">{data.totalTrades}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Equity Curve */}
      {data.oosEquityCurve.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Out-of-Sample Equity Curve</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data.oosEquityCurve}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: string) => v.slice(0, 7)}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v: number) => formatNumber(v, 2)}
                  labelFormatter={(l: string) => l}
                />
                <ReferenceLine y={100} stroke="gray" strokeDasharray="2 2" />
                <Line
                  type="monotone"
                  dataKey="equity"
                  stroke="#22c55e"
                  strokeWidth={2}
                  name="Strategy"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="buyHoldEquity"
                  stroke="#6366f1"
                  strokeWidth={2}
                  name="Buy & Hold"
                  dot={false}
                  strokeDasharray="4 4"
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Fold Details */}
      {data.folds.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Fold Details</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fold</TableHead>
                  <TableHead>Train Period</TableHead>
                  <TableHead>Test Period</TableHead>
                  <TableHead className="text-right">Train Sharpe</TableHead>
                  <TableHead className="text-right">Test Sharpe</TableHead>
                  <TableHead className="text-right">Test Return</TableHead>
                  <TableHead className="text-right">Trades</TableHead>
                  <TableHead className="text-right">Time In Mkt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.folds.map((f) => (
                  <TableRow key={f.fold}>
                    <TableCell className="font-medium">{f.fold}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {f.trainRange.startDate} → {f.trainRange.endDate}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {f.testRange.startDate} → {f.testRange.endDate}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {f.trainSharpe != null ? formatNumber(f.trainSharpe, 2) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {f.testSharpe != null ? formatNumber(f.testSharpe, 2) : "—"}
                    </TableCell>
                    <TableCell className={cn(
                      "text-right font-mono",
                      f.testReturn >= 0 ? "text-profit" : "text-loss",
                    )}>
                      {formatPercent(f.testReturn, 2)}
                    </TableCell>
                    <TableCell className="text-right font-mono">{f.testTrades}</TableCell>
                    <TableCell className="text-right font-mono">{formatPercent(f.timeInMarket, 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Selected Weights per Fold */}
      {data.folds.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Selected Factor Weights by Fold</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fold</TableHead>
                  {Object.keys(data.folds[0]?.selectedWeights ?? {}).map((k) => (
                    <TableHead key={k} className="text-right">{k}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.folds.map((f) => (
                  <TableRow key={f.fold}>
                    <TableCell className="font-medium">{f.fold}</TableCell>
                    {Object.entries(f.selectedWeights).map(([k, v]) => (
                      <TableCell key={k} className="text-right font-mono">
                        {formatNumber(v, 2)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Warnings */}
      {data.warnings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4" />
              Warnings ({data.warnings.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {data.warnings.map((w, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-warning">•</span>
                  {w}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
