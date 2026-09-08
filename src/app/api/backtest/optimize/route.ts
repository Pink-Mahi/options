/**
 * Auto-optimizer API — sweeps DTE and buyback combinations to find the
 * best-performing strategy settings. Fetches historical data once, then
 * runs the backtester for each combination server-side.
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getHistoricalPrices, getQuote } from "@/features/market-data/service";
import { runBacktest, type BacktestStrategy } from "@/lib/calculations/backtester";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ALLOWED_STRATEGIES: BacktestStrategy[] = ["COVERED_CALL", "CASH_SECURED_PUT", "WHEEL"];
const ALLOWED_RANGES = ["1y", "3y", "5y", "10y", "max"] as const;
type HistRange = (typeof ALLOWED_RANGES)[number];

interface OptimizeResult {
  dte: number;
  buyBackPct: number;
  deltaTarget: number;
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

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const symbol = String(body.symbol ?? "").toUpperCase().trim();
    if (!symbol) return NextResponse.json({ error: "symbol is required" }, { status: 400 });

    const rawStrategy = String(body.strategy ?? "").toUpperCase();
    if (!(ALLOWED_STRATEGIES as string[]).includes(rawStrategy)) {
      return NextResponse.json({ error: "Invalid strategy" }, { status: 400 });
    }
    const strategy = rawStrategy as BacktestStrategy;

    const requestedRange = String(body.range ?? "3y").toLowerCase();
    const range: HistRange = (ALLOWED_RANGES as readonly string[]).includes(requestedRange)
      ? (requestedRange as HistRange)
      : "3y";

    // Fixed parameters (user sets these, optimizer sweeps the rest)
    const deltaTarget = Number(body.deltaTarget) > 0 ? Number(body.deltaTarget) : 0.3;
    const contracts = Number(body.contracts) > 0 ? Number(body.contracts) : 1;
    const minYieldPct = Number(body.minCallPremiumYieldPct) > 0 ? Number(body.minCallPremiumYieldPct) : undefined;
    const minPutYieldPct = Number(body.minPutPremiumYieldPct) > 0 ? Number(body.minPutPremiumYieldPct) : undefined;
    const neverBelowCost = body.neverSellCallBelowCostBasis === true;
    const averageDown = body.averageDownWithPremium === true;
    const rollOnAssignment = body.rollOnAssignment === true;
    const fillAssumption: "bid" | "mid" = body.fillAssumption === "mid" ? "mid" : "bid";

    // Sweep ranges (with defaults)
    const dteOptions: number[] = body.dteOptions
      ? body.dteOptions
      : [7, 14, 21, 30, 45, 60, 90, 120, 180, 270, 365];
    const buyBackOptions: number[] = body.buyBackOptions
      ? body.buyBackOptions
      : [0, 10, 20, 30, 40, 50, 60, 70, 80];

    // Fetch data once
    const [hist, quote, spyHist] = await Promise.all([
      getHistoricalPrices({ symbol, range }),
      getQuote({ symbol }),
      getHistoricalPrices({ symbol: "SPY", range }).catch(() => null),
    ]);

    const spot = quote.data.price;
    const shares = strategy === "CASH_SECURED_PUT" ? 0 : contracts * 100;
    const startingCapital =
      Number(body.startingCapital) > 0
        ? Number(body.startingCapital)
        : Math.max(spot * contracts * 100, 1);
    const strikeInterval = spot >= 200 ? 5 : spot >= 50 ? 2.5 : 1;
    const points = hist.data.points;
    const spyPoints = spyHist?.data.points;

    const results: OptimizeResult[] = [];

    for (const dte of dteOptions) {
      for (const buyBack of buyBackOptions) {
        try {
          const result = runBacktest(
            points,
            {
              strategy,
              symbol,
              deltaTarget,
              dteTarget: dte,
              contracts,
              riskFreeRate: 0.05,
              startingCapital,
              shares,
              strikeInterval,
              fillAssumption,
              neverSellCallBelowCostBasis: neverBelowCost,
              minCallPremiumYieldPct: minYieldPct,
              minPutPremiumYieldPct: minPutYieldPct,
              averageDownWithPremium: averageDown,
              buyBackPct: buyBack > 0 ? buyBack / 100 : undefined,
              rollOnAssignment,
            },
            spyPoints,
          );

          results.push({
            dte,
            buyBackPct: buyBack,
            deltaTarget,
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
          });
        } catch {
          // Skip failed combinations
        }
      }
    }

    // Sort by annualized return descending, take top 20
    results.sort((a, b) => b.annualizedReturn - a.annualizedReturn);
    const top20 = results.slice(0, 20);

    return NextResponse.json({
      symbol,
      strategy,
      range,
      totalCombinations: results.length,
      topResults: top20,
      buyHoldReturn: top20[0]?.buyHoldReturn ?? 0,
      modelCaveat:
        "Option premiums are modeled with Black-Scholes using trailing 30-day realized volatility, not historical option quotes. Rankings are comparative within the same model, not absolute predictions.",
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
