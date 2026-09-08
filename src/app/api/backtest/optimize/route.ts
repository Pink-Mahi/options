/**
 * Auto-optimizer API — sweeps ALL strategy parameters to find the
 * best-performing settings for a given stock. Just enter a ticker.
 *
 * Two-phase approach:
 * 1. Coarse sweep: strategy × delta × DTE × buyback (high-impact params)
 * 2. Fine-tune: top candidates from phase 1 × boolean toggles + min yield
 *
 * Fetches historical data once, then runs all backtests server-side.
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getHistoricalPrices, getQuote } from "@/features/market-data/service";
import { runBacktest, type BacktestStrategy } from "@/lib/calculations/backtester";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ALLOWED_RANGES = ["1y", "3y", "5y", "10y", "max"] as const;
type HistRange = (typeof ALLOWED_RANGES)[number];

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
  maxDrawdown: number;
  totalPremiumIncome: number;
  winRate: number;
  totalCycles: number;
  assignmentCount: number;
  earlyCloseCount: number;
  avgPremiumPerCycle: number;
}

// Phase 1 sweep grids
const STRATEGIES: BacktestStrategy[] = ["COVERED_CALL", "CASH_SECURED_PUT", "WHEEL"];
const DELTAS = [0.15, 0.20, 0.25, 0.30, 0.35, 0.40];
const DTES = [7, 14, 21, 30, 45, 60, 90, 120, 180];
const BUYBACKS = [0, 20, 40, 50, 60, 70, 80];

// Phase 2 fine-tune grid (applied to top 10 from phase 1)
const MIN_YIELDS = [0, 0.02, 0.03];
const BOOLEANS: { neverBelowCost: boolean; averageDown: boolean; rollOnAssignment: boolean }[] = [
  { neverBelowCost: false, averageDown: false, rollOnAssignment: false },
  { neverBelowCost: true, averageDown: false, rollOnAssignment: false },
  { neverBelowCost: false, averageDown: true, rollOnAssignment: false },
  { neverBelowCost: true, averageDown: true, rollOnAssignment: false },
  { neverBelowCost: false, averageDown: false, rollOnAssignment: true },
  { neverBelowCost: true, averageDown: true, rollOnAssignment: true },
];

function runOne(
  points: Parameters<typeof runBacktest>[0],
  cfg: {
    strategy: BacktestStrategy;
    symbol: string;
    deltaTarget: number;
    dteTarget: number;
    contracts: number;
    startingCapital: number;
    shares: number;
    strikeInterval: number;
    buyBackPct: number;
    minCallYieldPct?: number;
    minPutYieldPct?: number;
    neverBelowCost: boolean;
    averageDown: boolean;
    rollOnAssignment: boolean;
  },
  spyPoints?: Parameters<typeof runBacktest>[2],
): OptimizeResult | null {
  try {
    const result = runBacktest(
      points,
      {
        strategy: cfg.strategy,
        symbol: cfg.symbol,
        deltaTarget: cfg.deltaTarget,
        dteTarget: cfg.dteTarget,
        contracts: cfg.contracts,
        riskFreeRate: 0.05,
        startingCapital: cfg.startingCapital,
        shares: cfg.shares,
        strikeInterval: cfg.strikeInterval,
        fillAssumption: "bid",
        neverSellCallBelowCostBasis: cfg.neverBelowCost,
        minCallPremiumYieldPct: cfg.minCallYieldPct || undefined,
        minPutPremiumYieldPct: cfg.minPutYieldPct || undefined,
        averageDownWithPremium: cfg.averageDown,
        buyBackPct: cfg.buyBackPct > 0 ? cfg.buyBackPct / 100 : undefined,
        rollOnAssignment: cfg.rollOnAssignment,
      },
      spyPoints,
    );

    return {
      strategy: cfg.strategy,
      dte: cfg.dteTarget,
      buyBackPct: cfg.buyBackPct,
      deltaTarget: cfg.deltaTarget,
      minCallYieldPct: cfg.minCallYieldPct ?? 0,
      minPutYieldPct: cfg.minPutYieldPct ?? 0,
      neverBelowCost: cfg.neverBelowCost,
      averageDown: cfg.averageDown,
      rollOnAssignment: cfg.rollOnAssignment,
      strategyReturn: result.strategyReturn,
      annualizedReturn: result.strategyAnnualizedReturn,
      buyHoldReturn: result.buyHoldReturn,
      outperformance: result.outperformance,
      sharpeRatio: result.sharpeRatio,
      maxDrawdown: result.maxDrawdown,
      totalPremiumIncome: result.totalPremiumIncome,
      winRate: result.winRate,
      totalCycles: result.totalCycles,
      assignmentCount: result.assignmentCount + result.calledAwayCount,
      earlyCloseCount: result.earlyCloseCount,
      avgPremiumPerCycle: result.avgPremiumPerCycle,
    };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const symbol = String(body.symbol ?? "").toUpperCase().trim();
    if (!symbol) return NextResponse.json({ error: "symbol is required" }, { status: 400 });

    const requestedRange = String(body.range ?? "3y").toLowerCase();
    const range: HistRange = (ALLOWED_RANGES as readonly string[]).includes(requestedRange)
      ? (requestedRange as HistRange)
      : "3y";

    const contracts = Number(body.contracts) > 0 ? Number(body.contracts) : 1;

    // Fetch data once
    const [hist, quote, spyHist] = await Promise.all([
      getHistoricalPrices({ symbol, range }),
      getQuote({ symbol }),
      getHistoricalPrices({ symbol: "SPY", range }).catch(() => null),
    ]);

    const spot = quote.data.price;
    const startingCapital = Math.max(spot * contracts * 100, 1);
    const strikeInterval = spot >= 200 ? 5 : spot >= 50 ? 2.5 : 1;
    const points = hist.data.points;
    const spyPoints = spyHist?.data.points;

    // ---- Phase 1: Coarse sweep (strategy × delta × DTE × buyback) ----
    const phase1Results: OptimizeResult[] = [];

    for (const strategy of STRATEGIES) {
      const shares = strategy === "CASH_SECURED_PUT" ? 0 : contracts * 100;
      for (const delta of DELTAS) {
        for (const dte of DTES) {
          for (const buyBack of BUYBACKS) {
            const r = runOne(points, {
              strategy,
              symbol,
              deltaTarget: delta,
              dteTarget: dte,
              contracts,
              startingCapital,
              shares,
              strikeInterval,
              buyBackPct: buyBack,
              neverBelowCost: false,
              averageDown: false,
              rollOnAssignment: false,
            }, spyPoints);
            if (r) phase1Results.push(r);
          }
        }
      }
    }

    // Sort phase 1 by annualized return, take top 10
    phase1Results.sort((a, b) => b.annualizedReturn - a.annualizedReturn);
    const phase1Top = phase1Results.slice(0, 10);

    // ---- Phase 2: Fine-tune top 10 with boolean toggles + min yield ----
    const allResults: OptimizeResult[] = [...phase1Results];

    for (const base of phase1Top) {
      const shares = base.strategy === "CASH_SECURED_PUT" ? 0 : contracts * 100;
      for (const minYield of MIN_YIELDS) {
        for (const bools of BOOLEANS) {
          // Skip if this is the same as the base config (already in results)
          if (
            minYield === 0 &&
            bools.neverBelowCost === false &&
            bools.averageDown === false &&
            bools.rollOnAssignment === false
          ) {
            continue;
          }

          const r = runOne(points, {
            strategy: base.strategy as BacktestStrategy,
            symbol,
            deltaTarget: base.deltaTarget,
            dteTarget: base.dte,
            contracts,
            startingCapital,
            shares,
            strikeInterval,
            buyBackPct: base.buyBackPct,
            minCallYieldPct: base.strategy === "CASH_SECURED_PUT" ? undefined : minYield,
            minPutYieldPct: base.strategy === "COVERED_CALL" ? undefined : minYield,
            neverBelowCost: bools.neverBelowCost,
            averageDown: bools.averageDown,
            rollOnAssignment: bools.rollOnAssignment,
          }, spyPoints);
          if (r) allResults.push(r);
        }
      }
    }

    // Sort all results, take top 20
    allResults.sort((a, b) => b.annualizedReturn - a.annualizedReturn);
    const top20 = allResults.slice(0, 20);

    return NextResponse.json({
      symbol,
      range,
      totalCombinations: allResults.length,
      phase1Combinations: phase1Results.length,
      phase2Combinations: allResults.length - phase1Results.length,
      topResults: top20,
      buyHoldReturn: top20[0]?.buyHoldReturn ?? 0,
      modelCaveat:
        "Option premiums are modeled with Black-Scholes using trailing 30-day realized volatility, not historical option quotes. Rankings are comparative within the same model, not absolute predictions. Past performance does not guarantee future results.",
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
