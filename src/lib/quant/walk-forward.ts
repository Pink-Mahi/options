/**
 * Walk-forward out-of-sample signal validation.
 *
 * This is the module that makes the difference between quant research and curve
 * fitting. The procedure:
 *
 *   1. Split the history into sequential folds (never shuffled - time matters).
 *   2. On each fold's TRAIN segment, evaluate every candidate weight vector.
 *   3. Select the best candidate using TRAIN data only.
 *   4. Apply that frozen candidate to the TEST segment and record those returns.
 *   5. Concatenate all TEST segments. That stitched series is the honest
 *      out-of-sample track record.
 *   6. Deflate the resulting Sharpe by the number of candidates searched.
 *
 * In-sample results are reported too, but only so the IS-to-OOS degradation is
 * visible. A strategy that looks great in-sample and collapses out-of-sample is
 * overfit, and that gap is the diagnostic.
 *
 * Signal convention: long/flat. The model decides at the close of bar i and
 * earns the return from bar i to i+1, so no future information is used.
 *
 * All functions are PURE and DETERMINISTIC. Unit-tested in ./walk-forward.test.ts.
 */

import type { HistoricalPricePoint } from "@/lib/types";
import { extractFeatureSeries, type FeatureVector } from "./features";
import { deflatedSharpeRatio, maxDrawdown, sharpe, sortino, type DeflatedSharpeResult } from "./statistics";

/** Factors the signal can weight. Kept small and interpretable on purpose. */
export type FactorName =
  | "momentum3m"
  | "momentum12m"
  | "trend200"
  | "meanReversion"
  | "lowVol";

export const FACTOR_NAMES: FactorName[] = [
  "momentum3m",
  "momentum12m",
  "trend200",
  "meanReversion",
  "lowVol",
];

export type FactorWeights = Record<FactorName, number>;

export interface WalkForwardConfig {
  /** Number of sequential train/test folds. */
  folds: number;
  /** Fraction of each fold used for training; the remainder is the test segment. */
  trainFraction: number;
  /** Score above which the model goes long. */
  signalThreshold: number;
  /** Round-trip transaction cost in basis points, charged whenever position changes. */
  costBps: number;
  /** Candidate weight values swept per factor. */
  weightGrid: number[];
}

export const DEFAULT_WALK_FORWARD_CONFIG: WalkForwardConfig = {
  folds: 4,
  trainFraction: 0.7,
  signalThreshold: 0.1,
  costBps: 10,
  weightGrid: [0, 0.5, 1],
};

export interface FoldResult {
  fold: number;
  trainRange: { startDate: string; endDate: string; bars: number };
  testRange: { startDate: string; endDate: string; bars: number };
  selectedWeights: FactorWeights;
  trainSharpe: number | null;
  testSharpe: number | null;
  testReturn: number;
  testTrades: number;
  timeInMarket: number;
}

export interface WalkForwardResult {
  symbol: string;
  folds: FoldResult[];
  /** Number of distinct candidate weight vectors evaluated per fold. */
  candidatesPerFold: number;
  /** Total candidate evaluations across all folds - the multiple-testing count. */
  totalTrials: number;

  /** Stitched out-of-sample per-bar returns. The honest track record. */
  oosReturns: number[];
  oosEquityCurve: { date: string; equity: number; buyHoldEquity: number }[];

  oosSharpe: number | null;
  oosSortino: number | null;
  oosTotalReturn: number;
  oosMaxDrawdown: number;
  oosHitRate: number;
  oosTimeInMarket: number;
  totalTrades: number;

  /** Average in-sample Sharpe of the selected candidates, for degradation comparison. */
  meanTrainSharpe: number | null;
  /** meanTrainSharpe minus oosSharpe. Large positive values indicate overfitting. */
  sharpeDegradation: number | null;

  /** Overfitting-corrected assessment of the out-of-sample record. */
  deflated: DeflatedSharpeResult;

  buyHoldReturn: number;
  buyHoldSharpe: number | null;
  /** oosTotalReturn minus buyHoldReturn. */
  excessReturn: number;

  warnings: string[];
}

/**
 * Transform a raw feature vector into bounded factor scores.
 *
 * The transforms are fixed a priori (not fitted), which sidesteps a subtle
 * leakage problem: if normalization statistics were fitted on the full sample,
 * test-fold information would bleed into the training transform.
 *
 * Each score is roughly in [-1, 1]; nulls become 0 (neutral).
 */
export function toFactorScores(f: FeatureVector): FactorWeights {
  return {
    // Momentum: clip at +/-50% trailing return.
    momentum3m: clamp((f.momentum3m ?? 0) / 0.5, -1, 1),
    momentum12m: clamp((f.momentum12m ?? 0) / 0.5, -1, 1),
    // Trend: distance above the 200-day average, clipped at +/-25%.
    trend200: clamp((f.priceVsSma200 ?? 0) / 0.25, -1, 1),
    // Mean reversion: stretched-down conditions score positive, so invert.
    meanReversion: clamp(-(f.zScore20 ?? 0) / 2, -1, 1) || 0,
    // Low vol: contracting volatility scores positive.
    lowVol: clamp(1 - (f.volRatio ?? 1), -1, 1),
  };
}

/** Dot product of factor scores and weights. */
export function scoreSignal(scores: FactorWeights, weights: FactorWeights): number {
  let total = 0;
  let weightSum = 0;
  for (const name of FACTOR_NAMES) {
    total += scores[name] * weights[name];
    weightSum += Math.abs(weights[name]);
  }
  // Normalize so the threshold means the same thing regardless of weight scale.
  return weightSum > 0 ? total / weightSum : 0;
}

/** Every non-degenerate weight combination over the grid. */
export function buildCandidates(weightGrid: number[]): FactorWeights[] {
  const candidates: FactorWeights[] = [];

  const recurse = (idx: number, current: Partial<FactorWeights>) => {
    if (idx === FACTOR_NAMES.length) {
      const w = current as FactorWeights;
      // Skip the all-zero vector: it never takes a position.
      if (FACTOR_NAMES.some((n) => w[n] !== 0)) {
        candidates.push({ ...w });
      }
      return;
    }
    const name = FACTOR_NAMES[idx]!;
    for (const v of weightGrid) {
      current[name] = v;
      recurse(idx + 1, current);
    }
  };

  recurse(0, {});
  return candidates;
}

interface SegmentPerformance {
  returns: number[];
  trades: number;
  barsLong: number;
}

/**
 * Simulate long/flat trading over a contiguous slice of feature vectors.
 *
 * `nextBarReturn(i)` supplies the return earned by holding from the bar at
 * feature index i to the following bar. Costs are charged on position changes.
 */
function simulate(
  features: FeatureVector[],
  weights: FactorWeights,
  threshold: number,
  costBps: number,
  nextBarReturn: (featureIndex: number) => number | null,
): SegmentPerformance {
  const returns: number[] = [];
  let trades = 0;
  let barsLong = 0;
  let prevPosition = 0;

  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    if (!f) continue;
    const fwd = nextBarReturn(i);
    if (fwd == null) continue;

    const score = scoreSignal(toFactorScores(f), weights);
    const position = score > threshold ? 1 : 0;

    let r = position * fwd;
    if (position !== prevPosition) {
      trades++;
      r -= costBps / 10_000;
    }
    if (position === 1) barsLong++;

    returns.push(r);
    prevPosition = position;
  }

  return { returns, trades, barsLong };
}

/**
 * Run walk-forward validation for one symbol.
 *
 * @param prices - daily history, oldest first
 * @param symbol - label only
 * @param config - fold layout, threshold, costs, and the candidate grid
 */
export function runWalkForward(
  prices: HistoricalPricePoint[],
  symbol: string,
  config: WalkForwardConfig = DEFAULT_WALK_FORWARD_CONFIG,
): WalkForwardResult {
  const warnings: string[] = [];
  const features = extractFeatureSeries(prices);

  const candidates = buildCandidates(config.weightGrid);

  // Return earned from the bar at features[i] to the following bar.
  const nextBarReturn = (featureIndex: number, pool: FeatureVector[]): number | null => {
    const f = pool[featureIndex];
    if (!f) return null;
    const from = prices[f.index];
    const to = prices[f.index + 1];
    if (!from || !to || from.adjustedClose <= 0) return null;
    return to.adjustedClose / from.adjustedClose - 1;
  };

  const emptyResult = (reason: string): WalkForwardResult => {
    warnings.push(reason);
    return {
      symbol,
      folds: [],
      candidatesPerFold: candidates.length,
      totalTrials: 0,
      oosReturns: [],
      oosEquityCurve: [],
      oosSharpe: null,
      oosSortino: null,
      oosTotalReturn: 0,
      oosMaxDrawdown: 0,
      oosHitRate: 0,
      oosTimeInMarket: 0,
      totalTrades: 0,
      meanTrainSharpe: null,
      sharpeDegradation: null,
      deflated: deflatedSharpeRatio([], [], 252),
      buyHoldReturn: 0,
      buyHoldSharpe: null,
      excessReturn: 0,
      warnings,
    };
  };

  // Need enough scoreable bars to split into folds with meaningful test segments.
  const minPerFold = 40;
  if (features.length < config.folds * minPerFold) {
    return emptyResult(
      `Only ${features.length} scoreable bars are available after the 252-bar feature warm-up, but ${config.folds} folds need at least ${config.folds * minPerFold}. Request a longer history (5y or 10y).`,
    );
  }

  const foldSize = Math.floor(features.length / config.folds);
  const folds: FoldResult[] = [];
  const oosReturns: number[] = [];
  const oosDates: string[] = [];
  const allTrialSharpes: number[] = [];
  const trainSharpes: number[] = [];
  let totalTrades = 0;
  let totalBarsLong = 0;
  let totalOosBars = 0;

  for (let k = 0; k < config.folds; k++) {
    const foldStart = k * foldSize;
    const foldEnd = k === config.folds - 1 ? features.length : foldStart + foldSize;
    const trainEnd = foldStart + Math.floor((foldEnd - foldStart) * config.trainFraction);

    const trainSlice = features.slice(foldStart, trainEnd);
    const testSlice = features.slice(trainEnd, foldEnd);

    if (trainSlice.length < 20 || testSlice.length < 5) {
      warnings.push(`Fold ${k + 1} was skipped: too few bars after splitting (train ${trainSlice.length}, test ${testSlice.length}).`);
      continue;
    }

    // --- Select on TRAIN only ---------------------------------------------
    let bestWeights: FactorWeights | null = null;
    let bestSharpe = -Infinity;

    for (const cand of candidates) {
      const perf = simulate(
        trainSlice,
        cand,
        config.signalThreshold,
        config.costBps,
        (i) => nextBarReturn(i, trainSlice),
      );
      const s = sharpe(perf.returns, 252);
      // Record every trial for the multiple-testing correction.
      if (s != null) allTrialSharpes.push(s);
      if (s != null && s > bestSharpe) {
        bestSharpe = s;
        bestWeights = cand;
      }
    }

    if (!bestWeights) {
      warnings.push(`Fold ${k + 1} produced no viable candidate on the training segment.`);
      continue;
    }

    // --- Apply the frozen model to TEST ----------------------------------
    const testPerf = simulate(
      testSlice,
      bestWeights,
      config.signalThreshold,
      config.costBps,
      (i) => nextBarReturn(i, testSlice),
    );

    const testSharpe = sharpe(testPerf.returns, 252);
    const testTotal = testPerf.returns.reduce((acc, r) => acc * (1 + r), 1) - 1;

    for (let i = 0; i < testPerf.returns.length; i++) {
      oosReturns.push(testPerf.returns[i]!);
      oosDates.push(testSlice[i]?.date ?? "");
    }

    totalTrades += testPerf.trades;
    totalBarsLong += testPerf.barsLong;
    totalOosBars += testPerf.returns.length;
    if (bestSharpe !== -Infinity) trainSharpes.push(bestSharpe);

    folds.push({
      fold: k + 1,
      trainRange: {
        startDate: trainSlice[0]?.date ?? "",
        endDate: trainSlice[trainSlice.length - 1]?.date ?? "",
        bars: trainSlice.length,
      },
      testRange: {
        startDate: testSlice[0]?.date ?? "",
        endDate: testSlice[testSlice.length - 1]?.date ?? "",
        bars: testSlice.length,
      },
      selectedWeights: bestWeights,
      trainSharpe: bestSharpe === -Infinity ? null : bestSharpe,
      testSharpe,
      testReturn: testTotal,
      testTrades: testPerf.trades,
      timeInMarket: testPerf.returns.length > 0 ? testPerf.barsLong / testPerf.returns.length : 0,
    });
  }

  if (oosReturns.length === 0) {
    return emptyResult("No out-of-sample returns were produced, so there is nothing to evaluate.");
  }

  // --- Aggregate out-of-sample performance --------------------------------
  const oosSharpe = sharpe(oosReturns, 252);
  const oosSortino = sortino(oosReturns, 252);
  const oosTotalReturn = oosReturns.reduce((acc, r) => acc * (1 + r), 1) - 1;
  const wins = oosReturns.filter((r) => r > 0).length;
  const nonZero = oosReturns.filter((r) => r !== 0).length;

  // Buy-and-hold over the same out-of-sample dates.
  const oosDateSet = new Set(oosDates.filter(Boolean));
  const buyHoldReturns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const curr = prices[i];
    const prev = prices[i - 1];
    if (!curr || !prev || prev.adjustedClose <= 0) continue;
    if (oosDateSet.has(curr.date)) {
      buyHoldReturns.push(curr.adjustedClose / prev.adjustedClose - 1);
    }
  }
  const buyHoldReturn = buyHoldReturns.reduce((acc, r) => acc * (1 + r), 1) - 1;
  const buyHoldSharpe = sharpe(buyHoldReturns, 252);

  // Equity curves for charting.
  const oosEquityCurve: WalkForwardResult["oosEquityCurve"] = [];
  let equity = 1;
  let bhEquity = 1;
  for (let i = 0; i < oosReturns.length; i++) {
    equity *= 1 + oosReturns[i]!;
    bhEquity *= 1 + (buyHoldReturns[i] ?? 0);
    oosEquityCurve.push({
      date: oosDates[i] ?? "",
      equity: equity * 100,
      buyHoldEquity: bhEquity * 100,
    });
  }

  const meanTrainSharpe =
    trainSharpes.length > 0 ? trainSharpes.reduce((s, v) => s + v, 0) / trainSharpes.length : null;

  const deflated = deflatedSharpeRatio(oosReturns, allTrialSharpes, 252);

  const sharpeDegradation =
    meanTrainSharpe != null && oosSharpe != null ? meanTrainSharpe - oosSharpe : null;

  // --- Honest warnings ----------------------------------------------------
  if (sharpeDegradation != null && sharpeDegradation > 1) {
    warnings.push(
      `In-sample Sharpe averaged ${meanTrainSharpe!.toFixed(2)} but out-of-sample came in at ${oosSharpe!.toFixed(2)}. A gap this large is the classic signature of overfitting: the weights fit noise in the training window that did not persist.`,
    );
  }
  if (oosSharpe != null && buyHoldSharpe != null && oosSharpe < buyHoldSharpe) {
    warnings.push(
      `Out-of-sample Sharpe (${oosSharpe.toFixed(2)}) is below simply holding the stock (${buyHoldSharpe.toFixed(2)}). The signal is not adding risk-adjusted value over buy-and-hold on this history.`,
    );
  }
  if (totalOosBars < 100) {
    warnings.push(
      `Only ${totalOosBars} out-of-sample bars. That is too few to draw firm conclusions; treat every statistic here as provisional.`,
    );
  }
  if (config.costBps === 0) {
    warnings.push("Transaction costs were set to zero, which flatters any strategy that trades frequently.");
  }

  return {
    symbol,
    folds,
    candidatesPerFold: candidates.length,
    totalTrials: candidates.length * folds.length,
    oosReturns,
    oosEquityCurve,
    oosSharpe,
    oosSortino,
    oosTotalReturn,
    oosMaxDrawdown: maxDrawdown(oosEquityCurve.map((p) => p.equity)),
    oosHitRate: nonZero > 0 ? wins / nonZero : 0,
    oosTimeInMarket: totalOosBars > 0 ? totalBarsLong / totalOosBars : 0,
    totalTrades,
    meanTrainSharpe,
    sharpeDegradation,
    deflated,
    buyHoldReturn,
    buyHoldSharpe,
    excessReturn: oosTotalReturn - buyHoldReturn,
    warnings,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(hi, Math.max(lo, v));
}
