"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Target, AlertTriangle, Info, HelpCircle } from "lucide-react";
import { cn, formatCurrency, formatNumber, formatPercent } from "@/lib/utils";

interface PositionSizingResponse {
  levels: {
    direction: string;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    expectedMove: number;
    expectedMovePct: number | null;
    riskPerShare: number;
    rewardPerShare: number;
    riskRewardRatio: number;
    breakevenMove: number;
    costDragPct: number | null;
  };
  sizing: {
    weight: number;
    units: number;
    positionValue: number;
    leverage: number;
    actualVolContribution: number | null;
    kellyWeight: number | null;
    kellyCapped: boolean;
    leverageCapped: boolean;
    warnings: string[];
  } | null;
  warnings: string[];
}

export function PositionSizingView() {
  const [spot, setSpot] = useState("100");
  const [volatility, setVolatility] = useState("0.30");
  const [holdingDays, setHoldingDays] = useState("30");
  const [signalScore, setSignalScore] = useState("0.5");
  const [costBps, setCostBps] = useState("0.001");
  const [capital, setCapital] = useState("100000");
  const [targetVol, setTargetVol] = useState("0.15");
  const [maxLeverage, setMaxLeverage] = useState("2.0");
  const [kellyFraction, setKellyFraction] = useState("0.25");
  const [expectedReturn, setExpectedReturn] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PositionSizingResponse | null>(null);

  async function compute() {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const body: Record<string, number> = {
        spot: Number(spot),
        volatility: Number(volatility),
        holdingDays: Number(holdingDays),
        signalScore: Number(signalScore),
        costBps: Number(costBps),
        capital: Number(capital),
        targetVol: Number(targetVol),
        maxLeverage: Number(maxLeverage),
        kellyFraction: Number(kellyFraction),
      };
      if (expectedReturn.trim()) body.expectedReturn = Number(expectedReturn);

      const res = await fetch("/api/position-sizing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Computation failed");
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
            <Target className="h-5 w-5" />
            Cost-Aware Entry/Exit &amp; Vol-Targeted Sizing
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 space-y-2">
            <p className="text-sm font-medium flex items-center gap-2">
              <Info className="h-4 w-4 text-blue-500" />
              What this tool does
            </p>
            <p className="text-sm text-muted-foreground">
              This tool calculates <strong>where to enter, where to place your stop-loss, and where to take
              profit</strong> — based on the stock&apos;s expected move (derived from volatility) and adjusted
              for transaction costs. It also figures out <strong>how many shares to buy</strong> so that the
              position contributes a target amount of volatility to your portfolio, with safety caps from the
              Kelly criterion and leverage limits.
            </p>
            <p className="text-sm text-muted-foreground">
              <strong>Signal score</strong> ranges from -1 (strongly bearish) to +1 (strongly bullish). A
              score of 0 means neutral — no trade. The higher the conviction, the wider the take-profit target
              and the tighter the stop.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <FieldInput label="Spot Price" hint="Current price of the stock" value={spot} onChange={setSpot} />
            <FieldInput label="Volatility (decimal)" hint="Annualized vol, e.g. 0.30 = 30%. Use IV or historical vol." value={volatility} onChange={setVolatility} />
            <FieldInput label="Holding Days" hint="How long you plan to hold the position" value={holdingDays} onChange={setHoldingDays} />
            <FieldInput label="Signal Score [-1, 1]" hint="Your conviction: +1 = strong buy, 0 = no trade, -1 = strong sell" value={signalScore} onChange={setSignalScore} />
            <FieldInput label="Cost (fraction)" hint="Round-trip cost as fraction, e.g. 0.001 = 10bps" value={costBps} onChange={setCostBps} />
            <FieldInput label="Capital ($)" hint="Total portfolio capital to allocate from" value={capital} onChange={setCapital} />
            <FieldInput label="Target Vol (decimal)" hint="Desired portfolio vol contribution, e.g. 0.15 = 15%" value={targetVol} onChange={setTargetVol} />
            <FieldInput label="Max Leverage" hint="Hard cap on borrowing, e.g. 2.0 = 2x" value={maxLeverage} onChange={setMaxLeverage} />
            <FieldInput label="Kelly Fraction" hint="Fraction of full Kelly to use, e.g. 0.25 = quarter-Kelly (safer)" value={kellyFraction} onChange={setKellyFraction} />
            <FieldInput label="Expected Return (optional)" hint="Your expected annual return, e.g. 0.15 = 15%. Used for Kelly sizing." value={expectedReturn} onChange={setExpectedReturn} />
          </div>
          <Button onClick={compute} disabled={loading}>
            <Target className="mr-2 h-4 w-4" />
            Compute Levels &amp; Sizing
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
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
          <Button variant="outline" onClick={() => { setError(null); }}>Try Again</Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const isLong = data.levels.direction === "LONG";
  const goodRR = data.levels.riskRewardRatio >= 2;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Position Sizing Results
            </span>
            <Button variant="outline" size="sm" onClick={() => { setData(null); }}>New Computation</Button>
          </CardTitle>
        </CardHeader>
      </Card>

      {/* Plain-English Summary */}
      <Card className={cn(
        "border-2",
        goodRR ? "border-green-500/30 bg-green-500/5" : "border-amber-500/30 bg-amber-500/5",
      )}>
        <CardHeader>
          <CardTitle className="text-base">What this means for you</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p className="flex gap-2">
            <span className="text-primary">•</span>
            {isLong
              ? `The signal is bullish. The suggested entry is ${formatCurrency(data.levels.entryPrice)}, with a stop-loss at ${formatCurrency(data.levels.stopLoss)} and a take-profit target at ${formatCurrency(data.levels.takeProfit)}.`
              : `The signal is bearish. The suggested entry (short) is ${formatCurrency(data.levels.entryPrice)}, with a stop-loss at ${formatCurrency(data.levels.stopLoss)} and a take-profit target at ${formatCurrency(data.levels.takeProfit)}.`}
          </p>
          <p className="flex gap-2">
            <span className="text-primary">•</span>
            You risk {formatCurrency(data.levels.riskPerShare)} per share to make {formatCurrency(data.levels.rewardPerShare)} per share — a risk-reward ratio of {formatNumber(data.levels.riskRewardRatio, 2)}:1.
            {" "}{goodRR ? "This is a favorable setup — you're risking less than you stand to gain." : "This is marginal — you're risking nearly as much as you stand to gain."}
          </p>
          {data.levels.costDragPct != null && (
            <p className="flex gap-2">
              <span className="text-primary">•</span>
              Transaction costs eat {formatPercent(data.levels.costDragPct, 3)} of your expected move. {" "}
              {Math.abs(data.levels.costDragPct) > 0.02
                ? "This is significant — consider a longer holding period or a lower-cost broker."
                : "This is manageable for the expected holding period."}
            </p>
          )}
          {data.sizing && (
            <p className="flex gap-2">
              <span className="text-primary">•</span>
              To hit your {formatPercent(Number(targetVol), 0)} volatility target, buy {data.sizing.units} shares ({formatCurrency(data.sizing.positionValue)} total).
              {" "}This uses {formatNumber(data.sizing.weight * 100, 1)}% of your capital
              {data.sizing.leverage > 1 ? ` at ${formatNumber(data.sizing.leverage, 2)}x leverage` : ""}.
            </p>
          )}
          {data.sizing?.kellyCapped && (
            <p className="flex gap-2 text-amber-600 dark:text-amber-500">
              <span>⚠</span>
              The Kelly criterion suggests a larger position, but it was capped to your fraction setting for safety. Full Kelly is mathematically optimal but psychologically brutal in drawdowns.
            </p>
          )}
          {data.sizing?.leverageCapped && (
            <p className="flex gap-2 text-amber-600 dark:text-amber-500">
              <span>⚠</span>
              The vol-targeted size would require more leverage than your max allows. Position was reduced to respect your leverage cap.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Entry/Exit Levels */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">Direction</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={isLong ? "profit" : "loss"}>{data.levels.direction}</Badge>
            <p className="text-xs text-muted-foreground mt-1">
              {isLong ? "Buy to open" : "Short to open"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">Entry Price</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(data.levels.entryPrice)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Adjusted for transaction cost
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">Stop Loss</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-loss">{formatCurrency(data.levels.stopLoss)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Exit here if the trade goes against you
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">Take Profit</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-profit">{formatCurrency(data.levels.takeProfit)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Exit here to lock in gains
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Risk Metrics */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Risk / Reward Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Expected Move" value={formatCurrency(data.levels.expectedMove)} />
            <Row label="Expected Move %" value={data.levels.expectedMovePct != null ? formatPercent(data.levels.expectedMovePct, 2) : "—"} />
            <Row label="Risk / Share" value={formatCurrency(data.levels.riskPerShare)} className="text-loss" />
            <Row label="Reward / Share" value={formatCurrency(data.levels.rewardPerShare)} className="text-profit" />
            <Row label="Risk-Reward Ratio" value={`${formatNumber(data.levels.riskRewardRatio, 2)}:1`} />
            <Row label="Breakeven Move" value={formatCurrency(data.levels.breakevenMove)} />
            <Row label="Cost Drag %" value={data.levels.costDragPct != null ? formatPercent(data.levels.costDragPct, 3) : "—"} />
            <div className="border-t pt-2 text-xs text-muted-foreground space-y-1">
              <p><strong>Expected Move</strong> = how far the price is likely to move over your holding period, based on volatility. 1 standard deviation.</p>
              <p><strong>Risk / Share</strong> = how much you lose per share if stop is hit.</p>
              <p><strong>Reward / Share</strong> = how much you make per share if target is hit.</p>
              <p><strong>Risk-Reward Ratio</strong> = reward divided by risk. &gt;2 = favorable, &lt;1 = unfavorable.</p>
              <p><strong>Breakeven Move</strong> = how far the price needs to move just to cover transaction costs.</p>
              <p><strong>Cost Drag</strong> = what percentage of your expected move is eaten by fees/spreads.</p>
            </div>
          </CardContent>
        </Card>

        {data.sizing && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Position Sizing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Weight" value={formatNumber(data.sizing.weight * 100, 2) + "%"} />
              <Row label="Units (shares)" value={String(data.sizing.units)} />
              <Row label="Position Value" value={formatCurrency(data.sizing.positionValue)} />
              <Row label="Leverage" value={formatNumber(data.sizing.leverage, 2) + "x"} />
              <Row label="Actual Vol Contribution" value={data.sizing.actualVolContribution != null ? formatPercent(data.sizing.actualVolContribution, 2) : "—"} />
              <Row label="Kelly Weight" value={data.sizing.kellyWeight != null ? formatNumber(data.sizing.kellyWeight * 100, 2) + "%" : "—"} />
              {data.sizing.kellyCapped && <Row label="Kelly Capped" value="Yes" className="text-warning" />}
              {data.sizing.leverageCapped && <Row label="Leverage Capped" value="Yes" className="text-warning" />}
              {data.sizing.warnings.map((w, i) => (
                <p key={i} className="text-xs text-muted-foreground pt-1">{w}</p>
              ))}
              <div className="border-t pt-2 text-xs text-muted-foreground space-y-1">
                <p><strong>Weight</strong> = what fraction of your capital to allocate to this position.</p>
                <p><strong>Units</strong> = how many shares to buy (or short).</p>
                <p><strong>Leverage</strong> = position value divided by capital. &gt;1 = using borrowed money.</p>
                <p><strong>Vol Contribution</strong> = how much this position adds to your portfolio's overall volatility. Should match your target.</p>
                <p><strong>Kelly Weight</strong> = the mathematically optimal bet size based on your expected return and volatility. Most traders use a fraction (e.g. 25%) to reduce drawdowns.</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {data.warnings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4" />
              Warnings
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

function FieldInput({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
      <p className="text-xs text-muted-foreground mt-1">{hint}</p>
    </div>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-mono", className)}>{value}</span>
    </div>
  );
}
