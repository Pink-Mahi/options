"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Target, AlertTriangle } from "lucide-react";
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
          <p className="text-sm text-muted-foreground">
            Compute entry, stop-loss, and take-profit levels from expected move bands adjusted for transaction costs,
            plus volatility-targeted position sizing with Kelly and leverage caps.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <FieldInput label="Spot Price" value={spot} onChange={setSpot} />
            <FieldInput label="Volatility (decimal)" value={volatility} onChange={setVolatility} />
            <FieldInput label="Holding Days" value={holdingDays} onChange={setHoldingDays} />
            <FieldInput label="Signal Score [-1, 1]" value={signalScore} onChange={setSignalScore} />
            <FieldInput label="Cost (fraction, e.g. 0.001)" value={costBps} onChange={setCostBps} />
            <FieldInput label="Capital ($)" value={capital} onChange={setCapital} />
            <FieldInput label="Target Vol (decimal)" value={targetVol} onChange={setTargetVol} />
            <FieldInput label="Max Leverage" value={maxLeverage} onChange={setMaxLeverage} />
            <FieldInput label="Kelly Fraction" value={kellyFraction} onChange={setKellyFraction} />
            <FieldInput label="Expected Return (optional)" value={expectedReturn} onChange={setExpectedReturn} />
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

      {/* Entry/Exit Levels */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">Direction</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={isLong ? "profit" : "loss"}>{data.levels.direction}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">Entry Price</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(data.levels.entryPrice)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">Stop Loss</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-loss">{formatCurrency(data.levels.stopLoss)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">Take Profit</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-profit">{formatCurrency(data.levels.takeProfit)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Risk Metrics */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Risk / Reward</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Expected Move" value={formatCurrency(data.levels.expectedMove)} />
            <Row label="Expected Move %" value={data.levels.expectedMovePct != null ? formatPercent(data.levels.expectedMovePct, 2) : "—"} />
            <Row label="Risk / Share" value={formatCurrency(data.levels.riskPerShare)} className="text-loss" />
            <Row label="Reward / Share" value={formatCurrency(data.levels.rewardPerShare)} className="text-profit" />
            <Row label="Risk-Reward Ratio" value={formatNumber(data.levels.riskRewardRatio, 2)} />
            <Row label="Breakeven Move" value={formatCurrency(data.levels.breakevenMove)} />
            <Row label="Cost Drag %" value={data.levels.costDragPct != null ? formatPercent(data.levels.costDragPct, 3) : "—"} />
          </CardContent>
        </Card>

        {data.sizing && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Volatility-Targeted Sizing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Weight" value={formatNumber(data.sizing.weight, 4)} />
              <Row label="Units (shares)" value={String(data.sizing.units)} />
              <Row label="Position Value" value={formatCurrency(data.sizing.positionValue)} />
              <Row label="Leverage" value={formatNumber(data.sizing.leverage, 2)} />
              <Row label="Actual Vol Contribution" value={data.sizing.actualVolContribution != null ? formatPercent(data.sizing.actualVolContribution, 2) : "—"} />
              <Row label="Kelly Weight" value={data.sizing.kellyWeight != null ? formatNumber(data.sizing.kellyWeight, 4) : "—"} />
              {data.sizing.kellyCapped && <Row label="Kelly Capped" value="Yes" className="text-warning" />}
              {data.sizing.leverageCapped && <Row label="Leverage Capped" value="Yes" className="text-warning" />}
              {data.sizing.warnings.map((w, i) => (
                <p key={i} className="text-xs text-muted-foreground pt-1">{w}</p>
              ))}
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
                <li key={i}>• {w}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function FieldInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
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
