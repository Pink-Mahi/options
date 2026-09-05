"use client";

import { useEffect, useState } from "react";
import { Activity, Brain, AlertTriangle, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, Input, Label } from "@/components/ui";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
  ComposedChart,
} from "recharts";
import { cn, formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import type { StockData } from "@/features/options/stock-data";
import type { TechnicalIndicators } from "@/lib/calculations/indicators";

interface PatternAnalysisResponse {
  symbol: string;
  analysis: string;
  aiPowered: boolean;
  warnings: string[];
}

export function TechnicalAnalysisTab({ data }: { data: StockData }) {
  const [indicators, setIndicators] = useState<TechnicalIndicators | null>(null);
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState<PatternAnalysisResponse | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [horizon, setHorizon] = useState(30);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/stock/${encodeURIComponent(data.symbol)}/indicators`, { cache: "no-store" })
      .then((r) => r.json())
      .then((b: TechnicalIndicators) => !cancelled && setIndicators(b))
      .catch(() => !cancelled && setIndicators(null))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [data.symbol]);

  const [analysisError, setAnalysisError] = useState<string | null>(null);

  function runAnalysis() {
    setAnalysisLoading(true);
    setAnalysisError(null);
    setAnalysis(null);
    fetch(`/api/stock/${encodeURIComponent(data.symbol)}/pattern-analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ horizon }),
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((b: PatternAnalysisResponse) => {
        if (!b.analysis) {
          throw new Error("AI returned an empty response. Try again or adjust the horizon.");
        }
        setAnalysis(b);
      })
      .catch((e: Error) => setAnalysisError(e.message))
      .finally(() => setAnalysisLoading(false));
  }

  if (loading) return <p className="text-sm text-muted-foreground">Computing technical indicators…</p>;
  if (!indicators) return <p className="text-sm text-loss">Failed to load indicators.</p>;

  const biasColor = indicators.summary.overallBias === "bullish" ? "text-profit" : indicators.summary.overallBias === "bearish" ? "text-loss" : "text-muted-foreground";
  const BiasIcon = indicators.summary.overallBias === "bullish" ? TrendingUp : indicators.summary.overallBias === "bearish" ? TrendingDown : Minus;

  return (
    <div className="space-y-4">
      {/* Signal summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" /> Technical indicator summary
          </CardTitle>
          <CardDescription>{indicators.summary.signalCount.bullish} bullish · {indicators.summary.signalCount.bearish} bearish · {indicators.summary.signalCount.neutral} neutral signals</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <BiasIcon className={cn("h-6 w-6", biasColor)} />
            <span className={cn("text-2xl font-bold", biasColor)}>
              {indicators.summary.overallBias.toUpperCase()}
            </span>
            <Badge variant="outline" className="ml-2">{data.symbol} @ {formatCurrency(indicators.currentPrice)}</Badge>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <SignalColumn title="Bullish" signals={indicators.summary.bullishSignals} tone="profit" />
            <SignalColumn title="Bearish" signals={indicators.summary.bearishSignals} tone="loss" />
            <SignalColumn title="Neutral" signals={indicators.summary.neutralSignals} tone="muted" />
          </div>

          {indicators.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Signal Score Gauge & Trade Levels */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4" /> Signal Score & Trade Levels
          </CardTitle>
          <CardDescription>Weighted score from all 17 indicators. Educational only — not financial advice.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Gauge bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Signal Score</span>
              <span className={cn(
                "text-lg font-bold",
                indicators.signalScore.score > 20 ? "text-profit" : indicators.signalScore.score < -20 ? "text-loss" : "text-muted-foreground"
              )}>
                {indicators.signalScore.score > 0 ? "+" : ""}{indicators.signalScore.score} / 100
              </span>
            </div>
            <div className="relative h-8 rounded-full overflow-hidden bg-gradient-to-r from-red-500 via-yellow-400 to-green-500">
              <div
                className="absolute top-0 bottom-0 w-1 bg-white border-x border-gray-800 shadow-lg"
                style={{ left: `${((indicators.signalScore.score + 100) / 200) * 100}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Strong Sell</span><span>Sell</span><span>Neutral</span><span>Buy</span><span>Strong Buy</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={indicators.signalScore.label.includes("buy") ? "profit" : indicators.signalScore.label.includes("sell") ? "loss" : "outline"}>
                {indicators.signalScore.label.replace("_", " ").toUpperCase()}
              </Badge>
            </div>
          </div>

          {/* Component breakdown */}
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Indicator contributions ({indicators.signalScore.components.length})</summary>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {indicators.signalScore.components.map((c, i) => (
                <div key={i} className="flex items-center justify-between rounded px-2 py-0.5 hover:bg-muted/50">
                  <span className="text-muted-foreground">{c.name}</span>
                  <span className={cn("tabular font-medium", c.value > 0.1 ? "text-profit" : c.value < -0.1 ? "text-loss" : "text-muted-foreground")}>
                    {c.value > 0 ? "+" : ""}{c.value.toFixed(2)} (w{c.weight})
                  </span>
                </div>
              ))}
            </div>
          </details>

          {/* Buy / Sell zones */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-profit/30 bg-profit/5 p-3">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-4 w-4 text-profit" />
                <span className="text-sm font-semibold text-profit">Buy Zone</span>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Entry (upper)</span><span className="tabular font-medium">{formatCurrency(indicators.tradeLevels.buyZone.upper)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Lower bound</span><span className="tabular font-medium">{formatCurrency(indicators.tradeLevels.buyZone.lower)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Stop loss</span><span className="tabular font-medium text-loss">{formatCurrency(indicators.tradeLevels.stopLoss)}</span></div>
              </div>
            </div>
            <div className="rounded-lg border border-loss/30 bg-loss/5 p-3">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown className="h-4 w-4 text-loss" />
                <span className="text-sm font-semibold text-loss">Sell Zone</span>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Exit (lower)</span><span className="tabular font-medium">{formatCurrency(indicators.tradeLevels.sellZone.lower)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Upper bound</span><span className="tabular font-medium">{formatCurrency(indicators.tradeLevels.sellZone.upper)}</span></div>
                <div className="pt-1">
                  <span className="text-muted-foreground text-xs">Targets: </span>
                  {indicators.tradeLevels.targets.map((t, i) => (
                    <span key={i} className="ml-1 inline-block rounded bg-profit/10 px-1.5 py-0.5 text-xs font-medium text-profit">{formatCurrency(t)}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Support / Resistance levels */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Support levels (below price)</span>
              {indicators.tradeLevels.supports.map((s, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{s.source}</span>
                  <span className="tabular font-medium text-profit">{formatCurrency(s.level)}</span>
                </div>
              ))}
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Resistance levels (above price)</span>
              {indicators.tradeLevels.resistances.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{r.source}</span>
                  <span className="tabular font-medium text-loss">{formatCurrency(r.level)}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Key indicators grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <IndicatorCard
          title="RSI (14)"
          value={indicators.rsi.current != null ? formatNumber(indicators.rsi.current, 1) : "—"}
          signal={indicators.rsi.signal}
          detail={indicators.rsi.signal === "overbought" ? "Potential pullback" : indicators.rsi.signal === "oversold" ? "Potential bounce" : "Neutral momentum"}
        />
        <IndicatorCard
          title="MACD"
          value={indicators.macd.current.macd != null ? formatNumber(indicators.macd.current.macd, 3) : "—"}
          signal={indicators.macd.crossover === "bullish" ? "overbought" : indicators.macd.crossover === "bearish" ? "oversold" : "neutral"}
          detail={indicators.macd.crossover === "bullish" ? "Bullish crossover" : indicators.macd.crossover === "bearish" ? "Bearish crossover" : `Hist: ${formatNumber(indicators.macd.current.histogram ?? 0, 3)}`}
        />
        <IndicatorCard
          title="ADX"
          value={indicators.adx.current.adx != null ? formatNumber(indicators.adx.current.adx, 1) : "—"}
          signal={indicators.adx.trendStrength === "strong" ? "overbought" : "neutral"}
          detail={`${indicators.adx.trendStrength} ${indicators.adx.trendDirection} trend`}
        />
        <IndicatorCard
          title="ATR (%)"
          value={indicators.atr.currentAsPercent != null ? formatPercent(indicators.atr.currentAsPercent, 1) : "—"}
          signal={indicators.atr.volatilityRegime === "high" ? "overbought" : indicators.atr.volatilityRegime === "low" ? "oversold" : "neutral"}
          detail={`${indicators.atr.volatilityRegime} volatility`}
        />
        <IndicatorCard
          title="Stochastic %K"
          value={indicators.stochastic.current.k != null ? formatNumber(indicators.stochastic.current.k, 1) : "—"}
          signal={indicators.stochastic.signal}
          detail={indicators.stochastic.signal === "overbought" ? "Overbought" : indicators.stochastic.signal === "oversold" ? "Oversold" : "Neutral"}
        />
        <IndicatorCard
          title="Bollinger %B"
          value={indicators.bollinger.current.percentB != null ? formatNumber(indicators.bollinger.current.percentB, 2) : "—"}
          signal={(indicators.bollinger.current.percentB ?? 1) > 1 ? "overbought" : (indicators.bollinger.current.percentB ?? 1) < 0 ? "oversold" : "neutral"}
          detail={indicators.bollinger.squeeze ? "Squeeze — breakout pending" : `Bandwidth: ${formatPercent(indicators.bollinger.current.bandwidth ?? 0, 2)}`}
        />
        <IndicatorCard
          title="OBV Trend"
          value={indicators.obv.trend === "up" ? "Rising" : indicators.obv.trend === "down" ? "Falling" : "Flat"}
          signal={indicators.obv.trend === "up" ? "overbought" : indicators.obv.trend === "down" ? "oversold" : "neutral"}
          detail={indicators.obv.divergence !== "none" ? `${indicators.obv.divergence} divergence` : "Confirms price"}
        />
        <IndicatorCard
          title="Ichimoku"
          value={indicators.ichimoku.signal === "bullish" ? "Above cloud" : indicators.ichimoku.signal === "bearish" ? "Below cloud" : "In cloud"}
          signal={indicators.ichimoku.signal === "bullish" ? "overbought" : indicators.ichimoku.signal === "bearish" ? "oversold" : "neutral"}
          detail={`${indicators.ichimoku.cloudColor} cloud`}
        />
        <IndicatorCard
          title="Williams %R"
          value={indicators.williamsR.current != null ? formatNumber(indicators.williamsR.current, 1) : "—"}
          signal={indicators.williamsR.signal}
          detail={indicators.williamsR.signal === "overbought" ? "Overbought" : indicators.williamsR.signal === "oversold" ? "Oversold" : "Neutral"}
        />
        <IndicatorCard
          title="CCI (20)"
          value={indicators.cci.current != null ? formatNumber(indicators.cci.current, 0) : "—"}
          signal={indicators.cci.signal}
          detail={indicators.cci.signal === "overbought" ? "Overbought" : indicators.cci.signal === "oversold" ? "Oversold" : "Neutral"}
        />
        <IndicatorCard
          title="MFI (14)"
          value={indicators.mfi.current != null ? formatNumber(indicators.mfi.current, 1) : "—"}
          signal={indicators.mfi.signal}
          detail={indicators.mfi.signal === "overbought" ? "Overbought" : indicators.mfi.signal === "oversold" ? "Oversold" : "Neutral"}
        />
      </div>

      {/* TTM Squeeze */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" /> TTM Squeeze
          </CardTitle>
          <CardDescription>
            Bollinger Bands inside Keltner Channels = volatility squeeze (breakout pending). Histogram shows momentum direction.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            {indicators.ttmSqueeze.signal === "squeeze" && (
              <Badge variant="warning">Squeeze Active — volatility compression</Badge>
            )}
            {indicators.ttmSqueeze.signal === "fired" && (
              <Badge variant="profit">Squeeze Fired — breakout starting</Badge>
            )}
            {indicators.ttmSqueeze.signal === "normal" && (
              <Badge variant="outline">No squeeze — normal volatility</Badge>
            )}
            <span className="text-xs text-muted-foreground">
              Momentum: {indicators.ttmSqueeze.current.histogram != null
                ? `${indicators.ttmSqueeze.current.histogram > 0 ? "Bullish" : "Bearish"} (${formatNumber(indicators.ttmSqueeze.current.histogram, 2)})`
                : "—"}
            </span>
          </div>
          {indicators.ttmSqueeze.histogram.filter((h) => h != null).length > 0 && (
            <ResponsiveContainer width="100%" height={120}>
              <ComposedChart data={indicators.ttmSqueeze.histogram.map((h, i) => ({ i, h: h ?? 0, active: indicators.ttmSqueeze.squeezeActive[i] })).slice(-60)}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="i" hide />
                <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
                  formatter={(v: number) => [formatNumber(v, 2), "Momentum"]}
                />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                <Bar dataKey="h" fill="hsl(var(--primary))" opacity={0.6} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Donchian & Keltner Channels */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Donchian Channels (20)</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Upper</span><span className="tabular font-medium">{formatCurrency(indicators.donchian.current.upper)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Middle</span><span className="tabular font-medium">{formatCurrency(indicators.donchian.current.middle)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Lower</span><span className="tabular font-medium">{formatCurrency(indicators.donchian.current.lower)}</span></div>
            <div className="pt-1 text-xs text-muted-foreground">
              {indicators.currentPrice >= (indicators.donchian.current.upper ?? Infinity)
                ? "Price at upper channel — breakout signal"
                : indicators.currentPrice <= (indicators.donchian.current.lower ?? -Infinity)
                  ? "Price at lower channel — breakdown signal"
                  : "Price within channel — no breakout"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Keltner Channels (20, 1.5)</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Upper</span><span className="tabular font-medium">{formatCurrency(indicators.keltner.current.upper)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Middle (EMA)</span><span className="tabular font-medium">{formatCurrency(indicators.keltner.current.middle)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Lower</span><span className="tabular font-medium">{formatCurrency(indicators.keltner.current.lower)}</span></div>
            <div className="pt-1 text-xs text-muted-foreground">
              {indicators.currentPrice > (indicators.keltner.current.upper ?? -Infinity)
                ? "Price above upper — strong momentum"
                : indicators.currentPrice < (indicators.keltner.current.lower ?? Infinity)
                  ? "Price below lower — strong downside"
                  : "Price within channels — normal range"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Moving averages */}
      <Card>
        <CardHeader><CardTitle className="text-base">Moving averages</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <MACard label="SMA 20" value={indicators.movingAverages.sma20} price={indicators.currentPrice} />
            <MACard label="SMA 50" value={indicators.movingAverages.sma50} price={indicators.currentPrice} />
            <MACard label="SMA 200" value={indicators.movingAverages.sma200} price={indicators.currentPrice} />
            <MACard label="EMA 12" value={indicators.movingAverages.ema12} price={indicators.currentPrice} />
            <MACard label="EMA 26" value={indicators.movingAverages.ema26} price={indicators.currentPrice} />
            <MACard label="EMA 50" value={indicators.movingAverages.ema50} price={indicators.currentPrice} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {indicators.movingAverages.goldenCross && <Badge variant="profit">Golden Cross (SMA50 &gt; SMA200)</Badge>}
            {indicators.movingAverages.deathCross && <Badge variant="loss">Death Cross (SMA50 &lt; SMA200)</Badge>}
            <Badge variant="outline">Price vs SMA50: {indicators.movingAverages.priceVsSMA50}</Badge>
            <Badge variant="outline">Price vs SMA200: {indicators.movingAverages.priceVsSMA200}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* RSI chart */}
      <Card>
        <CardHeader><CardTitle className="text-sm">RSI (14)</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={indicators.rsi.values.map((v, i) => ({ i, rsi: v })).filter((d) => d.rsi != null).slice(-60)}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="i" hide />
              <YAxis domain={[0, 100]} fontSize={11} stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
                formatter={(v: number) => [formatNumber(v, 1), "RSI"]}
              />
              <ReferenceLine y={70} stroke="hsl(var(--loss))" strokeDasharray="4 4" />
              <ReferenceLine y={30} stroke="hsl(var(--profit))" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="rsi" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* MACD chart */}
      <Card>
        <CardHeader><CardTitle className="text-sm">MACD (12, 26, 9)</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={indicators.macd.macd.map((m, i) => ({ i, macd: m, signal: indicators.macd.signal[i], histogram: indicators.macd.histogram[i] })).filter((d) => d.macd != null).slice(-60)}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="i" hide />
              <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
                formatter={(v: number, name: string) => [formatNumber(v, 4), name]}
              />
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
              <Bar dataKey="histogram" fill="hsl(var(--muted-foreground))" opacity={0.4} />
              <Line type="monotone" dataKey="macd" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="signal" stroke="hsl(var(--warning))" strokeWidth={1.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* AI Pattern Analysis */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="h-4 w-4" /> AI pattern analysis &amp; prediction
          </CardTitle>
          <CardDescription>
            AI examines all indicators + recent price/volume action to identify patterns and provide a probabilistic outlook.
            NOT a guarantee — educational analysis only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Outlook horizon (days)</Label>
              <Input type="number" min={7} max={90} value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} className="w-32" />
            </div>
            <Button size="sm" onClick={runAnalysis} disabled={analysisLoading}>
              {analysisLoading ? "Analyzing…" : "Run AI analysis"}
            </Button>
          </div>

          {analysis && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant={analysis.aiPowered ? "profit" : "secondary"}>
                  {analysis.aiPowered ? "AI-powered" : "Deterministic (no AI key)"}
                </Badge>
                {analysis.warnings.map((w, i) => (
                  <span key={i} className="text-xs text-amber-600 dark:text-amber-400">{w}</span>
                ))}
              </div>
              <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap rounded-md border bg-muted/30 p-4 text-sm leading-relaxed">
                {analysis.analysis}
              </div>
            </div>
          )}

          {!analysis && !analysisLoading && !analysisError && (
            <p className="text-sm text-muted-foreground">
              Click &quot;Run AI analysis&quot; to get a pattern-based probabilistic outlook. The AI examines all 10+ indicators
              and recent price/volume action to identify what historical pattern the current configuration resembles.
            </p>
          )}

          {analysisError && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Analysis failed</p>
                <p className="text-xs">{analysisError}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SignalColumn({ title, signals, tone }: { title: string; signals: string[]; tone: "profit" | "loss" | "muted" }) {
  return (
    <div className="space-y-1">
      <div className={cn(
        "text-xs font-semibold uppercase",
        tone === "profit" && "text-profit",
        tone === "loss" && "text-loss",
        tone === "muted" && "text-muted-foreground",
      )}>
        {title} ({signals.length})
      </div>
      <ul className="space-y-0.5">
        {signals.length === 0 ? (
          <li className="text-xs text-muted-foreground">—</li>
        ) : (
          signals.map((s, i) => (
            <li key={i} className="text-xs leading-tight">{s}</li>
          ))
        )}
      </ul>
    </div>
  );
}

function IndicatorCard({
  title,
  value,
  signal,
  detail,
}: {
  title: string;
  value: string;
  signal: "overbought" | "oversold" | "neutral";
  detail: string;
}) {
  const tone = signal === "overbought" ? "text-profit" : signal === "oversold" ? "text-loss" : "text-muted-foreground";
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className={cn("mt-1 text-lg font-bold tabular", tone)}>{value}</div>
      <div className="text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function MACard({ label, value, price }: { label: string; value: number | null; price: number }) {
  const above = value != null && price > value;
  return (
    <div className="rounded-md border p-2 text-center">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-bold tabular">{value != null ? formatCurrency(value) : "—"}</div>
      <div className={cn("text-xs", above ? "text-profit" : "text-loss")}>
        {value != null ? (above ? "above" : "below") : ""}
      </div>
    </div>
  );
}
