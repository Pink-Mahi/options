"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Line,
  LineChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, Input, Label } from "@/components/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import type { BacktestResult } from "@/lib/calculations/backtester";
import type { MarketContext } from "@/lib/calculations/market-context";
import { Save, Bookmark, Trash2, ChevronDown, Sparkles, Activity, Database } from "lucide-react";

interface OptimizeResult {
  strategy: string;
  dte: number;
  buyBackPct: number;
  deltaTarget: number;
  minCallYieldPct: number;
  minPutYieldPct: number;
  neverBelowCost: boolean;
  averageDown: boolean;
  rollOnAssignment: boolean;
  strategyReturn: number;
  annualizedReturn: number;
  buyHoldReturn: number;
  outperformance: number;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  calmarRatio: number | null;
  maxDrawdown: number;
  totalPremiumIncome: number;
  winRate: number;
  totalCycles: number;
  assignmentCount: number;
  earlyCloseCount: number;
  avgPremiumPerCycle: number;
  realDataCycles: number;
  bsModelCycles: number;
  compositeScore: number;
  avgMonthlyIncome: number;
  interestIncome: number;
  totalCommissions: number;
  returnOnCapitalDeployed: number | null;
  capitalUtilization: number;
  monthlyIncomeStdDev: number;
  zeroIncomeMonths: number;
  worstCyclePnl: number;
  worstMonthPnl: number;
  daysUnderwater: number;
  deflatedSharpe: number | null;
  deflatedSharpeVerdict: string | null;
  trials: number;
  /** Phase 4: walk-forward OOS annualized return. */
  oosAnnualizedReturn?: number;
  /** Phase 4: IS/OOS return gap (large positive = overfitting). */
  isOosGap?: number;
  /** Phase 4: OOS consistency (fraction of positive folds). */
  oosConsistency?: number;
  /** Phase 4: parameter stability score (0–1). */
  stabilityScore?: number;
  /** Phase 4: composite robustness score. */
  robustnessScore?: number;
}

interface PresetData {
  id: string;
  name: string;
  strategy: string;
  deltaTarget: number;
  dteTarget: number;
  range: string;
  contracts: number;
  neverBelowCost: boolean;
  minYieldPct: number;
  averageDown: boolean;
  fillAssumption: "bid" | "mid";
  startingCapital: number;
  buyBackPct: number;
  minPutYieldPct: number;
  rollOnAssignment: boolean;
}

type StrategyOption = "COVERED_CALL" | "CASH_SECURED_PUT" | "WHEEL" | "RATIO_WHEEL";

interface BacktestResponse extends BacktestResult {
  startingCapital: number;
  underlyingPrice: number;
  modelCaveat: string;
  dataSourceSummary?: {
    realDataCycles: number;
    bsModelCycles: number;
    totalCycles: number;
    usingRealData: boolean;
  };
  _label?: string;
}

const STRATEGY_LABELS: Record<StrategyOption, string> = {
  COVERED_CALL: "Covered call",
  CASH_SECURED_PUT: "Cash-secured put",
  WHEEL: "Wheel",
  RATIO_WHEEL: "Ratio wheel",
};

export function BacktestView() {
  const [symbol, setSymbol] = useState("AAPL");
  const [strategy, setStrategy] = useState<StrategyOption>("COVERED_CALL");
  const [deltaTarget, setDeltaTarget] = useState(0.3);
  const [dteTarget, setDteTarget] = useState(45);
  const [range, setRange] = useState("3y");
  const [neverBelowCost, setNeverBelowCost] = useState(true);
  const [minYieldPct, setMinYieldPct] = useState(0);
  const [contracts, setContracts] = useState(1);
  const [averageDown, setAverageDown] = useState(false);
  const [fillAssumption, setFillAssumption] = useState<"bid" | "mid">("bid");
  const [startingCapital, setStartingCapital] = useState(0);
  const [buyBackPct, setBuyBackPct] = useState(0);
  const [minPutYieldPct, setMinPutYieldPct] = useState(0);
  const [rollOnAssignment, setRollOnAssignment] = useState(false);
  // Phase 7: Ratio wheel config
  const [putCallRatio, setPutCallRatio] = useState(0.5);
  const [callDeltaAfterAssignment, setCallDeltaAfterAssignment] = useState(0.50);
  const [sharesHeld, setSharesHeld] = useState(0); // 0 = auto (contracts * 100)
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [comparisonResults, setComparisonResults] = useState<BacktestResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<PresetData[]>([]);
  const [presetName, setPresetName] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [presetDropdownOpen, setPresetDropdownOpen] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeResults, setOptimizeResults] = useState<OptimizeResult[] | null>(null);
  const [optimizeMeta, setOptimizeMeta] = useState<{ totalCombinations: number; phase1Combinations?: number; phase2Combinations?: number; buyHoldReturn: number; modelCaveat: string; realDataUsed?: boolean } | null>(null);
  const [optDteMin, setOptDteMin] = useState<number>(0);
  const [optDteMax, setOptDteMax] = useState<number>(0);
  const [optStrategy, setOptStrategy] = useState<string>("ALL");
  const [optimizeProgress, setOptimizeProgress] = useState<{
    message: string;
    stage?: string;
    done?: number;
    total?: number;
  } | null>(null);
  const [optimizeElapsed, setOptimizeElapsed] = useState(0);
  const [riskTolerance, setRiskTolerance] = useState(1);
  const [optimizeGoal, setOptimizeGoal] = useState<string>("balanced");
  const [optSharesHeld, setOptSharesHeld] = useState<number>(0);
  const [optStartingCapital, setOptStartingCapital] = useState<number>(0);
  const [backtestProgress, setBacktestProgress] = useState<{
    message: string;
    stage?: string;
    done?: number;
    total?: number;
  } | null>(null);
  const [backtestElapsed, setBacktestElapsed] = useState(0);
  const [preWarming, setPreWarming] = useState(false);
  const [preWarmProgress, setPreWarmProgress] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/backtest-presets", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setPresets(data.presets ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!optimizing) return;
    setOptimizeElapsed(0);
    const timer = setInterval(() => setOptimizeElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [optimizing]);

  useEffect(() => {
    if (!loading) return;
    setBacktestElapsed(0);
    const timer = setInterval(() => setBacktestElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [loading]);

  function savePreset() {
    const name = presetName.trim();
    if (!name) return;
    fetch("/api/backtest-presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        strategy,
        deltaTarget,
        dteTarget,
        range,
        contracts,
        neverBelowCost,
        minYieldPct,
        averageDown,
        fillAssumption,
        startingCapital,
        buyBackPct,
        minPutYieldPct,
        rollOnAssignment,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.preset) {
          setPresets((prev) => [data.preset, ...prev]);
          setPresetName("");
          setShowSaveInput(false);
        }
      });
  }

  function loadPreset(p: PresetData) {
    setStrategy(p.strategy as StrategyOption);
    setDeltaTarget(p.deltaTarget);
    setDteTarget(p.dteTarget);
    setRange(p.range);
    setContracts(p.contracts);
    setNeverBelowCost(p.neverBelowCost);
    setMinYieldPct(p.minYieldPct);
    setAverageDown(p.averageDown);
    setFillAssumption(p.fillAssumption);
    setStartingCapital(p.startingCapital);
    setBuyBackPct(p.buyBackPct);
    setMinPutYieldPct(p.minPutYieldPct);
    setRollOnAssignment(p.rollOnAssignment);
    setPresetDropdownOpen(false);
  }

  function deletePreset(id: string) {
    fetch(`/api/backtest-presets?id=${id}`, { method: "DELETE" })
      .then(() => setPresets((prev) => prev.filter((p) => p.id !== id)))
      .catch(() => {});
  }

  async function runOptimizer() {
    if (!symbol) return;
    setOptimizing(true);
    setError(null);
    setOptimizeResults(null);
    setOptimizeProgress({ message: "Starting…" });
    try {
      const res = await fetch("/api/backtest/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          range,
          contracts,
          dteMin: optDteMin > 0 ? optDteMin : undefined,
          dteMax: optDteMax > 0 ? optDteMax : undefined,
          strategy: optStrategy !== "ALL" ? optStrategy : undefined,
          riskTolerance,
          goal: optimizeGoal,
          sharesHeld: optSharesHeld > 0 ? optSharesHeld : undefined,
          startingCapital: optStartingCapital > 0 ? optStartingCapital : undefined,
        }),
        cache: "no-store",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        setError(data.error ?? "Optimization failed.");
        return;
      }
      if (!res.body) throw new Error("Streaming not supported by this browser.");

      // The API streams NDJSON: progress lines while it runs, then one result.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let payload: {
        topResults?: OptimizeResult[];
        totalCombinations?: number;
        phase1Combinations?: number;
        phase2Combinations?: number;
        buyHoldReturn?: number;
        modelCaveat?: string;
        realDataUsed?: boolean;
      } | null = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line) as {
            type: string;
            message?: string;
            stage?: string;
            done?: number;
            total?: number;
            error?: string;
            topResults?: OptimizeResult[];
            totalCombinations?: number;
            phase1Combinations?: number;
            phase2Combinations?: number;
            buyHoldReturn?: number;
            modelCaveat?: string;
            realDataUsed?: boolean;
          };
          if (evt.type === "progress") {
            setOptimizeProgress({
              message: evt.message ?? "Working…",
              stage: evt.stage,
              done: evt.done,
              total: evt.total,
            });
          } else if (evt.type === "result") {
            payload = evt;
          } else if (evt.type === "error") {
            throw new Error(evt.error ?? "Optimization failed.");
          }
        }
      }

      if (!payload) throw new Error("Optimization ended without results.");
      const top = payload.topResults ?? [];
      setOptimizeResults(top);
      setOptimizeMeta({
        totalCombinations: payload.totalCombinations ?? 0,
        phase1Combinations: payload.phase1Combinations,
        phase2Combinations: payload.phase2Combinations,
        buyHoldReturn: payload.buyHoldReturn ?? 0,
        modelCaveat: payload.modelCaveat ?? "",
        realDataUsed: payload.realDataUsed ?? false,
      });
      // Auto-apply the #1 result's settings so the form is ready, but don't
      // auto-run the backtest — let the user review and click Run Backtest.
      const best = top.length > 0 ? top[0] : null;
      if (best) {
        setStrategy(best.strategy as StrategyOption);
        setDteTarget(best.dte);
        setBuyBackPct(best.buyBackPct);
        setDeltaTarget(best.deltaTarget);
        setMinYieldPct(best.minCallYieldPct > 0 ? best.minCallYieldPct * 100 : 0);
        setMinPutYieldPct(best.minPutYieldPct > 0 ? best.minPutYieldPct * 100 : 0);
        setNeverBelowCost(best.neverBelowCost);
        setAverageDown(best.averageDown);
        setRollOnAssignment(best.rollOnAssignment);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOptimizing(false);
      setOptimizeProgress(null);
    }
  }

  function applyOptimizedResult(r: OptimizeResult) {
    setStrategy(r.strategy as StrategyOption);
    setDteTarget(r.dte);
    setBuyBackPct(r.buyBackPct);
    setDeltaTarget(r.deltaTarget);
    setMinYieldPct(r.minCallYieldPct > 0 ? r.minCallYieldPct * 100 : 0);
    setMinPutYieldPct(r.minPutYieldPct > 0 ? r.minPutYieldPct * 100 : 0);
    setNeverBelowCost(r.neverBelowCost);
    setAverageDown(r.averageDown);
    setRollOnAssignment(r.rollOnAssignment);
    // Pass overrides directly to run() — state updates are async and
    // won't be reflected when run() reads them synchronously.
    // disableGtcTouch=true tells the backtest API to use the already-fetched
    // EOD chain data for GTC touch checks (same as the optimizer) instead of
    // making slow per-contract API calls. This ensures the full backtest
    // matches the optimizer's results exactly.
    run({
      strategy: r.strategy as StrategyOption,
      deltaTarget: r.deltaTarget,
      dteTarget: r.dte,
      buyBackPct: r.buyBackPct,
      minCallYieldPct: r.minCallYieldPct > 0 ? r.minCallYieldPct * 100 : 0,
      minPutYieldPct: r.minPutYieldPct > 0 ? r.minPutYieldPct * 100 : 0,
      neverBelowCost: r.neverBelowCost,
      averageDown: r.averageDown,
      rollOnAssignment: r.rollOnAssignment,
      disableGtcTouch: true,
    });
  }

  async function preWarmCache() {
    if (!symbol) return;
    setPreWarming(true);
    setPreWarmProgress("Starting…");
    try {
      const res = await fetch("/api/backtest/prefetch-cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, range }),
      });
      if (!res.ok || !res.body) throw new Error("Failed to start pre-fetch");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line) as { type: string; message?: string; error?: string };
          if (evt.type === "progress") {
            setPreWarmProgress(evt.message ?? "Working…");
          } else if (evt.type === "result") {
            setPreWarmProgress(evt.message ?? "Done");
          } else if (evt.type === "error") {
            throw new Error(evt.error ?? "Pre-fetch failed");
          }
        }
      }
    } catch (e) {
      setPreWarmProgress(`Error: ${(e as Error).message}`);
    } finally {
      setPreWarming(false);
    }
  }

  async function run(overrides?: {
    strategy?: StrategyOption;
    deltaTarget?: number;
    dteTarget?: number;
    buyBackPct?: number;
    minCallYieldPct?: number;
    minPutYieldPct?: number;
    neverBelowCost?: boolean;
    averageDown?: boolean;
    rollOnAssignment?: boolean;
    disableGtcTouch?: boolean;
  }) {
    // Guard against MouseEvent passed by onClick={run}
    const o = overrides && "strategy" in overrides ? overrides : undefined;
    const effStrategy = o?.strategy ?? strategy;
    const effDelta = o?.deltaTarget ?? deltaTarget;
    const effDte = o?.dteTarget ?? dteTarget;
    const effBuyBack = o?.buyBackPct ?? buyBackPct;
    const effMinCall = o?.minCallYieldPct ?? minYieldPct;
    const effMinPut = o?.minPutYieldPct ?? minPutYieldPct;
    const effNeverBelow = o?.neverBelowCost ?? neverBelowCost;
    const effAvgDown = o?.averageDown ?? averageDown;
    const effRoll = o?.rollOnAssignment ?? rollOnAssignment;

    setLoading(true);
    setError(null);
    setBacktestProgress({ message: "Starting…" });
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          strategy: effStrategy,
          deltaTarget: effDelta,
          dteTarget: effDte,
          range,
          neverSellCallBelowCostBasis: effNeverBelow,
          minCallPremiumYieldPct: effMinCall > 0 ? effMinCall / 100 : undefined,
          contracts,
          averageDownWithPremium: effAvgDown,
          fillAssumption,
          startingCapital: startingCapital > 0 ? startingCapital : undefined,
          buyBackPct: effBuyBack > 0 ? effBuyBack / 100 : undefined,
          minPutPremiumYieldPct: effMinPut > 0 ? effMinPut / 100 : undefined,
          rollOnAssignment: effRoll,
          shares: sharesHeld > 0 ? sharesHeld : undefined,
          // Phase 7: Ratio wheel
          putCallRatio: strategy === "RATIO_WHEEL" ? putCallRatio : undefined,
          callDeltaAfterAssignment: strategy === "RATIO_WHEEL" ? callDeltaAfterAssignment : undefined,
          disableGtcTouch: o?.disableGtcTouch,
        }),
        cache: "no-store",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        setError(data.error ?? "Backtest failed.");
        setResult(null);
        return;
      }
      if (!res.body) throw new Error("Streaming not supported by this browser.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let payload: Record<string, unknown> | null = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line) as {
            type: string;
            message?: string;
            stage?: string;
            done?: number;
            total?: number;
            error?: string;
          };
          if (evt.type === "progress") {
            setBacktestProgress({
              message: evt.message ?? "Working…",
              stage: evt.stage,
              done: evt.done,
              total: evt.total,
            });
          } else if (evt.type === "result") {
            payload = evt;
          } else if (evt.type === "error") {
            throw new Error(evt.error ?? "Backtest failed.");
          }
        }
      }

      if (!payload) throw new Error("Backtest ended without results.");
      setResult(payload as unknown as BacktestResponse);
      setComparisonResults([]);
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setLoading(false);
      setBacktestProgress(null);
    }
  }

  async function runComparison() {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    setComparisonResults([]);
    setBacktestProgress({ message: "Running comparison backtests…" });
    const variants = [
      { label: "30 DTE", dte: 30, buyBack: 0, delta: deltaTarget },
      { label: "45 DTE", dte: 45, buyBack: 0, delta: deltaTarget },
      { label: "45 DTE + 50% buy-back", dte: 45, buyBack: 50, delta: deltaTarget },
    ];
    try {
      const results: BacktestResponse[] = [];
      for (let i = 0; i < variants.length; i++) {
        const v = variants[i]!;
        setBacktestProgress({
          message: `Comparison ${i + 1}/${variants.length}: ${v.label}…`,
          done: i,
          total: variants.length,
        });
        const res = await fetch("/api/backtest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol, strategy, range, contracts, fillAssumption,
            neverSellCallBelowCostBasis: neverBelowCost,
            averageDownWithPremium: averageDown,
            startingCapital: startingCapital > 0 ? startingCapital : undefined,
            minCallPremiumYieldPct: minYieldPct > 0 ? minYieldPct / 100 : undefined,
            minPutPremiumYieldPct: minPutYieldPct > 0 ? minPutYieldPct / 100 : undefined,
            rollOnAssignment,
            deltaTarget: v.delta,
            dteTarget: v.dte,
            buyBackPct: v.buyBack > 0 ? v.buyBack / 100 : undefined,
          }),
          cache: "no-store",
        });
        if (!res.ok || !res.body) continue;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let payload: Record<string, unknown> | null = null;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const evt = JSON.parse(line) as { type: string; error?: string };
            if (evt.type === "result") payload = evt;
          }
        }
        if (payload) results.push({ ...(payload as unknown as BacktestResponse), _label: v.label });
      }
      setComparisonResults(results);
      if (results.length > 0) setResult(results[0]!);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setBacktestProgress(null);
    }
  }

  function exportCsv() {
    if (!result) return;
    const rows = [
      ["Open", "Expiration", "Close", "Type", "Strike", "Stock Open", "Stock Close", "Premium", "Buy-back", "Yield", "Outcome", "Data Source", "Cycle P/L", "Days", "Contracts"],
      ...result.trades.map((t) => [
        t.openDate, t.expirationDate, t.closeDate, t.optionType, t.strike.toFixed(2),
        t.stockPriceAtOpen.toFixed(2), t.stockPriceAtClose.toFixed(2),
        t.premiumIncome.toFixed(2),
        t.exitPremium != null ? t.exitPremium.toFixed(2) : "",
        (t.premiumYield * 100).toFixed(2) + "%",
        t.outcome, t.dataSource, t.cyclePnl.toFixed(2), String(t.daysHeld), String(t.contracts),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backtest_${result.symbol}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const monthlyData = useMemo(() => {
    if (!result?.monthlyCashFlow) return [];
    return result.monthlyCashFlow.map((m) => ({
      month: m.month,
      premium: m.netPremium,
      gross: m.grossPremium,
      trades: m.trades,
    }));
  }, [result]);

  const avgMonthlyIncome = useMemo(() => {
    if (monthlyData.length === 0) return 0;
    return monthlyData.reduce((s, m) => s + m.premium, 0) / monthlyData.length;
  }, [monthlyData]);

  const benchmarkMap = useMemo(() => {
    if (!result?.marketContext) return new Map<string, number>();
    return new Map(result.marketContext.benchmarkEquity.map((p) => [p.date, Math.round(p.equity)]));
  }, [result]);

  const chartData =
    result?.equityCurve.map((p) => ({
      date: p.date,
      Strategy: Math.round(p.strategyEquity),
      "Buy & hold": Math.round(p.buyHoldEquity),
      ...(benchmarkMap.has(p.date) ? { SPY: benchmarkMap.get(p.date) } : {}),
    })) ?? [];

  const beatsBuyHold = result != null && result.outperformance > 0;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Strategy backtester</h1>
        <p className="text-sm text-muted-foreground">
          Walks a repeating options income strategy forward through real historical prices and compares it
          to simply holding the shares.
        </p>
      </div>

      <Card className={cn("border-warning/40 bg-warning/5", result?.dataSourceSummary?.usingRealData && "border-profit/40 bg-profit/5")}>
        <CardContent className="pt-6 text-sm">
          <p className="font-semibold">
            {result?.dataSourceSummary?.usingRealData
              ? "Real historical options data active"
              : "Read this before trusting any number below"}
          </p>
          <p className="mt-1 text-muted-foreground">
            {result?.dataSourceSummary?.usingRealData
              ? result.modelCaveat
              : "Historical option quotes are not available, so each cycle's premium is modeled with Black-Scholes using trailing 30-day realized volatility. Real markets price volatility above realized (the variance risk premium), so modeled premiums are usually conservative — but strike availability, spreads, and fills all differ. Treat this as a rough shape of the strategy, not a track record you could have achieved."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parameters</CardTitle>
          <CardDescription>Strikes are chosen each cycle by closest match to the delta target.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="bt-symbol">Symbol</Label>
              <Input
                id="bt-symbol"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                placeholder="AAPL"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bt-strategy">Strategy</Label>
              <select
                id="bt-strategy"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={strategy}
                onChange={(e) => setStrategy(e.target.value as StrategyOption)}
              >
                {(Object.keys(STRATEGY_LABELS) as StrategyOption[]).map((s) => (
                  <option key={s} value={s}>
                    {STRATEGY_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bt-delta">Delta target</Label>
              <Input
                id="bt-delta"
                type="number"
                step="0.05"
                min="0.05"
                max="0.95"
                value={deltaTarget}
                onChange={(e) => setDeltaTarget(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bt-dte">DTE per cycle</Label>
              <Input
                id="bt-dte"
                type="number"
                step="1"
                min="7"
                max="365"
                value={dteTarget}
                onChange={(e) => setDteTarget(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bt-contracts">Contracts</Label>
              <Input
                id="bt-contracts"
                type="number"
                step="1"
                min="1"
                max="50"
                value={contracts}
                onChange={(e) => setContracts(Math.max(1, Number(e.target.value)))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bt-minyield">Min call yield %</Label>
              <Input
                id="bt-minyield"
                type="number"
                step="0.1"
                min="0"
                max="20"
                value={minYieldPct}
                onChange={(e) => setMinYieldPct(Number(e.target.value))}
                placeholder="0 = off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bt-fill">Fill price</Label>
              <select
                id="bt-fill"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={fillAssumption}
                onChange={(e) => setFillAssumption(e.target.value as "bid" | "mid")}
              >
                <option value="bid">Bid (conservative)</option>
                <option value="mid">Mid (optimistic)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bt-capital">Starting capital</Label>
              <Input
                id="bt-capital"
                type="number"
                step="1000"
                min="0"
                value={startingCapital || ""}
                onChange={(e) => setStartingCapital(Number(e.target.value))}
                placeholder="Auto"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bt-minputyield">Min put yield %</Label>
              <Input
                id="bt-minputyield"
                type="number"
                step="0.1"
                min="0"
                max="20"
                value={minPutYieldPct}
                onChange={(e) => setMinPutYieldPct(Number(e.target.value))}
                placeholder="0 = off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bt-buyback">Buy back at % profit</Label>
              <Input
                id="bt-buyback"
                type="number"
                step="5"
                min="0"
                max="95"
                value={buyBackPct || ""}
                onChange={(e) => setBuyBackPct(Number(e.target.value))}
                placeholder="0 = hold to expiry"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bt-range">History</Label>
              <select
                id="bt-range"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={range}
                onChange={(e) => setRange(e.target.value)}
              >
                <option value="1y">1 year</option>
                <option value="3y">3 years</option>
                <option value="5y">5 years</option>
                <option value="10y">10 years</option>
              </select>
            </div>
            {/* Shares owned — needed for ratio wheel and covered call */}
            {(strategy === "RATIO_WHEEL" || strategy === "COVERED_CALL") && (
              <div className="space-y-1.5">
                <Label htmlFor="bt-shares">Shares owned</Label>
                <Input
                  id="bt-shares"
                  type="number"
                  step="100"
                  min="0"
                  value={sharesHeld || ""}
                  onChange={(e) => setSharesHeld(Number(e.target.value))}
                  placeholder={`${contracts * 100} (auto)`}
                />
                <p className="text-xs text-muted-foreground">
                  {strategy === "RATIO_WHEEL"
                    ? "Starting shares for covered calls. Puts use cash collateral."
                    : "Shares to sell covered calls against."}
                </p>
              </div>
            )}
            {/* Phase 7: Ratio wheel config */}
            {strategy === "RATIO_WHEEL" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Put:call ratio ({(putCallRatio * 100).toFixed(0)}% puts)</Label>
                  <input
                    type="range"
                    min={0.1}
                    max={0.9}
                    step={0.05}
                    value={putCallRatio}
                    onChange={(e) => setPutCallRatio(Number(e.target.value))}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">
                    50% = equal puts and calls. 70% = more puts (aggressive averaging down).
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Call delta after assignment</Label>
                  <Input
                    type="number"
                    min={0.20}
                    max={0.80}
                    step={0.05}
                    value={callDeltaAfterAssignment}
                    onChange={(e) => setCallDeltaAfterAssignment(Number(e.target.value))}
                    className="h-9"
                  />
                  <p className="text-xs text-muted-foreground">
                    Higher delta = more likely to be called away (recover shares faster). Default: 0.50.
                  </p>
                </div>
              </>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => run()} disabled={loading || !symbol}>
              {loading ? "Running…" : "Run backtest"}
            </Button>
            <Button variant="outline" onClick={runComparison} disabled={loading || !symbol}>
              {loading ? "Running…" : "Compare variants"}
            </Button>
            <Button
              variant="outline"
              onClick={preWarmCache}
              disabled={preWarming || loading || !symbol}
              className="gap-1.5"
              title="Pre-fetch EOD option chains from ThetaData and cache them in the database. Future backtests on this symbol/range will be instant."
            >
              <Database className="h-4 w-4" />
              {preWarming ? "Pre-fetching…" : "Pre-fetch cache"}
            </Button>
            {preWarmProgress && (
              <span className="self-center text-xs text-muted-foreground">{preWarmProgress}</span>
            )}
            {result && (
              <Button variant="outline" onClick={exportCsv}>
                Export CSV
              </Button>
            )}
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Strategy</Label>
              <select
                value={optStrategy}
                onChange={(e) => setOptStrategy(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="ALL">All strategies</option>
                <option value="WHEEL">Wheel</option>
                <option value="RATIO_WHEEL">Ratio wheel</option>
                <option value="COVERED_CALL">Covered call</option>
                <option value="CASH_SECURED_PUT">Cash-secured put</option>
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">DTE</Label>
              <Input
                type="number"
                min={0}
                placeholder="min"
                value={optDteMin > 0 ? optDteMin : ""}
                onChange={(e) => setOptDteMin(Math.max(0, Number(e.target.value) || 0))}
                className="w-16 h-8 text-xs"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="number"
                min={0}
                placeholder="max"
                value={optDteMax > 0 ? optDteMax : ""}
                onChange={(e) => setOptDteMax(Math.max(0, Number(e.target.value) || 0))}
                className="w-16 h-8 text-xs"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground whitespace-nowrap" title="Number of shares you currently hold (for covered calls / wheel). 0 = CSP only.">
                Shares:
              </Label>
              <Input
                type="number"
                min={0}
                step={100}
                placeholder="0"
                value={optSharesHeld > 0 ? optSharesHeld : ""}
                onChange={(e) => setOptSharesHeld(Math.max(0, Number(e.target.value) || 0))}
                className="w-20 h-8 text-xs"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground whitespace-nowrap" title="Starting capital in $. 0 = auto (spot × contracts × 100).">
                Capital:
              </Label>
              <Input
                type="number"
                min={0}
                step={1000}
                placeholder="Auto"
                value={optStartingCapital > 0 ? optStartingCapital : ""}
                onChange={(e) => setOptStartingCapital(Math.max(0, Number(e.target.value) || 0))}
                className="w-24 h-8 text-xs"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground whitespace-nowrap" title="Cash Flow = maximize frequent premium income. Long-Term Gains = maximize total return including stock appreciation. Balanced = both.">
                Goal:
              </Label>
              <select
                value={optimizeGoal}
                onChange={(e) => setOptimizeGoal(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="balanced">Balanced</option>
                <option value="cash_flow">Cash Flow</option>
                <option value="long_term_gains">Long-Term Gains</option>
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground whitespace-nowrap" title="Conservative = prioritize Sharpe & low drawdown. Aggressive = prioritize return.">
                Risk:
              </Label>
              <select
                value={riskTolerance}
                onChange={(e) => setRiskTolerance(Number(e.target.value))}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value={0}>Conservative</option>
                <option value={1}>Balanced</option>
                <option value={2}>Aggressive</option>
              </select>
            </div>
            <Button
              variant="default"
              onClick={runOptimizer}
              disabled={optimizing || !symbol}
              className="gap-1.5"
            >
              {optimizing ? (
                <>
                  <Sparkles className="h-4 w-4 animate-pulse" />
                  Optimizing…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Auto-Optimize
                </>
              )}
            </Button>

            {/* Preset save/load */}
            <div className="relative ml-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPresetDropdownOpen(!presetDropdownOpen)}
                className="gap-1.5"
              >
                <Bookmark className="h-4 w-4" />
                Presets
                <ChevronDown className="h-3 w-3" />
              </Button>
              {presetDropdownOpen && (
                <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-md border bg-popover p-2 shadow-md">
                  {presets.length > 0 ? (
                    <div className="max-h-60 space-y-1 overflow-y-auto">
                      {presets.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-secondary"
                        >
                          <button
                            onClick={() => loadPreset(p)}
                            className="flex-1 text-left"
                          >
                            <div className="font-medium">{p.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {p.strategy.replace(/_/g, " ")} · {p.dteTarget}d · Δ{p.deltaTarget} · {p.range}
                            </div>
                          </button>
                          <button
                            onClick={() => deletePreset(p.id)}
                            className="text-muted-foreground hover:text-loss"
                            aria-label="Delete preset"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="px-2 py-3 text-xs text-muted-foreground">
                      No saved presets yet. Configure your parameters and save them for quick reuse across stocks.
                    </p>
                  )}
                  <div className="mt-2 border-t pt-2">
                    {showSaveInput ? (
                      <div className="flex gap-1.5">
                        <Input
                          value={presetName}
                          onChange={(e) => setPresetName(e.target.value)}
                          placeholder="Preset name…"
                          className="h-8 text-sm"
                          onKeyDown={(e) => e.key === "Enter" && savePreset()}
                        />
                        <Button size="sm" onClick={savePreset} disabled={!presetName.trim()}>
                          <Save className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="w-full gap-1.5"
                        onClick={() => setShowSaveInput(true)}
                      >
                        <Save className="h-3.5 w-3.5" />
                        Save current settings
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="mt-4 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1.5">
            <p>
              <strong className="text-foreground">What is delta?</strong> Delta is a shortcut for{" "}
              <em>how likely the option is to be exercised against you</em>. A delta of 0.30 means roughly a
              30% chance the stock ends up past your strike at expiration — and about a 70% chance the option
              expires worthless and you keep the full premium.
            </p>
            <p>
              <strong className="text-foreground">Lower delta (0.10–0.20):</strong> strike is further away →
              safer, you keep your shares more often, but collect less premium.
            </p>
            <p>
              <strong className="text-foreground">Higher delta (0.40–0.50):</strong> strike is closer to the
              current price → more premium income, but you&apos;ll be assigned / called away more often.
            </p>
            <p>
              <strong className="text-foreground">DTE per cycle</strong> is how many days each option lasts
              before it expires and a new one is sold. 30–60 days is the common sweet spot for income sellers.
            </p>
            <p>
              <strong className="text-foreground">Min call yield %</strong> simulates a resting GTC limit
              order: the call is only sold if the premium is at least this % of the stock price (e.g. 2.5 =
              sell only if you collect $2.50 per $100 of stock). The backtester re-checks every 5 trading days
              within the cycle — and on cycles with real data, also against each day&apos;s traded high, so a
              mid-day spike to your price fills the order. If it never reaches your price, the order
              doesn&apos;t fill and your shares sit uncovered that cycle. Set to 0 to always sell at market.
            </p>
            <p>
              <strong className="text-foreground">Think of it like renting out a house:</strong> the
              cost-basis floor sets the <em>terms</em> (never rent in a way that forces a sale below what you
              paid) and the yield floor sets the <em>rent</em> (don&apos;t accept a tenant paying less than your
              rate). If neither condition is met, you simply don&apos;t rent that month — you keep the house and
              wait for a better offer.
            </p>
            <p>
              <strong className="text-foreground">Average down via CSP:</strong> when the stock
              drops below your cost basis, a 20-delta cash-secured put is sold alongside the main cycle.
              If assigned at expiration, shares are acquired at the put strike (below current spot), lowering
              your average cost basis. If expired worthless, the premium is kept. This is more realistic than
              buying shares directly — you get paid to wait for a better entry.
            </p>
            <p>
              <strong className="text-foreground">Fill price:</strong> <em>Bid</em> assumes you sell 5% below
              the modeled mid (realistic for marketable orders). <em>Mid</em> assumes perfect fills —
              optimistic. <strong className="text-foreground">Starting capital</strong> sets the buy &amp;
              hold comparison baseline; leave blank to auto-size it to the position (spot × contracts × 100).
              <strong className="text-foreground">Buy back at % profit</strong> places a GTC order to close
              the option early once it decays to that profit level. E.g. 50 = if you sold for $2.00, the order
              buys back at $1.00 — you keep $1.00 and free the position for a new cycle immediately. Checked
              daily. On cycles with real data, the order is simulated against each day&apos;s traded low/ask — it
              fills the moment the price trades through your limit intraday, not just at the close (marked
              &quot;intraday&quot; in the trade log). Common values: 50% (Tastytrade-style), 75%, 80%. 0 = hold to
              expiration.
            </p>
            <p>
              <strong className="text-foreground">Min put yield %</strong> is the same GTC limit-order
              simulation, but for put entries. If the premium you collect is too low relative to the stock
              price, you skip selling that put and keep your cash on the sidelines.
            </p>
            <p>
              <strong className="text-foreground">Roll on assignment</strong> — instead of letting shares
              be called away when a call finishes ITM, the backtester buys back the call at intrinsic value
              and keeps holding the shares. This avoids resetting the wheel to the put phase.
            </p>
            <p>
              <strong className="text-foreground">Compare variants</strong> runs three parameter sets
              side by side (30 DTE, 45 DTE, 45 DTE + 50% buy-back) so you can see the effect of each tweak
              in one click.
            </p>
          </div>
          <label className="mt-3 flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={neverBelowCost}
              onChange={(e) => setNeverBelowCost(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <span>
              <strong>Never sell calls below my cost basis.</strong>{" "}
              <span className="text-muted-foreground">
                If a put is assigned at $300, later covered calls are only sold at strikes of $300 or higher —
                so you can&apos;t be called away at a loss. Premiums may be tiny while the stock is underwater.
              </span>
            </span>
          </label>
          <label className="mt-2 flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={averageDown}
              onChange={(e) => setAverageDown(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <span>
              <strong>Average down via CSP.</strong>{" "}
              <span className="text-muted-foreground">
                When the stock is below your cost basis, sell a 20-delta cash-secured put to potentially acquire
                100 shares at a lower strike. If assigned, your cost basis drops. If expired worthless, you keep
                the premium.
              </span>
            </span>
          </label>
          <label className="mt-2 flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={rollOnAssignment}
              onChange={(e) => setRollOnAssignment(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <span>
              <strong>Roll on assignment.</strong>{" "}
              <span className="text-muted-foreground">
                When a call finishes ITM, buy it back at intrinsic value instead of letting shares be called
                away. Keeps you in the covered-call phase.
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {loading && backtestProgress && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Activity className="h-5 w-5 shrink-0 animate-pulse text-primary" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{backtestProgress.message}</p>
                <p className="text-sm text-muted-foreground">
                  {backtestProgress.stage === "prefetch"
                    ? "Downloading real historical option chains — this typically takes 1–3 minutes."
                    : backtestProgress.stage === "backtest"
                      ? "Simulating option cycles against historical data."
                      : backtestProgress.stage === "done"
                        ? "Finishing up…"
                        : "Loading market data…"}{" "}
                  Elapsed {Math.floor(backtestElapsed / 60)}:{String(backtestElapsed % 60).padStart(2, "0")}.
                </p>
                {backtestProgress.total != null && backtestProgress.total > 0 && (
                  <div className="mt-2">
                    <div className="h-2 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{
                          width: `${Math.min(100, Math.round(((backtestProgress.done ?? 0) / backtestProgress.total) * 100))}%`,
                        }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {backtestProgress.done ?? 0} / {backtestProgress.total}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {optimizing && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Sparkles className="h-5 w-5 shrink-0 animate-pulse text-primary" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{optimizeProgress?.message ?? "Sweeping all combinations…"}</p>
                <p className="text-sm text-muted-foreground">
                  {optimizeProgress?.stage === "prefetch"
                    ? "Downloading real historical option chains — this typically takes 2–4 minutes."
                    : optimizeProgress?.stage === "phase1" || optimizeProgress?.stage === "phase2"
                      ? "Running backtests against the fetched data."
                      : "Full sweep typically takes 1–5 minutes."}{" "}
                  Elapsed {Math.floor(optimizeElapsed / 60)}:{String(optimizeElapsed % 60).padStart(2, "0")}.
                </p>
                {optimizeProgress?.total != null && optimizeProgress.total > 0 && (
                  <div className="mt-2">
                    <div className="h-2 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{
                          width: `${Math.min(100, Math.round(((optimizeProgress.done ?? 0) / optimizeProgress.total) * 100))}%`,
                        }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {optimizeProgress.done ?? 0} / {optimizeProgress.total}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {optimizeResults && optimizeResults.length > 0 && optimizeMeta && (
        <>
        {/* Recommended Strategy highlight */}
        {(() => {
          const best = optimizeResults[0];
          if (!best) return null;
          const stratLabel = best.strategy === "COVERED_CALL" ? "Covered Call" : best.strategy === "CASH_SECURED_PUT" ? "Cash-Secured Put" : best.strategy === "RATIO_WHEEL" ? "Ratio Wheel" : "Wheel";
          return (
            <Card className="border-primary/40 bg-gradient-to-br from-primary/10 to-primary/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="text-xl">🥇</span>
                  Recommended Strategy
                  {optimizeMeta.realDataUsed && (
                    <Badge variant="profit" className="text-xs">ThetaData</Badge>
                  )}
                  {best.deflatedSharpeVerdict === "likely_genuine" && (
                    <Badge variant="profit" className="text-xs" title="Deflated Sharpe Ratio: the strategy's risk-adjusted return is likely genuine, not just selection bias from trying many variants.">Robust</Badge>
                  )}
                  {best.deflatedSharpeVerdict === "likely_overfit" && (
                    <Badge variant="loss" className="text-xs" title="Deflated Sharpe Ratio: the strategy's Sharpe may be inflated by selection bias. Treat with caution.">Likely overfit</Badge>
                  )}
                  {best.deflatedSharpeVerdict === "inconclusive" && (
                    <Badge variant="outline" className="text-xs" title="Deflated Sharpe Ratio: cannot determine whether the Sharpe is genuine or selection bias.">Inconclusive</Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  Best risk-adjusted strategy for {symbol} — ranked by normalized composite score ({optimizeGoal === "cash_flow" ? "cash flow: income consistency + capital utilization + premium yield" : optimizeGoal === "long_term_gains" ? "long-term gains: total return + outperformance + low drawdown" : "balanced: return + Sharpe + Sortino + Calmar + drawdown"}).
                  {best.trials > 1 && (
                    <> Selected from {best.trials} candidates. {best.deflatedSharpeVerdict === "likely_overfit" && "⚠ This strategy may be overfit — its Sharpe may not persist out-of-sample."}</>
                  )}
                  Full backtest with Trading Plan is ready to run below.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border bg-background p-3">
                    <p className="text-xs text-muted-foreground">Strategy</p>
                    <p className="text-lg font-semibold">{stratLabel}</p>
                  </div>
                  <div className="rounded-lg border bg-background p-3">
                    <p className="text-xs text-muted-foreground">Annualized return</p>
                    <p className={cn("text-lg font-semibold", best.annualizedReturn >= 0 ? "text-profit" : "text-loss")}>
                      {formatPercent(best.annualizedReturn)}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-background p-3">
                    <p className="text-xs text-muted-foreground">Sharpe ratio</p>
                    <p className="text-lg font-semibold">
                      {best.sharpeRatio != null ? best.sharpeRatio.toFixed(2) : "—"}
                      <span className="ml-1 text-xs text-muted-foreground">
                        {best.sharpeRatio != null && best.sharpeRatio >= 2 ? "(excellent)" : best.sharpeRatio != null && best.sharpeRatio >= 1 ? "(good)" : best.sharpeRatio != null && best.sharpeRatio >= 0 ? "(ok)" : ""}
                      </span>
                    </p>
                  </div>
                  <div className="rounded-lg border bg-background p-3">
                    <p className="text-xs text-muted-foreground">Max drawdown</p>
                    <p className="text-lg font-semibold text-loss">{formatPercent(best.maxDrawdown)}</p>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <div><span className="text-xs text-muted-foreground">DTE: </span><span className="font-medium">{best.dte}</span></div>
                  <div><span className="text-xs text-muted-foreground">Delta: </span><span className="font-medium">{best.deltaTarget.toFixed(2)}</span></div>
                  <div><span className="text-xs text-muted-foreground">Buy back: </span><span className="font-medium">{best.buyBackPct > 0 ? `${best.buyBackPct}%` : "Hold to expiry"}</span></div>
                  <div><span className="text-xs text-muted-foreground">Win rate: </span><span className="font-medium">{formatPercent(best.winRate, 0)}</span></div>
                  <div><span className="text-xs text-muted-foreground">Cycles: </span><span className="font-medium">{best.totalCycles}</span></div>
                  <div><span className="text-xs text-muted-foreground">Mo. income: </span><span className="font-medium text-profit">{formatCurrency(best.avgMonthlyIncome, 0)}</span></div>
                  <div><span className="text-xs text-muted-foreground">vs B&H: </span><span className={cn("font-medium", best.outperformance >= 0 ? "text-profit" : "text-loss")}>{formatPercent(best.outperformance)}</span></div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {best.neverBelowCost && <Badge variant="secondary" className="text-xs">Cost-basis floor</Badge>}
                  {best.averageDown && <Badge variant="secondary" className="text-xs">Avg down (CSP)</Badge>}
                  {best.rollOnAssignment && <Badge variant="secondary" className="text-xs">Roll on assignment</Badge>}
                  {(best.minCallYieldPct > 0 || best.minPutYieldPct > 0) && <Badge variant="secondary" className="text-xs">Min yield {((best.minCallYieldPct || best.minPutYieldPct) * 100).toFixed(0)}%</Badge>}
                  {best.realDataCycles > 0 && <Badge variant="profit" className="text-xs">{best.realDataCycles}/{best.totalCycles} real data cycles</Badge>}
                  {best.stabilityScore != null && best.stabilityScore >= 0.7 && (
                    <Badge variant="profit" className="text-xs" title="Parameter stability: neighboring configurations (delta ±0.05, adjacent DTE, buyback ±10pp) perform similarly. This is a robust plateau, not an isolated spike.">Stable plateau</Badge>
                  )}
                  {best.stabilityScore != null && best.stabilityScore < 0.3 && (
                    <Badge variant="loss" className="text-xs" title="Parameter stability: neighboring configurations perform much worse. This may be an isolated spike that won't generalize.">Isolated spike</Badge>
                  )}
                </div>

                {/* Phase 4: Walk-forward OOS validation */}
                {best.oosAnnualizedReturn != null && (
                  <div className="mt-4 rounded-lg border bg-primary/5 p-3">
                    <p className="text-sm font-medium mb-2">Walk-forward out-of-sample validation</p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <span className="text-xs text-muted-foreground">OOS annualized return: </span>
                        <span className={cn("font-medium", best.oosAnnualizedReturn >= 0 ? "text-profit" : "text-loss")}>
                          {formatPercent(best.oosAnnualizedReturn)}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">IS/OOS gap: </span>
                        <span className={cn("font-medium", (best.isOosGap ?? 0) > 0.15 ? "text-loss" : "text-profit")}>
                          {formatPercent(best.isOosGap ?? 0)}
                        </span>
                        {(best.isOosGap ?? 0) > 0.15 && (
                          <span className="ml-1 text-xs text-loss">⚠ large gap = overfitting risk</span>
                        )}
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">OOS consistency: </span>
                        <span className="font-medium">{formatPercent(best.oosConsistency ?? 0, 0)}</span>
                        <span className="ml-1 text-xs text-muted-foreground">of folds positive</span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Stability score: </span>
                        <span className="font-medium">{best.stabilityScore != null ? `${(best.stabilityScore * 100).toFixed(0)}%` : "—"}</span>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      The strategy was validated across 4 sequential time folds. In-sample (IS) parameters were frozen and tested on unseen later data (OOS). A large IS/OOS gap or low consistency signals overfitting.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })()}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />
              Top 20 optimized strategies
              {optimizeMeta.realDataUsed && (
                <Badge variant="profit" className="text-xs">ThetaData</Badge>
              )}
            </CardTitle>
            <CardDescription>
              {optimizeMeta.totalCombinations} combinations tested
              {optimizeMeta.phase1Combinations ? ` (${optimizeMeta.phase1Combinations} coarse + ${optimizeMeta.phase2Combinations ?? 0} fine-tune)` : ""},
              ranked by composite score ({optimizeGoal === "cash_flow" ? "cash flow optimized" : optimizeGoal === "long_term_gains" ? "long-term gains optimized" : "balanced"}).
              Buy & hold returned {formatPercent(optimizeMeta.buyHoldReturn)} over the same period.
              Click a row to run the full backtest with those settings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">Rank</TableHead>
                    <TableHead>Strategy</TableHead>
                    <TableHead className="text-right">DTE</TableHead>
                    <TableHead className="text-right">Buy back %</TableHead>
                    <TableHead className="text-right">Delta</TableHead>
                    <TableHead className="text-right">Min Yield</TableHead>
                    <TableHead>Toggles</TableHead>
                    <TableHead className="text-right">Ann. Return</TableHead>
                    <TableHead className="text-right">Total Return</TableHead>
                    <TableHead className="text-right">vs B&H</TableHead>
                    <TableHead className="text-right">Premium</TableHead>
                    <TableHead className="text-right" title="Average net premium income per month">Mo. Income</TableHead>
                    <TableHead className="text-right">Cycles</TableHead>
                    <TableHead className="text-right">Win Rate</TableHead>
                    <TableHead className="text-right">Max DD</TableHead>
                    <TableHead className="text-right" title="Risk-adjusted return. >1.0 good, >2.0 excellent, <0 worse than T-bills">Sharpe</TableHead>
                    <TableHead className="text-right" title="Downside-deviation Sharpe. Penalizes negative returns only.">Sortino</TableHead>
                    <TableHead className="text-right" title="Fraction of trading days with an open option position">Util</TableHead>
                    <TableHead className="text-right" title="Walk-forward out-of-sample annualized return">OOS Ret</TableHead>
                    <TableHead className="text-right" title="Parameter stability score (0-100%). High = robust plateau, low = isolated spike.">Stab</TableHead>
                    <TableHead className="text-right">Real</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {optimizeResults.map((r, i) => (
                    <TableRow
                      key={`${r.strategy}-${r.dte}-${r.buyBackPct}-${r.deltaTarget}-${r.neverBelowCost}-${r.averageDown}-${r.rollOnAssignment}-${r.minCallYieldPct}-${r.minPutYieldPct}`}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => applyOptimizedResult(r)}
                    >
                      <TableCell className="text-right font-medium">
                        {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                      </TableCell>
                      <TableCell className="font-medium text-xs">
                        {r.strategy === "COVERED_CALL" ? "CC" : r.strategy === "CASH_SECURED_PUT" ? "CSP" : r.strategy === "RATIO_WHEEL" ? "RW" : "Wheel"}
                      </TableCell>
                      <TableCell className="text-right">{r.dte}</TableCell>
                      <TableCell className="text-right">{r.buyBackPct > 0 ? `${r.buyBackPct}%` : "—"}</TableCell>
                      <TableCell className="text-right">{r.deltaTarget.toFixed(2)}</TableCell>
                      <TableCell className="text-right">{r.minCallYieldPct > 0 || r.minPutYieldPct > 0 ? `${(r.minCallYieldPct || r.minPutYieldPct) * 100 | 0}%` : "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {[
                          r.neverBelowCost && "floor",
                          r.averageDown && "avg↓",
                          r.rollOnAssignment && "roll",
                        ].filter(Boolean).join(" ") || "—"}
                      </TableCell>
                      <TableCell className={cn("text-right font-medium", r.annualizedReturn >= 0 ? "text-profit" : "text-loss")}>
                        {formatPercent(r.annualizedReturn)}
                      </TableCell>
                      <TableCell className={cn("text-right", r.strategyReturn >= 0 ? "text-profit" : "text-loss")}>
                        {formatPercent(r.strategyReturn)}
                      </TableCell>
                      <TableCell className={cn("text-right font-medium", r.outperformance >= 0 ? "text-profit" : "text-loss")}>
                        {formatPercent(r.outperformance)}
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(r.totalPremiumIncome, 0)}</TableCell>
                      <TableCell className="text-right font-medium text-profit">{formatCurrency(r.avgMonthlyIncome, 0)}</TableCell>
                      <TableCell className="text-right">{r.totalCycles}</TableCell>
                      <TableCell className="text-right">{formatPercent(r.winRate, 0)}</TableCell>
                      <TableCell className="text-right text-loss">{formatPercent(r.maxDrawdown)}</TableCell>
                      <TableCell className="text-right">{r.sharpeRatio != null ? r.sharpeRatio.toFixed(2) : "—"}</TableCell>
                      <TableCell className="text-right">{r.sortinoRatio != null ? r.sortinoRatio.toFixed(2) : "—"}</TableCell>
                      <TableCell className="text-right">{formatPercent(r.capitalUtilization, 0)}</TableCell>
                      <TableCell className={cn("text-right", r.oosAnnualizedReturn != null && r.oosAnnualizedReturn >= 0 ? "text-profit" : r.oosAnnualizedReturn != null ? "text-loss" : "")}>
                        {r.oosAnnualizedReturn != null ? formatPercent(r.oosAnnualizedReturn) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.stabilityScore != null ? `${(r.stabilityScore * 100).toFixed(0)}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs whitespace-nowrap">
                        {r.realDataCycles > 0 ? `${r.realDataCycles}/${r.totalCycles}` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {optimizeMeta.modelCaveat}
            </p>
          </CardContent>
        </Card>
        </>
      )}

      {/* Parameter Insights */}
      {optimizeResults && optimizeResults.length > 3 && (() => {
        const byDte = new Map<number, OptimizeResult>();
        const byDelta = new Map<number, OptimizeResult>();
        const byBuyback = new Map<number, OptimizeResult>();
        const byStrategy = new Map<string, OptimizeResult>();
        for (const r of optimizeResults) {
          const curDte = byDte.get(r.dte);
          if (!curDte || r.compositeScore > curDte.compositeScore) byDte.set(r.dte, r);
          const curDelta = byDelta.get(r.deltaTarget);
          if (!curDelta || r.compositeScore > curDelta.compositeScore) byDelta.set(r.deltaTarget, r);
          const curBb = byBuyback.get(r.buyBackPct);
          if (!curBb || r.compositeScore > curBb.compositeScore) byBuyback.set(r.buyBackPct, r);
          const curStrat = byStrategy.get(r.strategy);
          if (!curStrat || r.compositeScore > curStrat.compositeScore) byStrategy.set(r.strategy, r);
        }
        const dteRows = Array.from(byDte.entries()).sort((a, b) => a[0] - b[0]);
        const deltaRows = Array.from(byDelta.entries()).sort((a, b) => a[0] - b[0]);
        const bbRows = Array.from(byBuyback.entries()).sort((a, b) => a[0] - b[0]);
        const stratRows = Array.from(byStrategy.entries());
        const stratLabel = (s: string) => s === "COVERED_CALL" ? "Covered Call" : s === "CASH_SECURED_PUT" ? "Cash-Secured Put" : s === "RATIO_WHEEL" ? "Ratio Wheel" : "Wheel";
        return (
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle className="text-base">Parameter insights — what matters most</CardTitle>
              <CardDescription>
                Best result for each parameter value. Use this to understand which settings drive returns and which ones reduce risk.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {/* DTE comparison */}
              <div>
                <p className="font-medium mb-2">DTE — shorter vs longer expiration</p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">DTE</TableHead>
                        <TableHead className="text-right">Ann. Return</TableHead>
                        <TableHead className="text-right">Total Return</TableHead>
                        <TableHead className="text-right">Cycles</TableHead>
                        <TableHead className="text-right">Sharpe</TableHead>
                        <TableHead className="text-right">Max DD</TableHead>
                        <TableHead className="text-right">Win Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dteRows.map(([dte, r]) => (
                        <TableRow key={dte}>
                          <TableCell className="text-right font-medium">{dte}</TableCell>
                          <TableCell className={cn("text-right font-medium", r.annualizedReturn >= 0 ? "text-profit" : "text-loss")}>{formatPercent(r.annualizedReturn)}</TableCell>
                          <TableCell className={cn("text-right", r.strategyReturn >= 0 ? "text-profit" : "text-loss")}>{formatPercent(r.strategyReturn)}</TableCell>
                          <TableCell className="text-right">{r.totalCycles}</TableCell>
                          <TableCell className="text-right">{r.sharpeRatio != null ? r.sharpeRatio.toFixed(2) : "—"}</TableCell>
                          <TableCell className="text-right text-loss">{formatPercent(r.maxDrawdown)}</TableCell>
                          <TableCell className="text-right">{formatPercent(r.winRate, 0)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {dteRows.length > 1 && (() => {
                    const best = dteRows.reduce((a, b) => a[1].annualizedReturn > b[1].annualizedReturn ? a : b);
                    const worst = dteRows.reduce((a, b) => a[1].annualizedReturn < b[1].annualizedReturn ? a : b);
                    return `Shorter DTE = more cycles per year (higher frequency). Longer DTE = more premium per trade but fewer cycles. Best annualized return: ${best[0]} DTE at ${formatPercent(best[1].annualizedReturn)}. Worst: ${worst[0]} DTE at ${formatPercent(worst[1].annualizedReturn)}.`;
                  })()}
                </p>
              </div>

              {/* Delta comparison */}
              <div>
                <p className="font-medium mb-2">Delta — strike selection aggressiveness</p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">Delta</TableHead>
                        <TableHead className="text-right">Ann. Return</TableHead>
                        <TableHead className="text-right">Sharpe</TableHead>
                        <TableHead className="text-right">Max DD</TableHead>
                        <TableHead className="text-right">Win Rate</TableHead>
                        <TableHead className="text-right">Assignments</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deltaRows.map(([delta, r]) => (
                        <TableRow key={delta}>
                          <TableCell className="text-right font-medium">{delta.toFixed(2)}</TableCell>
                          <TableCell className={cn("text-right font-medium", r.annualizedReturn >= 0 ? "text-profit" : "text-loss")}>{formatPercent(r.annualizedReturn)}</TableCell>
                          <TableCell className="text-right">{r.sharpeRatio != null ? r.sharpeRatio.toFixed(2) : "—"}</TableCell>
                          <TableCell className="text-right text-loss">{formatPercent(r.maxDrawdown)}</TableCell>
                          <TableCell className="text-right">{formatPercent(r.winRate, 0)}</TableCell>
                          <TableCell className="text-right">{r.assignmentCount}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Higher delta = more premium but higher assignment risk. Lower delta = less premium but higher win rate. The optimal delta balances income vs risk of holding shares.
                </p>
              </div>

              {/* Buyback comparison */}
              <div>
                <p className="font-medium mb-2">Buyback % — when to close early</p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">Buyback %</TableHead>
                        <TableHead className="text-right">Ann. Return</TableHead>
                        <TableHead className="text-right">Sharpe</TableHead>
                        <TableHead className="text-right">Cycles</TableHead>
                        <TableHead className="text-right">Win Rate</TableHead>
                        <TableHead className="text-right">Max DD</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bbRows.map(([bb, r]) => (
                        <TableRow key={bb}>
                          <TableCell className="text-right font-medium">{bb > 0 ? `${bb}%` : "Hold to expiry"}</TableCell>
                          <TableCell className={cn("text-right font-medium", r.annualizedReturn >= 0 ? "text-profit" : "text-loss")}>{formatPercent(r.annualizedReturn)}</TableCell>
                          <TableCell className="text-right">{r.sharpeRatio != null ? r.sharpeRatio.toFixed(2) : "—"}</TableCell>
                          <TableCell className="text-right">{r.totalCycles}</TableCell>
                          <TableCell className="text-right">{formatPercent(r.winRate, 0)}</TableCell>
                          <TableCell className="text-right text-loss">{formatPercent(r.maxDrawdown)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Lower buyback % = close early, keep less premium per trade but cycle capital faster. Higher buyback % = keep more premium per trade but capital is tied up longer. 0% = hold to expiry.
                </p>
              </div>

              {/* Strategy comparison */}
              <div>
                <p className="font-medium mb-2">Strategy comparison</p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Strategy</TableHead>
                        <TableHead className="text-right">Ann. Return</TableHead>
                        <TableHead className="text-right">Sharpe</TableHead>
                        <TableHead className="text-right">Max DD</TableHead>
                        <TableHead className="text-right">Win Rate</TableHead>
                        <TableHead className="text-right">vs B&H</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stratRows.map(([s, r]) => (
                        <TableRow key={s}>
                          <TableCell className="font-medium">{stratLabel(s)}</TableCell>
                          <TableCell className={cn("text-right font-medium", r.annualizedReturn >= 0 ? "text-profit" : "text-loss")}>{formatPercent(r.annualizedReturn)}</TableCell>
                          <TableCell className="text-right">{r.sharpeRatio != null ? r.sharpeRatio.toFixed(2) : "—"}</TableCell>
                          <TableCell className="text-right text-loss">{formatPercent(r.maxDrawdown)}</TableCell>
                          <TableCell className="text-right">{formatPercent(r.winRate, 0)}</TableCell>
                          <TableCell className={cn("text-right", r.outperformance >= 0 ? "text-profit" : "text-loss")}>{formatPercent(r.outperformance)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {result && (
        <>
          {result.warnings.length > 0 && (
            <Card className="border-warning/40">
              <CardContent className="space-y-1 pt-6 text-sm">
                {result.warnings.map((w, i) => (
                  <p key={i} className="text-muted-foreground">
                    {w}
                  </p>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Strategy return"
              value={formatPercent(result.strategyReturn)}
              tone={result.strategyReturn >= 0 ? "profit" : "loss"}
            />
            <Stat
              label="Buy & hold return"
              value={formatPercent(result.buyHoldReturn)}
              tone={result.buyHoldReturn >= 0 ? "profit" : "loss"}
            />
            <Stat
              label="Outperformance"
              value={formatPercent(result.outperformance)}
              tone={beatsBuyHold ? "profit" : "loss"}
            />
            <Stat label="Max drawdown" value={formatPercent(result.maxDrawdown)} tone="loss" />
            <Stat label="Cycles" value={String(result.totalCycles)} />
            {result.costBasisFlooredCount > 0 && (
              <Stat
                label="Calls floored at cost basis"
                value={String(result.costBasisFlooredCount)}
              />
            )}
            {result.noFillCount > 0 && (
              <Stat
                label="GTC orders not filled"
                value={`${result.noFillCount} (${formatPercent(1 - result.callFillRate, 0)} of calls)`}
              />
            )}
            {result.avgCallPremiumYield > 0 && (
              <Stat
                label="Avg call yield"
                value={formatPercent(result.avgCallPremiumYield, 2)}
              />
            )}
            {result.averagedDownLots > 0 && (
              <Stat
                label="Lots bought (avg down)"
                value={`${result.averagedDownLots} (${formatCurrency(result.reinvestedPremium, 0)})`}
              />
            )}
            {result.endingCostBasis != null && result.averagedDownLots > 0 && (
              <Stat
                label="Ending cost basis"
                value={`${formatCurrency(result.endingCostBasis, 2)} × ${result.endingShares} sh`}
              />
            )}
            {result.earlyCloseCount > 0 && (
              <Stat
                label="Closed early (buy-back)"
                value={`${result.earlyCloseCount} of ${result.totalCycles}`}
              />
            )}
            {result.rolledCount > 0 && (
              <Stat
                label="Calls rolled"
                value={String(result.rolledCount)}
              />
            )}
            {result.ratioPutContractsSold > 0 && (
              <Stat
                label="Ratio puts sold"
                value={String(result.ratioPutContractsSold)}
              />
            )}
            {result.ratioCallContractsSold > 0 && (
              <Stat
                label="Ratio calls sold"
                value={String(result.ratioCallContractsSold)}
              />
            )}
            {result.ratioDeltaAdjustments > 0 && (
              <Stat
                label="Delta adjustments"
                value={String(result.ratioDeltaAdjustments)}
              />
            )}
            {result.ratioRebalances > 0 && (
              <Stat
                label="Ratio rebalances"
                value={String(result.ratioRebalances)}
              />
            )}
            {result.putNoFillCount > 0 && (
              <Stat
                label="Put GTC not filled"
                value={`${result.putNoFillCount} (${formatPercent(1 - result.putFillRate, 0)} of puts)`}
              />
            )}
            {result.avgPutPremiumYield > 0 && (
              <Stat
                label="Avg put yield"
                value={formatPercent(result.avgPutPremiumYield, 2)}
              />
            )}
            <Stat label="Win rate" value={formatPercent(result.winRate)} />
            <Stat label="Total premium" value={formatCurrency(result.totalPremiumIncome, 0)} />
            <Stat
              label="Avg monthly income"
              value={formatCurrency(avgMonthlyIncome, 0)}
              tone="profit"
              hint={`Net premium per month across ${monthlyData.length} months`}
            />
            <Stat
              label="Sharpe (per-cycle)"
              value={result.sharpeRatio != null ? result.sharpeRatio.toFixed(2) : "—"}
              hint={result.sharpeRatio != null && result.sharpeRatio >= 2 ? "Excellent risk-adjusted return (>2.0)" : result.sharpeRatio != null && result.sharpeRatio >= 1 ? "Good risk-adjusted return (>1.0)" : result.sharpeRatio != null && result.sharpeRatio >= 0 ? "Positive but below 1.0 — high volatility relative to returns" : "Negative — worse than risk-free rate"}
            />
          </div>

          {/* Phase 2: Wheel Health metrics */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Wheel Health</CardTitle>
              <CardDescription>
                Realistic wheel-strategy diagnostics: capital efficiency, income consistency, drawdown depth, and regime performance.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat
                  label="Return on capital deployed"
                  value={result.returnOnCapitalDeployed != null ? formatPercent(result.returnOnCapitalDeployed) : "—"}
                  tone={result.returnOnCapitalDeployed != null && result.returnOnCapitalDeployed >= 0 ? "profit" : "loss"}
                  hint="Annualized P/L ÷ time-weighted average capital at risk (collateral for puts, share value for calls). More realistic than return on total account."
                />
                <Stat
                  label="Capital utilization"
                  value={formatPercent(result.capitalUtilization, 0)}
                  hint="Fraction of trading days with an open option position. Low utilization means cash sits idle."
                />
                <Stat
                  label="Monthly income std dev"
                  value={formatCurrency(result.monthlyIncomeStdDev, 0)}
                  hint="Standard deviation of monthly net premium income. Lower = more consistent."
                />
                <Stat
                  label="Zero-income months"
                  value={String(result.zeroIncomeMonths)}
                  tone={result.zeroIncomeMonths > 0 ? "loss" : undefined}
                  hint="Months with no premium income (GTC orders never filled or no cycles closed)."
                />
                <Stat
                  label="Worst cycle P/L"
                  value={formatCurrency(result.worstCyclePnl, 0)}
                  tone={result.worstCyclePnl < 0 ? "loss" : undefined}
                  hint="The single worst cycle's P/L. Large negative values signal tail risk."
                />
                <Stat
                  label="Worst month P/L"
                  value={formatCurrency(result.worstMonthPnl, 0)}
                  tone={result.worstMonthPnl < 0 ? "loss" : undefined}
                  hint="The single worst month's net premium income."
                />
                <Stat
                  label="Days underwater"
                  value={String(result.daysUnderwater)}
                  tone={result.daysUnderwater > 50 ? "loss" : undefined}
                  hint="Trading days where shares were held and the stock was below the cost basis. Long stretches indicate the wheel got stuck holding losers."
                />
                <Stat
                  label="Net cost basis reduction"
                  value={formatCurrency(result.netCostBasisReduction, 2)}
                  tone="profit"
                  hint="Total call premium collected per share while holding, reducing the effective cost basis."
                />
                {result.interestIncome > 0 && (
                  <Stat
                    label="Interest income"
                    value={formatCurrency(result.interestIncome, 0)}
                    tone="profit"
                    hint="Interest earned on idle cash at the risk-free rate."
                  />
                )}
                {result.totalCommissions > 0 && (
                  <Stat
                    label="Total commissions"
                    value={formatCurrency(result.totalCommissions, 0)}
                    tone="loss"
                    hint="Commissions + assignment fees + slippage paid. Reduces net return."
                  />
                )}
              </div>

              {/* Cost basis history */}
              {result.costBasisHistory.length > 1 && (
                <div className="mt-4">
                  <p className="text-sm font-medium mb-2">Cost basis history</p>
                  <div className="flex flex-wrap gap-2">
                    {result.costBasisHistory.map((c, i) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {c.date}: {formatCurrency(c.costBasis, 2)}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Regime breakdown */}
              {result.regimeBreakdown.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm font-medium mb-2">Performance by market regime</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Regime</TableHead>
                        <TableHead className="text-right">Cycles</TableHead>
                        <TableHead className="text-right">P/L</TableHead>
                        <TableHead className="text-right">Win rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.regimeBreakdown.map((r) => (
                        <TableRow key={r.regime}>
                          <TableCell className="font-medium">{r.regime}</TableCell>
                          <TableCell className="text-right">{r.cycles}</TableCell>
                          <TableCell className={`text-right ${r.pnl >= 0 ? "text-profit" : "text-loss"}`}>
                            {formatCurrency(r.pnl, 0)}
                          </TableCell>
                          <TableCell className="text-right">{formatPercent(r.winRate)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Trading Plan */}
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle className="text-base">Trading plan recipe</CardTitle>
              <CardDescription>
                Follow these rules to replicate the backtested strategy. Print this and keep it next to your trading screen.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {/* Strategy overview */}
              <div className="rounded-md border bg-background p-3">
                <p className="font-semibold mb-1">
                  {STRATEGY_LABELS[strategy as StrategyOption] ?? strategy} on {symbol}
                </p>
                <p className="text-muted-foreground">
                  {strategy === "WHEEL" && "Sell cash-secured puts → get assigned → sell covered calls → get called away → repeat."}
                  {strategy === "RATIO_WHEEL" && "Sell both puts and calls simultaneously at a target ratio. Put assignment averages down, then higher-delta calls recover shares faster."}
                  {strategy === "COVERED_CALL" && "Hold 100 shares per contract. Sell covered calls against them. If called away, buy shares and repeat."}
                  {strategy === "CASH_SECURED_PUT" && "Sell cash-secured puts. If assigned, hold shares or sell them, then sell more puts."}
                </p>
              </div>

              {/* Step-by-step rules */}
              <div className="space-y-3">
                <p className="font-semibold">Step-by-step rules</p>

                {/* Step 1: Strike selection */}
                <div className="rounded-md border bg-background p-3 space-y-1">
                  <p className="font-medium text-primary">1. Strike selection — Δ{deltaTarget.toFixed(2)} target</p>
                  <p className="text-muted-foreground">
                    Each cycle, find the strike with delta closest to <strong>{deltaTarget.toFixed(2)}</strong>.
                    For puts: the strike below the stock price where the put delta ≈ {deltaTarget.toFixed(2)}.
                    For calls: the strike above the stock price (or above your cost basis if floor is on) where the call delta ≈ {deltaTarget.toFixed(2)}.
                  </p>
                  {neverBelowCost && strategy !== "CASH_SECURED_PUT" && (
                    <p className="text-xs text-warning">
                      ⚠ Cost-basis floor is ON: never sell a call below your share cost basis, even if the delta target suggests a lower strike.
                    </p>
                  )}
                </div>

                {/* Step 2: Expiration selection */}
                <div className="rounded-md border bg-background p-3 space-y-1">
                  <p className="font-medium text-primary">2. Expiration — {dteTarget} DTE target</p>
                  <p className="text-muted-foreground">
                    Sell the expiration closest to <strong>{dteTarget} days</strong> out (~{Math.round(dteTarget / 7)} weeks / ~{Math.round(dteTarget / 30)} months).
                    The backtester picked the nearest available expiration to this target each cycle.
                  </p>
                </div>

                {/* Step 3: Entry rules */}
                <div className="rounded-md border bg-background p-3 space-y-1">
                  <p className="font-medium text-primary">3. Entry — when to sell</p>
                  <p className="text-muted-foreground">
                    {minYieldPct > 0 || minPutYieldPct > 0
                      ? <>Only sell if the premium is at least <strong>{(minYieldPct || minPutYieldPct).toFixed(1)}%</strong> of the stock price (e.g., on a $300 stock, collect at least ${((minYieldPct || minPutYieldPct) / 100 * 300).toFixed(2)}/share). Place a GTC limit order at this price — if it doesn&#39;t fill within the cycle, skip that cycle.</>
                      : <>Sell at the <strong>bid</strong> price (marketable limit at the current bid). The backtester uses {fillAssumption === "bid" ? "bid" : "mid"} as the fill assumption.</>
                    }
                  </p>
                  <p className="text-muted-foreground">
                    Sell <strong>{contracts}</strong> contract(s) per cycle{strategy === "WHEEL" ? " (puts when no shares, 1 call per 100 shares held)" : strategy === "RATIO_WHEEL" ? ` (split ${Math.round(putCallRatio * 100)}% puts / ${Math.round((1 - putCallRatio) * 100)}% calls when shares held)` : "."}
                  </p>
                </div>

                {/* Step 4: Exit / buyback */}
                <div className="rounded-md border bg-background p-3 space-y-1">
                  <p className="font-medium text-primary">4. Exit — buyback rule</p>
                  {buyBackPct > 0 ? (
                    <>
                      <p className="text-muted-foreground">
                        Place a GTC buyback order at <strong>{buyBackPct.toFixed(0)}%</strong> of the sale price.
                        This means: sell for $5.00 → buy back at $5.00 × {(1 - buyBackPct / 100).toFixed(2)} = <strong>${(5 * (1 - buyBackPct / 100)).toFixed(2)}</strong>.
                        You keep <strong>{buyBackPct.toFixed(0)}%</strong> of the premium.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        The backtester checked daily for this trigger. In real trading, place a GTC order and let it rest.
                        {(buyBackPct <= 25) && " At this low threshold, buybacks may trigger within days — be prepared for frequent cycling."}
                        {(buyBackPct >= 50 && buyBackPct < 80) && " This is a moderate threshold — buybacks typically take weeks."}
                        {(buyBackPct >= 80) && " This is a high threshold — you'll hold most positions to expiration."}
                      </p>
                    </>
                  ) : (
                    <p className="text-muted-foreground">
                      No buyback rule — hold to expiration. The option either expires worthless (keep full premium) or gets assigned/called away.
                    </p>
                  )}
                </div>

                {/* Step 5: Assignment / called away */}
                <div className="rounded-md border bg-background p-3 space-y-1">
                  <p className="font-medium text-primary">5. on assignment / called away</p>
                  {strategy === "RATIO_WHEEL" ? (
                    <p className="text-muted-foreground">
                      When a put is assigned → buy shares at the put strike (averages down cost basis). Next cycle, sell calls at {callDeltaAfterAssignment.toFixed(2)} delta (higher = more likely called away) to recover shares at a higher strike. When calls are called away → reset call delta and rebalance back to the {Math.round(putCallRatio * 100)}/{Math.round((1 - putCallRatio) * 100)} put:call ratio.
                    </p>
                  ) : strategy === "WHEEL" ? (
                    <p className="text-muted-foreground">
                      {rollOnAssignment
                        ? "Roll ITM calls: buy back at intrinsic value, keep shares, sell the next call. Never let shares be called away."
                        : "If a put is assigned → you buy 100 shares per contract at the strike price. Switch to selling covered calls. If a call is called away → shares are sold at the strike. Switch back to selling puts."
                      }
                    </p>
                  ) : strategy === "COVERED_CALL" ? (
                    <p className="text-muted-foreground">
                      If called away: shares are sold at the strike. Buy back 100 shares per contract and sell the next call.
                      {rollOnAssignment && " Roll instead: buy back the call at intrinsic and keep shares."}
                    </p>
                  ) : (
                    <p className="text-muted-foreground">
                      If assigned: you buy 100 shares per contract at the strike. Either hold them or sell and continue selling puts.
                    </p>
                  )}
                </div>

                {/* Step 6: Average down */}
                {averageDown && (
                  <div className="rounded-md border bg-background p-3 space-y-1">
                    <p className="font-medium text-primary">6. Average down via CSP</p>
                    <p className="text-muted-foreground">
                      When the stock is below your cost basis, a 20-delta cash-secured put is sold alongside the main cycle.
                      If assigned at expiration, 100 shares are acquired at the put strike (below current spot), lowering
                      your average cost basis. If expired worthless, the premium is kept.
                    </p>
                  </div>
                )}
              </div>

              {/* Backtest validation */}
              <div className="rounded-md border bg-muted/40 p-3 space-y-1.5">
                <p className="font-semibold">What the backtest showed</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-muted-foreground">Cycles:</span><span>{result.totalCycles} over {result.startDate} → {result.endDate}</span>
                  <span className="text-muted-foreground">Avg days/cycle:</span><span>{Math.round(result.avgDaysPerCycle)}</span>
                  <span className="text-muted-foreground">Total premium:</span><span>{formatCurrency(result.totalPremiumIncome, 0)}</span>
                  <span className="text-muted-foreground">Strategy return:</span><span className={result.strategyReturn >= 0 ? "text-profit" : "text-loss"}>{formatPercent(result.strategyReturn)}</span>
                  <span className="text-muted-foreground">Buy & hold:</span><span>{formatPercent(result.buyHoldReturn)}</span>
                  <span className="text-muted-foreground">Real data:</span><span>{result.dataSourceSummary?.realDataCycles ?? 0}/{result.dataSourceSummary?.totalCycles ?? result.totalCycles} cycles</span>
                  <span className="text-muted-foreground">Max drawdown:</span><span className="text-loss">{formatPercent(result.maxDrawdown)}</span>
                  <span className="text-muted-foreground">Sharpe:</span><span>{result.sharpeRatio != null ? result.sharpeRatio.toFixed(2) : "—"}</span>
                </div>
                {result.avgDaysPerCycle < 10 && buyBackPct > 0 && (
                  <p className="text-xs text-warning mt-2">
                    ⚠ Avg cycle is only {Math.round(result.avgDaysPerCycle)} days with {buyBackPct.toFixed(0)}% buyback.
                    This means buybacks trigger very quickly. In practice, you&#39;d need to monitor positions daily and place new orders the same day.
                    Consider a higher buyback % for less active management.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {monthlyData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Monthly cash flow</CardTitle>
                <CardDescription>
                  Net premium income by month (when positions closed). Avg: <strong className="text-profit">{formatCurrency(avgMonthlyIncome, 0)}/mo</strong> across {monthlyData.length} months.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} minTickGap={30} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${Number(v).toFixed(0)}`} />
                      <Tooltip formatter={(v) => formatCurrency(Number(v), 0)} contentStyle={{ fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="premium" name="Net premium" fill="#16a34a" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="gross" name="Gross premium" fill="#2563eb" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Month</TableHead>
                        <TableHead className="text-right">Net premium</TableHead>
                        <TableHead className="text-right">Gross premium</TableHead>
                        <TableHead className="text-right">Trades closed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {monthlyData.map((m) => (
                        <TableRow key={m.month}>
                          <TableCell className="font-medium">{m.month}</TableCell>
                          <TableCell className="text-right text-profit font-medium">{formatCurrency(m.premium, 0)}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{formatCurrency(m.gross, 0)}</TableCell>
                          <TableCell className="text-right">{m.trades}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {comparisonResults.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Comparison</CardTitle>
                <CardDescription>Side-by-side results for different parameter sets.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Variant</TableHead>
                      <TableHead className="text-right">Return</TableHead>
                      <TableHead className="text-right">Annualized</TableHead>
                      <TableHead className="text-right">Premium</TableHead>
                      <TableHead className="text-right">Cycles</TableHead>
                      <TableHead className="text-right">Max DD</TableHead>
                      <TableHead className="text-right" title="Risk-adjusted return. >1.0 good, >2.0 excellent, <0 worse than T-bills">Sharpe</TableHead>
                      <TableHead className="text-right">Win rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {comparisonResults.map((r, i) => (
                      <TableRow key={i} className={cn("cursor-pointer", r === result && "bg-muted/50")} onClick={() => setResult(r)}>
                        <TableCell className="font-medium">{r._label ?? `Variant ${i + 1}`}</TableCell>
                        <TableCell className={cn("text-right", r.strategyReturn >= 0 ? "text-profit" : "text-loss")}>
                          {formatPercent(r.strategyReturn)}
                        </TableCell>
                        <TableCell className="text-right">{formatPercent(r.strategyAnnualizedReturn)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(r.totalPremiumIncome, 0)}</TableCell>
                        <TableCell className="text-right">{r.totalCycles}</TableCell>
                        <TableCell className="text-right text-loss">{formatPercent(r.maxDrawdown)}</TableCell>
                        <TableCell className="text-right">{r.sharpeRatio != null ? r.sharpeRatio.toFixed(2) : "—"}</TableCell>
                        <TableCell className="text-right">{formatPercent(r.winRate)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="mt-2 text-xs text-muted-foreground">Click a row to view its full results above.</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Equity curve</CardTitle>
              <CardDescription>
                Both lines start from the same capital ({formatCurrency(result.startingCapital, 0)}), so the
                gap is the strategy&apos;s contribution versus holding shares.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {chartData.length > 1 ? (
                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={40} />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}k`}
                      />
                      <Tooltip
                        formatter={(v) => formatCurrency(Number(v), 0)}
                        contentStyle={{ fontSize: 12 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="Strategy" stroke="#2563eb" dot={false} strokeWidth={2} />
                      <Line type="monotone" dataKey="Buy & hold" stroke="#94a3b8" dot={false} strokeWidth={2} />
                      {result.marketContext && (
                        <Line type="monotone" dataKey="SPY" stroke="#f59e0b" dot={false} strokeWidth={1.5} strokeDasharray="4 4" />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Not enough completed cycles to plot an equity curve. Try a longer history window or a
                  shorter DTE.
                </p>
              )}
            </CardContent>
          </Card>

          {result.marketContext && (
            <MarketContextCard context={result.marketContext} />
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Outcome breakdown</CardTitle>
                <CardDescription>
                  {result.totalCycles} cycles between {result.startDate} and {result.endDate}.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Bought back (win)" value={String(result.earlyCloseCount)} />
                <Row label="Expired worthless (win)" value={String(result.expiredWorthlessCount)} />
                <Row label="Assigned (put)" value={String(result.assignmentCount)} />
                <Row label="Called away (call)" value={String(result.calledAwayCount)} />
                <Row label="Avg premium / cycle" value={formatCurrency(result.avgPremiumPerCycle, 2)} />
                <Row label="Avg days / cycle" value={`${Math.round(result.avgDaysPerCycle)}`} />
                {result.costBasisFlooredCount > 0 && (
                  <Row
                    label="Cycles floored at cost basis"
                    value={String(result.costBasisFlooredCount)}
                  />
                )}
                {result.noFillCount > 0 && (
                  <Row label="GTC orders not filled" value={String(result.noFillCount)} />
                )}
                {result.avgCallPremiumYield > 0 && (
                  <Row label="Avg call yield / cycle" value={formatPercent(result.avgCallPremiumYield, 2)} />
                )}
                {result.averagedDownLots > 0 && (
                  <>
                    <Row label="Lots bought (avg down)" value={String(result.averagedDownLots)} />
                    <Row label="Premium reinvested" value={formatCurrency(result.reinvestedPremium, 0)} />
                    <Row label="Ending shares" value={String(result.endingShares)} />
                    {result.endingCostBasis != null && (
                      <Row label="Ending cost basis" value={formatCurrency(result.endingCostBasis, 2)} />
                    )}
                  </>
                )}
                {result.earlyCloseCount > 0 && (
                  <Row label="Closed early (buy-back)" value={String(result.earlyCloseCount)} />
                )}
                {(result.touchCycles ?? 0) > 0 && (
                  <Row
                    label="GTC intraday fills"
                    value={`${result.touchExitCount ?? 0} buy-backs + ${result.touchEntryCount ?? 0} entries (of ${result.touchCycles} cycles with daily data)`}
                  />
                )}
                {result.rolledCount > 0 && (
                  <Row label="Calls rolled" value={String(result.rolledCount)} />
                )}
                {result.ratioPutContractsSold > 0 && (
                  <Row label="Ratio puts sold" value={String(result.ratioPutContractsSold)} />
                )}
                {result.ratioCallContractsSold > 0 && (
                  <Row label="Ratio calls sold" value={String(result.ratioCallContractsSold)} />
                )}
                {result.ratioDeltaAdjustments > 0 && (
                  <Row label="Delta adjustments (after assignment)" value={String(result.ratioDeltaAdjustments)} />
                )}
                {result.ratioRebalances > 0 && (
                  <Row label="Ratio rebalances (after call-away)" value={String(result.ratioRebalances)} />
                )}
                {result.putNoFillCount > 0 && (
                  <Row label="Put GTC not filled" value={String(result.putNoFillCount)} />
                )}
                {result.avgPutPremiumYield > 0 && (
                  <Row label="Avg put yield / cycle" value={formatPercent(result.avgPutPremiumYield, 2)} />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Annualized comparison</CardTitle>
                <CardDescription>Annualized figures are comparison tools, not expected returns.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Strategy annualized" value={formatPercent(result.strategyAnnualizedReturn)} />
                <Row label="Buy & hold annualized" value={formatPercent(result.buyHoldAnnualizedReturn)} />
                <Row label="Period" value={`${result.startDate} → ${result.endDate}`} />
                <Row label="Underlying now" value={formatCurrency(result.underlyingPrice, 2)} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Trade log</CardTitle>
              <CardDescription>
                Last {Math.min(result.trades.length, 25)} cycles. After an early buy-back, the next
                cycle opens the same day: fresh delta-target strike at the current price, and a new
                full DTE window (new expiration). Compare a row&apos;s Expiration vs. Closed columns — when
                Closed &lt; Expiration, that position was bought back early and re-sold immediately.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Opened</TableHead>
                      <TableHead>Expiration</TableHead>
                      <TableHead>Closed</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Strike</TableHead>
                      <TableHead className="text-right">Stock open</TableHead>
                      <TableHead className="text-right">Stock close</TableHead>
                      <TableHead className="text-right">Premium</TableHead>
                      <TableHead className="text-right">Buy-back</TableHead>
                      <TableHead className="text-right">Yield</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead className="text-right">Cycle P/L</TableHead>
                      <TableHead>Next cycle</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.trades.slice(-25).reverse().map((t, i) => {
                      const closedEarly = t.outcome === "BOUGHT_BACK" || t.outcome === "ROLLED";
                      const nextTrade = result.trades.find(
                        (nt) => nt.openDate === t.closeDate && nt !== t && nt.outcome !== "NO_FILL",
                      );
                      return (
                      <TableRow key={i} className={cn(closedEarly && "bg-muted/30")}>
                        <TableCell className="whitespace-nowrap">{t.openDate}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{t.expirationDate}</TableCell>
                        <TableCell className={cn("whitespace-nowrap", closedEarly && "font-medium text-warning")}>
                          {t.closeDate}
                        </TableCell>
                        <TableCell>{t.optionType}</TableCell>
                        <TableCell className="text-right">{formatCurrency(t.strike, 2)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(t.stockPriceAtOpen, 2)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(t.stockPriceAtClose, 2)}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(t.premiumIncome, 2)}
                          {t.entryByTouch && (
                            <span className="ml-1 text-xs text-primary">(intraday)</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {t.exitPremium != null ? (
                            <>
                              {formatCurrency(t.exitPremium, 2)}
                              {t.exitByTouch && (
                                <span className="ml-1 text-xs text-primary">(intraday)</span>
                              )}
                            </>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {t.outcome === "NO_FILL" ? "—" : formatPercent(t.premiumYield, 2)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={outcomeVariant(t.outcome)}>{t.outcome.replace(/_/g, " ").toLowerCase()}</Badge>
                        </TableCell>
                        <TableCell>
                          {t.dataSource === "REAL" ? (
                            <Badge variant="profit" className="text-xs">REAL</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">BS</Badge>
                          )}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-medium",
                            t.cyclePnl >= 0 ? "text-profit" : "text-loss",
                          )}
                        >
                          {formatCurrency(t.cyclePnl, 2)}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {closedEarly && nextTrade ? (
                            <span className="text-muted-foreground">
                              → re-sold same day @ {formatCurrency(nextTrade.strike, 0)} strike, new exp {nextTrade.expirationDate}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function outcomeVariant(outcome: string): "profit" | "warning" | "loss" | "secondary" {
  if (outcome === "EXPIRED_WORTHLESS" || outcome === "BOUGHT_BACK") return "profit";
  if (outcome === "CALLED_AWAY") return "warning";
  if (outcome === "ASSIGNED") return "loss";
  return "secondary"; // NO_FILL, ROLLED
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "profit" | "loss";
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground" title={hint}>{label}</p>
        <p
          className={cn(
            "mt-1 text-xl font-semibold",
            tone === "profit" && "text-profit",
            tone === "loss" && "text-loss",
          )}
          title={hint}
        >
          {value}
        </p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

const REGIME_COLORS: Record<string, string> = {
  BULL: "bg-profit/15 text-profit border-profit/30",
  BEAR: "bg-loss/15 text-loss border-loss/30",
  CRISIS: "bg-destructive/20 text-destructive border-destructive/40",
  RECOVERY: "bg-warning/15 text-warning border-warning/30",
};

function MarketContextCard({ context }: { context: MarketContext }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Market context — {context.benchmarkSymbol} benchmark</CardTitle>
        <CardDescription>
          Is this stock&apos;s performance driven by the broader market, or is it company-specific?
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Avg beta (90d)" value={context.avgBeta.toFixed(2)} />
          <Stat label="Avg correlation" value={context.avgCorrelation.toFixed(2)} />
          <Stat
            label="Alpha vs market"
            value={formatPercent(context.alpha, 1)}
            tone={context.alpha >= 0 ? "profit" : "loss"}
          />
          <Stat
            label="Current regime"
            value={context.currentRegime}
            tone={context.currentRegime === "BULL" ? "profit" : context.currentRegime === "CRISIS" || context.currentRegime === "BEAR" ? "loss" : undefined}
          />
          <Stat label={`${context.benchmarkSymbol} return`} value={formatPercent(context.benchmarkReturn)} tone={context.benchmarkReturn >= 0 ? "profit" : "loss"} />
          <Stat label={`${context.benchmarkSymbol} max DD`} value={formatPercent(context.benchmarkMaxDrawdown)} tone="loss" />
          <Stat
            label="Systemic drawdown %"
            value={formatPercent(context.systemicDrawdownPct, 0)}
          />
          <Stat
            label="Drawdowns attributed"
            value={`${context.drawdownAttributions.length} (${context.drawdownAttributions.filter((d) => d.type === "SYSTEMIC").length} systemic, ${context.drawdownAttributions.filter((d) => d.type === "IDIOSYNCRATIC").length} company-specific)`}
          />
        </div>

        <div className="rounded-md border bg-muted/30 p-3 text-sm leading-relaxed">
          {context.summary}
        </div>

        {context.regimes.length > 1 && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Market regime timeline</p>
            <div className="flex flex-wrap gap-1.5">
              {context.regimes.map((r, i) => (
                <div
                  key={i}
                  className={cn("rounded border px-2 py-1 text-xs", REGIME_COLORS[r.type] ?? "bg-muted text-muted-foreground border-border")}
                  title={r.description}
                >
                  <span className="font-medium">{r.type}</span>
                  <span className="ml-1 opacity-70">
                    {r.startDate.slice(0, 7)}–{r.endDate.slice(0, 7)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {context.drawdownAttributions.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Drawdown attribution ({">"}10% stock drawdowns)</p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Stock DD</TableHead>
                    <TableHead className="text-right">Market DD</TableHead>
                    <TableHead className="text-right">Systemic %</TableHead>
                    <TableHead>Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {context.drawdownAttributions.map((d, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {d.startDate.slice(0, 10)} → {d.endDate.slice(0, 10)}
                      </TableCell>
                      <TableCell className="text-right text-loss">{formatPercent(d.stockDrawdown)}</TableCell>
                      <TableCell className="text-right">{formatPercent(d.marketDrawdown)}</TableCell>
                      <TableCell className="text-right">{formatPercent(d.systemicFraction, 0)}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            d.type === "SYSTEMIC" ? "secondary" :
                            d.type === "IDIOSYNCRATIC" ? "loss" : "warning"
                          }
                        >
                          {d.type === "SYSTEMIC" ? "Market-driven" : d.type === "IDIOSYNCRATIC" ? "Company-specific" : "Mixed"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="mt-2 space-y-1">
              {context.drawdownAttributions.map((d, i) => (
                <p key={i} className="text-xs text-muted-foreground">
                  <span className={cn(
                    "font-medium",
                    d.type === "SYSTEMIC" && "text-secondary",
                    d.type === "IDIOSYNCRATIC" && "text-loss",
                    d.type === "MIXED" && "text-warning",
                  )}>
                    {d.startDate.slice(0, 10)}:
                  </span>{" "}
                  {d.description}
                </p>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
