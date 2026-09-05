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
  Legend,
} from "recharts";
import { TrendingUp, TrendingDown, Activity, AlertTriangle, FlaskConical, Info, CheckCircle2, XCircle, HelpCircle } from "lucide-react";
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

function verdictExplanation(verdict: string): string {
  if (verdict === "significant") {
    return "The strategy's out-of-sample performance is statistically strong enough to trust — even after accounting for all the different weight combinations that were tested. This is the only verdict that suggests real edge.";
  }
  if (verdict === "inconclusive") {
    return "The strategy shows some out-of-sample performance, but it's not strong enough to rule out luck. The number of strategies tested inflates the chance of finding a good one by accident. Treat results with caution.";
  }
  return "The strategy's performance does not survive correction for multiple testing. What looked good in training likely does not work in real trading. Do not trade this signal with real capital.";
}

function buildSummary(data: WalkForwardResponse): { tone: "good" | "caution" | "bad"; lines: string[] } {
  const lines: string[] = [];
  const tone = data.deflated.verdict === "significant" ? "good" : data.deflated.verdict === "inconclusive" ? "caution" : "bad";

  if (data.excessReturn > 0) {
    lines.push(`The signal strategy beat buy-and-hold by ${formatPercent(data.excessReturn, 2)} over the test period.`);
  } else {
    lines.push(`The signal strategy underperformed buy-and-hold by ${formatPercent(Math.abs(data.excessReturn), 2)} — you would have done better just buying and holding.`);
  }

  if (data.sharpeDegradation != null && data.sharpeDegradation > 1) {
    lines.push(`Sharpe degradation of ${formatNumber(data.sharpeDegradation, 2)} means the strategy lost more than 100% of its training performance out-of-sample. This is a classic sign of overfitting — the weights were tuned to fit historical noise, not a real pattern.`);
  } else if (data.sharpeDegradation != null && data.sharpeDegradation > 0.5) {
    lines.push(`Sharpe degradation of ${formatNumber(data.sharpeDegradation, 2)} means the strategy retained about ${formatPercent(1 - data.sharpeDegradation, 0)} of its training performance out-of-sample. Some edge may exist, but it's weaker than training suggested.`);
  } else if (data.sharpeDegradation != null) {
    lines.push(`Sharpe degradation of ${formatNumber(data.sharpeDegradation, 2)} is low — the strategy performed similarly in training and testing. This is a good sign that the edge is real, not curve-fitted.`);
  }

  if (data.oosHitRate > 0.6) {
    lines.push(`${formatPercent(data.oosHitRate, 1)} of trades were profitable — a high hit rate, but check if it comes with small gains and large losses.`);
  } else if (data.oosHitRate < 0.4) {
    lines.push(`Only ${formatPercent(data.oosHitRate, 1)} of trades were profitable — the strategy relies on large winners to offset frequent small losses.`);
  } else {
    lines.push(`${formatPercent(data.oosHitRate, 1)} of trades were profitable — a balanced win/loss profile.`);
  }

  if (data.oosTimeInMarket < 0.3) {
    lines.push(`The strategy was only invested ${formatPercent(data.oosTimeInMarket, 0)} of the time — it sits in cash frequently, which may explain lower returns but also lower risk.`);
  } else {
    lines.push(`The strategy was invested ${formatPercent(data.oosTimeInMarket, 0)} of the time.`);
  }

  lines.push(`Maximum drawdown was ${formatPercent(data.oosMaxDrawdown, 2)} — the worst peak-to-trough decline during the out-of-sample period.`);

  return { tone, lines };
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
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 space-y-2">
            <p className="text-sm font-medium flex items-center gap-2">
              <Info className="h-4 w-4 text-blue-500" />
              What this tool does
            </p>
            <p className="text-sm text-muted-foreground">
              This tool tests whether a <strong>factor-based trading signal</strong> (momentum, trend, mean
              reversion, volatility) actually works on data it has never seen before. It splits historical
              prices into <strong>training</strong> and <strong>testing</strong> segments, finds the best
              factor weights on training data, then applies those weights to the testing data. The
              out-of-sample (OOS) results are the honest track record — not a curve-fit fantasy.
            </p>
            <p className="text-sm text-muted-foreground">
              The <strong>Deflated Sharpe Ratio</strong> further corrects for &quot;how many strategies did
              you try?&quot; — because if you test 200 combinations, the best one will look great by pure
              chance. This is the number to actually trust.
            </p>
          </div>

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
              <p className="text-xs text-muted-foreground mt-1">Any stock or ETF ticker</p>
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
                <option value="max">Max Available</option>
              </select>
              <p className="text-xs text-muted-foreground mt-1">More data = more meaningful folds</p>
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
              <p className="text-xs text-muted-foreground mt-1">How many train/test splits to use</p>
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
              <p className="text-xs text-muted-foreground mt-1">Round-trip cost per trade in basis points</p>
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
  const summary = buildSummary(data);

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
              {data.barsAnalyzed} trading days analyzed ({data.dataRange}) via {data.dataSource}
            </p>
          )}
          {data.modelCaveat && (
            <p className="text-xs italic text-muted-foreground">{data.modelCaveat}</p>
          )}
        </CardContent>
      </Card>

      {/* Plain-English Verdict Banner */}
      <Card className={cn(
        "border-2",
        summary.tone === "good" && "border-green-500/30 bg-green-500/5",
        summary.tone === "caution" && "border-amber-500/30 bg-amber-500/5",
        summary.tone === "bad" && "border-red-500/30 bg-red-500/5",
      )}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {summary.tone === "good" ? (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            ) : summary.tone === "caution" ? (
              <HelpCircle className="h-5 w-5 text-amber-500" />
            ) : (
              <XCircle className="h-5 w-5 text-red-500" />
            )}
            What this means for you
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">Verdict:</span>
            <Badge
              variant={
                data.deflated.verdict === "significant" ? "profit" :
                data.deflated.verdict === "inconclusive" ? "warning" : "loss"
              }
            >
              {data.deflated.verdict.toUpperCase()}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{verdictExplanation(data.deflated.verdict)}</p>
          <div className="border-t pt-3 space-y-2">
            {summary.lines.map((line, i) => (
              <p key={i} className="text-sm text-muted-foreground flex gap-2">
                <span className="text-primary">•</span>
                {line}
              </p>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Key Metrics — with explanations */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground flex items-center gap-1">
              OOS Sharpe Ratio
              <HelpCircle className="h-3 w-3 text-muted-foreground/50" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data.oosSharpe != null ? formatNumber(data.oosSharpe, 2) : "—"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Risk-adjusted return on <strong>unseen</strong> data. &gt;1 = good, &gt;2 = excellent, &lt;0 = losing.
            </p>
            {data.buyHoldSharpe != null && (
              <p className="text-xs text-muted-foreground mt-1">
                Buy &amp; Hold Sharpe: {formatNumber(data.buyHoldSharpe, 2)}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground flex items-center gap-1">
              Deflated Sharpe Ratio
              <HelpCircle className="h-3 w-3 text-muted-foreground/50" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data.deflated.deflatedSharpe != null ? formatNumber(data.deflated.deflatedSharpe, 2) : "—"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Adjusted for how many strategies were tested. This is the number to trust — it filters out luck.
            </p>
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
            <CardTitle className="text-xs uppercase text-muted-foreground flex items-center gap-1">
              OOS Total Return
              <HelpCircle className="h-3 w-3 text-muted-foreground/50" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn(
              "text-2xl font-bold flex items-center gap-1",
              data.oosTotalReturn >= 0 ? "text-profit" : "text-loss",
            )}>
              {data.oosTotalReturn >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
              {formatPercent(data.oosTotalReturn, 2)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Total return during test periods only (data the strategy never saw).
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              vs Buy &amp; Hold: {formatPercent(data.buyHoldReturn, 2)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground flex items-center gap-1">
              Sharpe Degradation
              <HelpCircle className="h-3 w-3 text-muted-foreground/50" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn(
              "text-2xl font-bold",
              isOverfit ? "text-loss" : data.sharpeDegradation != null && data.sharpeDegradation > 0.5 ? "text-warning" : "",
            )}>
              {data.sharpeDegradation != null ? formatNumber(data.sharpeDegradation, 2) : "—"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              How much performance dropped from training to testing. &lt;0.5 = robust, &gt;1 = overfit.
            </p>
            <p className={cn("text-xs mt-1", isOverfit ? "text-loss font-medium" : "text-muted-foreground")}>
              {isOverfit ? "Overfitting detected — strategy fit noise, not signal" : "Acceptable train-to-test gap"}
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
          <CardContent className="space-y-3 text-sm">
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
            <div className="border-t pt-2 text-xs text-muted-foreground">
              <p><strong>Train Sharpe</strong> = how well the strategy performed on the data used to tune it.</p>
              <p className="mt-1"><strong>OOS Sharpe</strong> = how well it performed on data it never saw.</p>
              <p className="mt-1"><strong>Degradation</strong> = the gap between the two. A big gap means the strategy was tuned to fit historical noise rather than a real pattern.</p>
              <p className="mt-1"><strong>PSR</strong> = Probabilistic Sharpe Ratio. &gt;0.95 = high confidence the edge is real.</p>
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
          <CardContent className="space-y-3 text-sm">
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
            <div className="border-t pt-2 text-xs text-muted-foreground">
              <p><strong>Excess return</strong> = strategy return minus buy-and-hold return. Positive means the signal added value.</p>
              <p className="mt-1"><strong>Hit rate</strong> = percentage of trades that were profitable.</p>
              <p className="mt-1"><strong>Time in market</strong> = how often the strategy was actually invested. Low = mostly in cash.</p>
              <p className="mt-1"><strong>Max drawdown</strong> = worst peak-to-trough decline. This is the pain you'd have to sit through.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Equity Curve */}
      {data.oosEquityCurve.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Out-of-Sample Equity Curve</CardTitle>
            <p className="text-xs text-muted-foreground">
              $100 invested at the start of the test period. Green = strategy, Blue dashed = buy &amp; hold.
              If green is above blue, the signal added value.
            </p>
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
                <Legend />
                <ReferenceLine y={100} stroke="gray" strokeDasharray="2 2" label={{ value: "Start ($100)", fontSize: 10, position: "insideTopLeft" }} />
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
            <p className="text-xs text-muted-foreground">
              Each fold is a separate train/test split. The strategy is tuned on the train period, then tested on the test period.
              If test Sharpe is much lower than train Sharpe across multiple folds, the strategy is overfitting.
            </p>
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
                    <TableCell className={cn(
                      "text-right font-mono",
                      f.testSharpe != null && f.trainSharpe != null && f.testSharpe < f.trainSharpe * 0.3 && "text-loss",
                    )}>
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
            <p className="text-xs text-muted-foreground">
              The weight the optimizer chose for each factor during training. If weights swing wildly between folds,
              the strategy is unstable — it's fitting noise, not a persistent pattern. Stable weights across folds
              suggest a more robust signal.
            </p>
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
            <div className="mt-3 text-xs text-muted-foreground space-y-1">
              <p><strong>momentum3m / momentum12m</strong> = weight on 3-month / 12-month price momentum</p>
              <p><strong>trend200</strong> = weight on price vs 200-day moving average</p>
              <p><strong>meanReversion</strong> = weight on 20-day z-score (stretched-down = buy)</p>
              <p><strong>lowVol</strong> = weight on contracting volatility</p>
            </div>
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
