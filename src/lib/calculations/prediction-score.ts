/**
 * Prediction scoring engine — records predictions and scores them against
 * actual market outcomes.
 *
 * Scoring metrics:
 * - Hit rate: fraction of predictions where direction matched actual
 * - Brier score: mean squared error of probabilistic forecasts (lower = better)
 * - Calibration: how well confidence matches actual frequency
 *
 * All functions are PURE and DETERMINISTIC. Unit-tested in ./prediction-score.test.ts.
 */

export type PredictionDirection = "bullish" | "bearish" | "neutral";

export interface PredictionRecord {
  symbol: string;
  predictionDate: string; // ISO
  targetDate: string; // ISO
  horizonDays: number;
  direction: PredictionDirection;
  confidence: number; // 0-1
  expectedMove: number | null; // fractional expected move
  source: string;
  metadata?: Record<string, unknown>;
}

export interface ScoredPrediction extends PredictionRecord {
  actualMove: number; // fractional actual move
  actualDirection: PredictionDirection;
  hit: boolean;
  brierScore: number;
}

export interface ScorecardResult {
  totalPredictions: number;
  scoredCount: number;
  pendingCount: number;
  hitRate: number;
  brierScore: number;
  bullishHitRate: number;
  bearishHitRate: number;
  neutralHitRate: number;
  avgConfidence: number;
  calibrationScore: number; // |avgConfidence - hitRate|, lower = better
  bySymbol: { symbol: string; count: number; hitRate: number; brierScore: number }[];
  bySource: { source: string; count: number; hitRate: number; brierScore: number }[];
  byHorizon: { horizonDays: number; count: number; hitRate: number; brierScore: number }[];
  recentScores: ScoredPrediction[];
}

/**
 * Classify an actual price move into a direction.
 * Uses a small threshold to avoid labeling tiny moves as bullish/bearish.
 */
export function classifyMove(
  actualMove: number,
  threshold: number = 0.005,
): PredictionDirection {
  if (actualMove > threshold) return "bullish";
  if (actualMove < -threshold) return "bearish";
  return "neutral";
}

/**
 * Compute Brier score for a single prediction.
 * Brier = (predictedProbability - actualOutcome)^2
 * For direction: convert to probability of "bullish" and outcome as 1/0.
 */
export function computeBrierScore(
  direction: PredictionDirection,
  confidence: number,
  actualDirection: PredictionDirection,
): number {
  // Convert to probability of bullish outcome
  let predictedProbBullish: number;
  if (direction === "bullish") predictedProbBullish = confidence;
  else if (direction === "bearish") predictedProbBullish = 1 - confidence;
  else predictedProbBullish = 0.5; // neutral = uncertain

  const actualBullish = actualDirection === "bullish" ? 1 : 0;
  return Math.pow(predictedProbBullish - actualBullish, 2);
}

/**
 * Score a single prediction against the actual market move.
 */
export function scorePrediction(
  prediction: PredictionRecord,
  actualMove: number,
  threshold: number = 0.005,
): ScoredPrediction {
  const actualDirection = classifyMove(actualMove, threshold);
  const hit = prediction.direction === actualDirection;
  const brierScore = computeBrierScore(prediction.direction, prediction.confidence, actualDirection);

  return {
    ...prediction,
    actualMove,
    actualDirection,
    hit,
    brierScore,
  };
}

/**
 * Compute aggregate scorecard from a set of scored predictions.
 */
export function computeScorecard(
  scored: ScoredPrediction[],
  pendingCount: number = 0,
): ScorecardResult {
  const totalPredictions = scored.length + pendingCount;
  const scoredCount = scored.length;

  if (scoredCount === 0) {
    return {
      totalPredictions,
      scoredCount: 0,
      pendingCount,
      hitRate: 0,
      brierScore: 0,
      bullishHitRate: 0,
      bearishHitRate: 0,
      neutralHitRate: 0,
      avgConfidence: 0,
      calibrationScore: 0,
      bySymbol: [],
      bySource: [],
      byHorizon: [],
      recentScores: [],
    };
  }

  const hits = scored.filter((s) => s.hit).length;
  const hitRate = hits / scoredCount;
  const brierScore = scored.reduce((s, p) => s + p.brierScore, 0) / scoredCount;
  const avgConfidence = scored.reduce((s, p) => s + p.confidence, 0) / scoredCount;

  const bullish = scored.filter((s) => s.direction === "bullish");
  const bearish = scored.filter((s) => s.direction === "bearish");
  const neutral = scored.filter((s) => s.direction === "neutral");

  const bullishHitRate = bullish.length > 0 ? bullish.filter((s) => s.hit).length / bullish.length : 0;
  const bearishHitRate = bearish.length > 0 ? bearish.filter((s) => s.hit).length / bearish.length : 0;
  const neutralHitRate = neutral.length > 0 ? neutral.filter((s) => s.hit).length / neutral.length : 0;

  // Group by symbol
  const symbolMap = new Map<string, ScoredPrediction[]>();
  for (const s of scored) {
    const arr = symbolMap.get(s.symbol) ?? [];
    arr.push(s);
    symbolMap.set(s.symbol, arr);
  }
  const bySymbol = Array.from(symbolMap.entries()).map(([symbol, preds]) => ({
    symbol,
    count: preds.length,
    hitRate: preds.filter((s) => s.hit).length / preds.length,
    brierScore: preds.reduce((s, p) => s + p.brierScore, 0) / preds.length,
  })).sort((a, b) => b.count - a.count);

  // Group by source
  const sourceMap = new Map<string, ScoredPrediction[]>();
  for (const s of scored) {
    const arr = sourceMap.get(s.source) ?? [];
    arr.push(s);
    sourceMap.set(s.source, arr);
  }
  const bySource = Array.from(sourceMap.entries()).map(([source, preds]) => ({
    source,
    count: preds.length,
    hitRate: preds.filter((s) => s.hit).length / preds.length,
    brierScore: preds.reduce((s, p) => s + p.brierScore, 0) / preds.length,
  }));

  // Group by horizon
  const horizonMap = new Map<number, ScoredPrediction[]>();
  for (const s of scored) {
    const arr = horizonMap.get(s.horizonDays) ?? [];
    arr.push(s);
    horizonMap.set(s.horizonDays, arr);
  }
  const byHorizon = Array.from(horizonMap.entries()).map(([horizonDays, preds]) => ({
    horizonDays,
    count: preds.length,
    hitRate: preds.filter((s) => s.hit).length / preds.length,
    brierScore: preds.reduce((s, p) => s + p.brierScore, 0) / preds.length,
  })).sort((a, b) => a.horizonDays - b.horizonDays);

  const recentScores = scored.slice(-10);

  return {
    totalPredictions,
    scoredCount,
    pendingCount,
    hitRate,
    brierScore,
    bullishHitRate,
    bearishHitRate,
    neutralHitRate,
    avgConfidence,
    calibrationScore: Math.abs(avgConfidence - hitRate),
    bySymbol,
    bySource,
    byHorizon,
    recentScores,
  };
}
