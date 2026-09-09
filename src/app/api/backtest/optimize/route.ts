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
import { isThetaDataConfigured, prefetchEODChains, type ThetaDataEODQuote } from "@/features/market-data/thetadata";

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
  realDataCycles: number;
  bsModelCycles: number;
  compositeScore: number;
  avgMonthlyIncome: number;
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

async function runOne(
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
  realData?: Map<string, ThetaDataEODQuote[]>,
): Promise<OptimizeResult | null> {
  try {
    const result = await runBacktest(
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
        ivRiskPremium: 1.15,
        ivSkewEnabled: true,
        termStructureEnabled: true,
        neverSellCallBelowCostBasis: cfg.neverBelowCost,
        minCallPremiumYieldPct: cfg.minCallYieldPct || undefined,
        minPutPremiumYieldPct: cfg.minPutYieldPct || undefined,
        averageDownWithPremium: cfg.averageDown,
        buyBackPct: cfg.buyBackPct > 0 ? cfg.buyBackPct / 100 : undefined,
        rollOnAssignment: cfg.rollOnAssignment,
        realData,
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
      realDataCycles: result.realDataCycles,
      bsModelCycles: result.bsModelCycles,
      compositeScore: 0, // computed after all results collected
      avgMonthlyIncome: result.monthlyCashFlow.length > 0
        ? result.monthlyCashFlow.reduce((s, m) => s + m.netPremium, 0) / result.monthlyCashFlow.length
        : 0,
    };
  } catch {
    return null;
  }
}

type OptimizeGoal = "cash_flow" | "balanced" | "long_term_gains";

function computeCompositeScore(r: OptimizeResult, riskTolerance: number, goal: OptimizeGoal): number {
  // riskTolerance: 0 = conservative, 1 = balanced, 2 = aggressive
  const annReturn = r.annualizedReturn;
  const totalReturn = r.strategyReturn;
  const sharpe = r.sharpeRatio ?? 0;
  const dd = Math.abs(r.maxDrawdown);
  const winRate = r.winRate;
  const assignments = r.assignmentCount;
  const cycles = r.totalCycles;
  const premium = r.totalPremiumIncome;

  // Goal-based weighting adjustments
  if (goal === "cash_flow") {
    // Maximize frequent premium income. Weight annualized return,
    // premium volume, and cycle count. Penalize drawdown.
    const base = annReturn * 0.4 + premium / 10000 + cycles * 0.5 + winRate * 10;
    if (riskTolerance <= 0.5) {
      return base + sharpe * 15 + (1 - dd) * 20;
    } else if (riskTolerance <= 1.5) {
      return base + sharpe * 8 + (1 - dd) * 8;
    } else {
      return base + sharpe * 3 + (1 - dd) * 3;
    }
  } else if (goal === "long_term_gains") {
    // Maximize total return including stock appreciation. Weight
    // totalReturn heavily, penalize assignments (which cap upside),
    // reward lower delta (already reflected in fewer assignments).
    const base = totalReturn * 0.6 + annReturn * 0.2 + winRate * 5;
    const assignPenalty = assignments * 2;
    if (riskTolerance <= 0.5) {
      return base + sharpe * 12 + (1 - dd) * 15 - assignPenalty;
    } else if (riskTolerance <= 1.5) {
      return base + sharpe * 6 + (1 - dd) * 8 - assignPenalty;
    } else {
      return base + sharpe * 2 + (1 - dd) * 3 - assignPenalty * 0.5;
    }
  } else {
    // Balanced: current behavior
    if (riskTolerance <= 0.5) {
      return annReturn * 0.3 + sharpe * 15 + (1 - dd) * 20 + winRate * 10;
    } else if (riskTolerance <= 1.5) {
      return annReturn * 0.5 + sharpe * 10 + (1 - dd) * 10 + winRate * 5;
    } else {
      return annReturn * 0.8 + sharpe * 5 + (1 - dd) * 5 + winRate * 2;
    }
  }
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { symbol?: string; range?: string; contracts?: number; dteMin?: number; dteMax?: number; strategy?: string; riskTolerance?: number; goal?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const symbol = String(body.symbol ?? "").toUpperCase().trim();
  if (!symbol) return NextResponse.json({ error: "symbol is required" }, { status: 400 });

  const requestedRange = String(body.range ?? "3y").toLowerCase();
  const range: HistRange = (ALLOWED_RANGES as readonly string[]).includes(requestedRange)
    ? (requestedRange as HistRange)
    : "3y";

  const contracts = Number(body.contracts) > 0 ? Number(body.contracts) : 1;
  const riskTolerance = Math.max(0, Math.min(2, Number(body.riskTolerance ?? 1)));
  const goal: OptimizeGoal = body.goal === "cash_flow" || body.goal === "long_term_gains" ? body.goal : "balanced";

  // Optional DTE range filter (e.g. 45-90, <=60, >=45)
  const dteMin = Number(body.dteMin) > 0 ? Number(body.dteMin) : 0;
  const dteMax = Number(body.dteMax) > 0 ? Number(body.dteMax) : 0;

  // Filter DTE grid if range constraints provided
  const sweepDtes = DTES.filter((d) => {
    if (dteMin > 0 && d < dteMin) return false;
    if (dteMax > 0 && d > dteMax) return false;
    return true;
  });

  if (sweepDtes.length === 0) {
    return NextResponse.json({ error: "No DTE values match the specified range" }, { status: 400 });
  }

  // Optional strategy filter — if provided, only sweep that strategy.
  // Otherwise sweep all three (existing behavior).
  const ALLOWED_STRATEGIES: BacktestStrategy[] = ["COVERED_CALL", "CASH_SECURED_PUT", "WHEEL"];
  const requestedStrategy = String(body.strategy ?? "").toUpperCase().trim();
  const sweepStrategies = requestedStrategy && (ALLOWED_STRATEGIES as readonly string[]).includes(requestedStrategy)
    ? [requestedStrategy as BacktestStrategy]
    : ALLOWED_STRATEGIES;

  const phase1Total = sweepStrategies.length * DELTAS.length * sweepDtes.length * BUYBACKS.length;

  // NDJSON stream: one JSON event per line. Progress events flow to the UI
  // while the sweep runs; the final line carries the full result payload.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // Client disconnected mid-run — keep computing, writes are best-effort.
        }
      };

      try {
        send({ type: "progress", message: "Loading price history…" });

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

        // ---- Pre-fetch real ThetaData EOD chains (shared across ALL combinations) ----
        // Fetching every trading day ensures every cycle open has real data,
        // regardless of how buyback timing shifts cycle start dates.
        let realData: Map<string, ThetaDataEODQuote[]> | undefined;
        let fetchedDatesCount = 0;
        if (isThetaDataConfigured()) {
          // Fetch EVERY trading day from index 30 onward. The backtester
          // advances idx to effCloseIdx (the buyback or expiry date), so
          // actual cycle starts don't align with a fixed step grid — they
          // depend on how quickly the option decays to the buyback target.
          // Only by fetching all dates can we guarantee every cycle open
          // has real data. With 200ms delay, ~750 dates takes ~2.5 min.
          const allDates = points.slice(30).map((p) => p.date);
          const maxDates = Number(process.env.THETADATA_OPTIMIZE_MAX_DATES ?? 0);
          let datesToFetch = allDates;
          if (maxDates > 0 && allDates.length > maxDates) {
            const stride = allDates.length / maxDates;
            datesToFetch = Array.from({ length: maxDates }, (_, k) =>
              allDates[Math.floor(k * stride)]!,
            );
          }
          if (datesToFetch.length > 0) {
            fetchedDatesCount = datesToFetch.length;
            console.log(`[optimize] Pre-fetching ${datesToFetch.length} EOD chains from ThetaData (${allDates.length} cycle dates in grid)...`);
            send({
              type: "progress",
              stage: "prefetch",
              message: `Fetching ${datesToFetch.length} historical option chains from ThetaData — this is the slow part`,
              done: 0,
              total: datesToFetch.length,
            });
            try {
              realData = await prefetchEODChains(
                symbol,
                datesToFetch,
                (done, total) =>
                  send({ type: "progress", stage: "prefetch", message: "Fetching historical option chains from ThetaData", done, total }),
              );
              const withData = Array.from(realData.values()).filter((q) => q.length > 0).length;
              console.log(`[optimize] ThetaData prefetch complete: ${withData}/${datesToFetch.length} dates returned real quotes`);
              if (withData === 0) {
                console.warn("[optimize] ThetaData terminal is not reachable or returned no data — all combinations will use BS model. Check container logs for terminal startup.");
                // The terminal's own log says why it returns empty data
                // (auth failure, tier limits, MDDS issues). Same container.
                try {
                  const { readFile } = await import("node:fs/promises");
                  const log = await readFile("/tmp/thetadata.log", "utf8");
                  const lines = log.split("\n").filter((l) => l.trim().length > 0).slice(-40);
                  console.warn("[optimize] Theta Terminal log (last 40 lines):\n" + lines.join("\n"));
                } catch {
                  console.warn("[optimize] (no Theta Terminal log found at /tmp/thetadata.log)");
                }
                realData = undefined;
              }
            } catch (err) {
              console.warn("[optimize] ThetaData prefetch failed, using BS model:", err);
            }
          }
        }

        // ---- Phase 1: Coarse sweep (strategy × delta × DTE × buyback) ----
        const phase1Results: OptimizeResult[] = [];
        let phase1Done = 0;

        for (const strategy of sweepStrategies) {
          const shares = strategy === "CASH_SECURED_PUT" ? 0 : contracts * 100;
          for (const delta of DELTAS) {
            for (const dte of sweepDtes) {
              for (const buyBack of BUYBACKS) {
                const r = await runOne(points, {
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
                }, spyPoints, realData);
                if (r) phase1Results.push(r);
                phase1Done++;
                // Yield to the event loop periodically so streamed progress
                // events actually flush to the client mid-sweep.
                if (phase1Done % 25 === 0 || phase1Done === phase1Total) {
                  send({ type: "progress", stage: "phase1", message: "Phase 1: sweeping strategy × delta × DTE × buyback", done: phase1Done, total: phase1Total });
                  await new Promise((resolve) => setTimeout(resolve, 0));
                }
              }
            }
          }
        }

        // Sort phase 1 by composite score, take top 10
        for (const r of phase1Results) {
          r.compositeScore = computeCompositeScore(r, riskTolerance, goal);
        }
        phase1Results.sort((a, b) => b.compositeScore - a.compositeScore);
        const phase1Top = phase1Results.slice(0, 10);

        // ---- Phase 2: Fine-tune top 10 with boolean toggles + min yield ----
        const allResults: OptimizeResult[] = [...phase1Results];
        const phase2Total = phase1Top.length * (MIN_YIELDS.length * BOOLEANS.length - 1);
        let phase2Done = 0;

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

              const r = await runOne(points, {
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
              }, spyPoints, realData);
              if (r) allResults.push(r);
              phase2Done++;
              if (phase2Done % 25 === 0 || phase2Done === phase2Total) {
                send({ type: "progress", stage: "phase2", message: "Phase 2: fine-tuning top 10 with toggles + min yield", done: phase2Done, total: phase2Total });
                await new Promise((resolve) => setTimeout(resolve, 0));
              }
            }
          }
        }

        // Sort all results by composite score, take top 20
        for (const r of allResults) {
          r.compositeScore = computeCompositeScore(r, riskTolerance, goal);
        }
        allResults.sort((a, b) => b.compositeScore - a.compositeScore);
        const top20 = allResults.slice(0, 20);

        send({
          type: "result",
          symbol,
          range,
          totalCombinations: allResults.length,
          phase1Combinations: phase1Results.length,
          phase2Combinations: allResults.length - phase1Results.length,
          topResults: top20,
          buyHoldReturn: top20[0]?.buyHoldReturn ?? 0,
          realDataUsed: (top20[0]?.realDataCycles ?? 0) > 0,
          modelCaveat: realData && (top20[0]?.realDataCycles ?? 0) > 0
            ? `Option premiums use real historical bid/ask from ThetaData where available. The optimizer fetched ${fetchedDatesCount} trading days across the sweep grid, so each combination blends real quotes with Black-Scholes fallback (see the Real column). Rankings compare strategies under the same data, not absolute predictions. Run a single backtest for full per-cycle real data.`
            : realData
              ? "ThetaData terminal is configured but no real data was returned for the sampled dates. All combinations use Black-Scholes model. Check that the terminal is running and the range is within your subscription tier."
              : "Option premiums are modeled with Black-Scholes using trailing 30-day realized volatility, not historical option quotes. Rankings are comparative within the same model, not absolute predictions. Past performance does not guarantee future results.",
        });
      } catch (e) {
        send({ type: "error", error: (e as Error).message });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
