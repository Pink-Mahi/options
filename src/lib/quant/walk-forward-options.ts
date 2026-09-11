/**
 * Walk-forward out-of-sample validation for option strategy parameters.
 *
 * The existing `walk-forward.ts` validates long/flat signal weights. This
 * module validates wheel/CSP/CC *strategy parameters* (delta, DTE, buyback,
 * toggles) using the same sequential train/test methodology:
 *
 *   1. Split the price history into K sequential folds (never shuffled).
 *   2. For each candidate parameter set, run the backtest on each fold's
 *      TRAIN segment and TEST segment separately.
 *   3. The TRAIN score represents in-sample (IS) performance.
 *   4. The TEST score represents out-of-sample (OOS) performance.
 *   5. The IS/OOS gap reveals overfitting: a strategy that looks great in-sample
 *      but collapses out-of-sample is not robust.
 *
 * This is cheaper than a full walk-forward optimization (which would re-run
 * the entire parameter sweep on each fold's train segment). Instead, we take
 * the top N candidates from the main optimizer sweep and validate each one
 * across folds. This costs N × K × 2 backtests instead of N × K × (full sweep).
 *
 * Parameter stability scoring evaluates neighboring configurations (delta
 * ±0.05, adjacent DTE, buyback ±10pp) and penalizes isolated performance
 * spikes — a robust strategy should have good neighbors.
 *
 * All functions are PURE and DETERMINISTIC.
 */

import type { HistoricalPricePoint } from "@/lib/types";
import {
  runBacktest,
  type BacktestConfig,
  type BacktestResult,
  type BacktestStrategy,
} from "@/lib/calculations/backtester";
import { maxDrawdown, sharpe } from "./statistics";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A candidate parameter set to validate. */
export interface OptionCandidate {
  strategy: BacktestStrategy;
  deltaTarget: number;
  dteTarget: number;
  buyBackPct: number;
}

/** Per-fold IS/OOS result for one candidate. */
export interface FoldResult {
  fold: number;
  trainRange: { startDate: string; endDate: string; bars: number };
  testRange: { startDate: string; endDate: string; bars: number };
  trainReturn: number;
  trainSharpe: number | null;
  trainMaxDrawdown: number;
  testReturn: number;
  testSharpe: number | null;
  testMaxDrawdown: number;
  testCycles: number;
}

/** Walk-forward validation result for one candidate. */
export interface WalkForwardOptionResult {
  candidate: OptionCandidate;
  folds: FoldResult[];
  /** Average in-sample return across folds. */
  meanTrainReturn: number;
  /** Average out-of-sample return across folds. */
  meanTestReturn: number;
  /** Average in-sample Sharpe across folds. */
  meanTrainSharpe: number | null;
  /** Average out-of-sample Sharpe across folds. */
  meanTestSharpe: number | null;
  /** Average out-of-sample max drawdown across folds. */
  meanTestMaxDrawdown: number;
  /** meanTrainReturn - meanTestReturn. Large positive = overfitting. */
  isOosGap: number;
  /** Fraction of folds where OOS return > 0. */
  oosConsistency: number;
  /** Annualized OOS return (compounded). */
  oosAnnualizedReturn: number;
  /** Stability score (0–1). 1 = very stable neighbors, 0 = isolated spike. */
  stabilityScore: number;
  /** Composite robustness score: OOS performance × stability. */
  robustnessScore: number;
  warnings: string[];
}

export interface WalkForwardOptionConfig {
  /** Number of sequential folds. */
  folds: number;
  /** Fraction of each fold used for training. */
  trainFraction: number;
}

export const DEFAULT_WF_OPTION_CONFIG: WalkForwardOptionConfig = {
  folds: 4,
  trainFraction: 0.7,
};

// ---------------------------------------------------------------------------
// Walk-forward validation
// ---------------------------------------------------------------------------

/**
 * Run walk-forward validation for a single candidate across K folds.
 *
 * @param prices - full daily price history
 * @param candidate - the parameter set to validate
 * @param baseConfig - base backtest config (symbol, capital, etc.)
 * @param wfConfig - fold layout
 * @param realData - optional real option data
 * @param getDailyRows - optional daily rows for GTC touch
 * @param benchmarkPrices - optional benchmark for market context
 */
export async function validateCandidateWalkForward(
  prices: HistoricalPricePoint[],
  candidate: OptionCandidate,
  baseConfig: Omit<BacktestConfig, "strategy" | "deltaTarget" | "dteTarget" | "buyBackPct">,
  wfConfig: WalkForwardOptionConfig = DEFAULT_WF_OPTION_CONFIG,
  realData?: Map<string, unknown>,
  getDailyRows?: BacktestConfig["getDailyRows"],
  benchmarkPrices?: HistoricalPricePoint[],
): Promise<WalkForwardOptionResult> {
  const warnings: string[] = [];
  const folds: FoldResult[] = [];

  // Need at least 60 bars per fold to produce meaningful option cycles
  const minBarsPerFold = 60;
  const totalBars = prices.length;
  const foldSize = Math.floor(totalBars / wfConfig.folds);

  if (foldSize < minBarsPerFold) {
    warnings.push(`Insufficient data for ${wfConfig.folds} folds (${totalBars} bars, need ≥${minBarsPerFold * wfConfig.folds}).`);
    return {
      candidate,
      folds: [],
      meanTrainReturn: 0,
      meanTestReturn: 0,
      meanTrainSharpe: null,
      meanTestSharpe: null,
      meanTestMaxDrawdown: 0,
      isOosGap: 0,
      oosConsistency: 0,
      oosAnnualizedReturn: 0,
      stabilityScore: 0,
      robustnessScore: 0,
      warnings,
    };
  }

  const trainBars = Math.floor(foldSize * wfConfig.trainFraction);
  const testBars = foldSize - trainBars;

  const config: BacktestConfig = {
    ...baseConfig,
    strategy: candidate.strategy,
    deltaTarget: candidate.deltaTarget,
    dteTarget: candidate.dteTarget,
    buyBackPct: candidate.buyBackPct > 0 ? candidate.buyBackPct / 100 : undefined,
  };

  for (let f = 0; f < wfConfig.folds; f++) {
    const foldStart = f * foldSize;
    const trainStart = foldStart;
    const trainEnd = trainStart + trainBars;
    const testStart = trainEnd;
    const testEnd = Math.min(testStart + testBars, totalBars);

    if (testEnd - testStart < 30) {
      warnings.push(`Fold ${f + 1} test segment too short, skipping.`);
      continue;
    }

    const trainPrices = prices.slice(trainStart, trainEnd);
    const testPrices = prices.slice(testStart, testEnd);

    // Run backtest on train segment
    const trainResult = await runBacktest(trainPrices, config, benchmarkPrices);
    // Run backtest on test segment
    const testResult = await runBacktest(testPrices, config, benchmarkPrices);

    folds.push({
      fold: f + 1,
      trainRange: {
        startDate: trainPrices[0]?.date ?? "",
        endDate: trainPrices[trainPrices.length - 1]?.date ?? "",
        bars: trainPrices.length,
      },
      testRange: {
        startDate: testPrices[0]?.date ?? "",
        endDate: testPrices[testPrices.length - 1]?.date ?? "",
        bars: testPrices.length,
      },
      trainReturn: trainResult.strategyReturn,
      trainSharpe: trainResult.sharpeRatio,
      trainMaxDrawdown: trainResult.maxDrawdown,
      testReturn: testResult.strategyReturn,
      testSharpe: testResult.sharpeRatio,
      testMaxDrawdown: testResult.maxDrawdown,
      testCycles: testResult.totalCycles,
    });
  }

  // Aggregate
  const meanTrainReturn = folds.length > 0
    ? folds.reduce((s, f) => s + f.trainReturn, 0) / folds.length
    : 0;
  const meanTestReturn = folds.length > 0
    ? folds.reduce((s, f) => s + f.testReturn, 0) / folds.length
    : 0;

  const trainSharpes = folds.map((f) => f.trainSharpe).filter((s): s is number => s != null);
  const testSharpes = folds.map((f) => f.testSharpe).filter((s): s is number => s != null);
  const meanTrainSharpe = trainSharpes.length > 0
    ? trainSharpes.reduce((s, v) => s + v, 0) / trainSharpes.length
    : null;
  const meanTestSharpe = testSharpes.length > 0
    ? testSharpes.reduce((s, v) => s + v, 0) / testSharpes.length
    : null;

  const meanTestMaxDrawdown = folds.length > 0
    ? folds.reduce((s, f) => s + Math.abs(f.testMaxDrawdown), 0) / folds.length
    : 0;

  const isOosGap = meanTrainReturn - meanTestReturn;
  const positiveFolds = folds.filter((f) => f.testReturn > 0).length;
  const oosConsistency = folds.length > 0 ? positiveFolds / folds.length : 0;

  // Annualize OOS return: compound the average fold return over folds per year
  const barsPerYear = 252;
  const foldsPerYear = barsPerYear / foldSize;
  const oosAnnualizedReturn = foldsPerYear > 0
    ? Math.pow(1 + meanTestReturn, foldsPerYear) - 1
    : meanTestReturn;

  return {
    candidate,
    folds,
    meanTrainReturn,
    meanTestReturn,
    meanTrainSharpe,
    meanTestSharpe,
    meanTestMaxDrawdown,
    isOosGap,
    oosConsistency,
    oosAnnualizedReturn,
    stabilityScore: 0, // computed by computeStabilityScore
    robustnessScore: 0, // computed by computeStabilityScore
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Parameter stability scoring
// ---------------------------------------------------------------------------

/** DTE values adjacent to a given DTE in the optimizer grid. */
const DTE_GRID = [7, 14, 21, 30, 45, 60, 90, 120, 180];

/**
 * Generate neighboring parameter configurations for stability analysis.
 * A robust strategy should have good-performing neighbors — an isolated spike
 * is likely overfit.
 */
export function generateNeighbors(candidate: OptionCandidate): OptionCandidate[] {
  const neighbors: OptionCandidate[] = [];

  // Delta ± 0.05
  for (const delta of [candidate.deltaTarget - 0.05, candidate.deltaTarget + 0.05]) {
    if (delta >= 0.10 && delta <= 0.45) {
      neighbors.push({ ...candidate, deltaTarget: Math.round(delta * 100) / 100 });
    }
  }

  // Adjacent DTE values
  const dteIdx = DTE_GRID.indexOf(candidate.dteTarget);
  if (dteIdx > 0) {
    neighbors.push({ ...candidate, dteTarget: DTE_GRID[dteIdx - 1]! });
  }
  if (dteIdx >= 0 && dteIdx < DTE_GRID.length - 1) {
    neighbors.push({ ...candidate, dteTarget: DTE_GRID[dteIdx + 1]! });
  }

  // Buyback ± 10pp
  for (const bb of [candidate.buyBackPct - 10, candidate.buyBackPct + 10]) {
    if (bb >= 0 && bb <= 100) {
      neighbors.push({ ...candidate, buyBackPct: bb });
    }
  }

  return neighbors;
}

/**
 * Compute a stability score for a candidate based on its neighbors' performance.
 *
 * The score is the fraction of neighbors whose annualized return is within
 * 50% of the candidate's return. A score of 1.0 means all neighbors are
 * nearly as good; a score of 0.0 means the candidate is an isolated spike.
 *
 * @param candidateReturn - the candidate's annualized return
 * @param neighborReturns - annualized returns of the neighboring configs
 */
export function computeStabilityScore(
  candidateReturn: number,
  neighborReturns: number[],
): number {
  if (neighborReturns.length === 0) return 0.5; // no neighbors → neutral

  // Threshold: neighbors within 50% of the candidate's return (or better)
  const threshold = candidateReturn * 0.5;
  const goodNeighbors = neighborReturns.filter((r) => r >= threshold).length;
  return goodNeighbors / neighborReturns.length;
}

/**
 * Compute the robustness score: OOS performance × stability.
 *
 * A strategy with great OOS return but low stability is risky (isolated spike).
 * A strategy with decent OOS return and high stability is trustworthy (plateau).
 */
export function computeRobustnessScore(
  oosReturn: number,
  stabilityScore: number,
  oosConsistency: number,
): number {
  // Normalize OOS return to [0, 1] range (clip at 50% annualized)
  const normalizedReturn = Math.max(0, Math.min(1, oosReturn / 0.5));
  // Weight: 50% OOS return, 30% stability, 20% consistency
  return normalizedReturn * 0.5 + stabilityScore * 0.3 + oosConsistency * 0.2;
}

// ---------------------------------------------------------------------------
// Full validation pipeline
// ---------------------------------------------------------------------------

/**
 * Run walk-forward validation + stability scoring for multiple candidates.
 * Only the top candidates from the main optimizer sweep should be passed here
 * to keep the cost bounded.
 */
export async function validateTopCandidates(
  prices: HistoricalPricePoint[],
  candidates: OptionCandidate[],
  baseConfig: Omit<BacktestConfig, "strategy" | "deltaTarget" | "dteTarget" | "buyBackPct">,
  wfConfig: WalkForwardOptionConfig = DEFAULT_WF_OPTION_CONFIG,
  benchmarkPrices?: HistoricalPricePoint[],
): Promise<WalkForwardOptionResult[]> {
  const results: WalkForwardOptionResult[] = [];

  for (const candidate of candidates) {
    // 1. Walk-forward validation
    const wfResult = await validateCandidateWalkForward(
      prices, candidate, baseConfig, wfConfig, undefined, undefined, benchmarkPrices,
    );

    // 2. Stability scoring: evaluate neighbors on the full history
    const neighbors = generateNeighbors(candidate);
    const neighborReturns: number[] = [];
    for (const neighbor of neighbors) {
      try {
        const neighborConfig: BacktestConfig = {
          ...baseConfig,
          strategy: neighbor.strategy,
          deltaTarget: neighbor.deltaTarget,
          dteTarget: neighbor.dteTarget,
          buyBackPct: neighbor.buyBackPct > 0 ? neighbor.buyBackPct / 100 : undefined,
        };
        const neighborResult = await runBacktest(prices, neighborConfig, benchmarkPrices);
        neighborReturns.push(neighborResult.strategyAnnualizedReturn);
      } catch {
        // Skip failed neighbor evaluations
      }
    }

    // 3. Get the candidate's own annualized return for stability comparison
    let candidateReturn = wfResult.oosAnnualizedReturn;
    if (neighborReturns.length > 0 && candidateReturn === 0) {
      // Fallback: use full-history return if OOS is zero
      try {
        const candidateConfig: BacktestConfig = {
          ...baseConfig,
          strategy: candidate.strategy,
          deltaTarget: candidate.deltaTarget,
          dteTarget: candidate.dteTarget,
          buyBackPct: candidate.buyBackPct > 0 ? candidate.buyBackPct / 100 : undefined,
        };
        const fullResult = await runBacktest(prices, candidateConfig, benchmarkPrices);
        candidateReturn = fullResult.strategyAnnualizedReturn;
      } catch {
        // Use OOS return as-is
      }
    }

    const stabilityScore = computeStabilityScore(candidateReturn, neighborReturns);
    const robustnessScore = computeRobustnessScore(
      wfResult.oosAnnualizedReturn, stabilityScore, wfResult.oosConsistency,
    );

    results.push({
      ...wfResult,
      stabilityScore,
      robustnessScore,
    });
  }

  // Sort by robustness score (best first)
  results.sort((a, b) => b.robustnessScore - a.robustnessScore);
  return results;
}
