import { describe, it, expect } from "vitest";
import {
  classifyMove,
  computeBrierScore,
  scorePrediction,
  computeScorecard,
  type PredictionRecord,
} from "./prediction-score";

describe("classifyMove", () => {
  it("classifies positive move as bullish", () => {
    expect(classifyMove(0.05)).toBe("bullish");
  });

  it("classifies negative move as bearish", () => {
    expect(classifyMove(-0.05)).toBe("bearish");
  });

  it("classifies tiny move as neutral", () => {
    expect(classifyMove(0.001)).toBe("neutral");
    expect(classifyMove(-0.001)).toBe("neutral");
  });
});

describe("computeBrierScore", () => {
  it("returns 0 for perfect bullish prediction", () => {
    expect(computeBrierScore("bullish", 1.0, "bullish")).toBe(0);
  });

  it("returns 1 for completely wrong bullish prediction", () => {
    expect(computeBrierScore("bullish", 1.0, "bearish")).toBe(1);
  });

  it("returns 0.25 for 50/50 neutral prediction", () => {
    // Neutral with 0.5 confidence, actual bearish
    // predictedProbBullish = 0.5, actualBullish = 0
    // Brier = (0.5 - 0)^2 = 0.25
    expect(computeBrierScore("neutral", 0.5, "bearish")).toBe(0.25);
  });
});

describe("scorePrediction", () => {
  const basePrediction: PredictionRecord = {
    symbol: "AAPL",
    predictionDate: "2025-01-01",
    targetDate: "2025-02-01",
    horizonDays: 30,
    direction: "bullish",
    confidence: 0.7,
    expectedMove: 0.05,
    source: "ai_pattern",
  };

  it("scores a correct bullish prediction", () => {
    const result = scorePrediction(basePrediction, 0.08);
    expect(result.actualDirection).toBe("bullish");
    expect(result.hit).toBe(true);
    expect(result.brierScore).toBeCloseTo(0.09, 2); // (0.7-1)^2 = 0.09
  });

  it("scores an incorrect bullish prediction", () => {
    const result = scorePrediction(basePrediction, -0.03);
    expect(result.actualDirection).toBe("bearish");
    expect(result.hit).toBe(false);
    expect(result.brierScore).toBeCloseTo(0.49, 2); // (0.7-0)^2 = 0.49
  });
});

describe("computeScorecard", () => {
  it("handles empty scored list", () => {
    const result = computeScorecard([], 5);
    expect(result.scoredCount).toBe(0);
    expect(result.pendingCount).toBe(5);
    expect(result.hitRate).toBe(0);
  });

  it("computes aggregate metrics", () => {
    const predictions: ReturnType<typeof scorePrediction>[] = [
      { symbol: "AAPL", predictionDate: "2025-01-01", targetDate: "2025-02-01", horizonDays: 30, direction: "bullish", confidence: 0.7, expectedMove: 0.05, source: "ai_pattern", actualMove: 0.08, actualDirection: "bullish", hit: true, brierScore: 0.09 },
      { symbol: "AAPL", predictionDate: "2025-02-01", targetDate: "2025-03-01", horizonDays: 30, direction: "bullish", confidence: 0.6, expectedMove: 0.04, source: "ai_pattern", actualMove: -0.02, actualDirection: "bearish", hit: false, brierScore: 0.36 },
      { symbol: "MSFT", predictionDate: "2025-01-01", targetDate: "2025-02-01", horizonDays: 30, direction: "bearish", confidence: 0.65, expectedMove: -0.03, source: "technical", actualMove: -0.05, actualDirection: "bearish", hit: true, brierScore: 0.1225 },
    ];

    const result = computeScorecard(predictions, 2);
    expect(result.scoredCount).toBe(3);
    expect(result.totalPredictions).toBe(5);
    expect(result.hitRate).toBeCloseTo(2 / 3, 2);
    expect(result.bullishHitRate).toBe(0.5);
    expect(result.bearishHitRate).toBe(1);
    expect(result.bySymbol.length).toBe(2);
    expect(result.bySource.length).toBe(2);
    expect(result.byHorizon.length).toBe(1);
  });

  it("computes calibration score", () => {
    const predictions: ReturnType<typeof scorePrediction>[] = [
      { symbol: "T", predictionDate: "2025-01-01", targetDate: "2025-02-01", horizonDays: 30, direction: "bullish", confidence: 0.8, expectedMove: 0.05, source: "ai", actualMove: 0.08, actualDirection: "bullish", hit: true, brierScore: 0.04 },
      { symbol: "T", predictionDate: "2025-01-15", targetDate: "2025-02-15", horizonDays: 30, direction: "bullish", confidence: 0.8, expectedMove: 0.05, source: "ai", actualMove: -0.02, actualDirection: "bearish", hit: false, brierScore: 0.64 },
    ];

    const result = computeScorecard(predictions);
    // avgConfidence = 0.8, hitRate = 0.5, calibration = |0.8 - 0.5| = 0.3
    expect(result.avgConfidence).toBe(0.8);
    expect(result.hitRate).toBe(0.5);
    expect(result.calibrationScore).toBeCloseTo(0.3, 2);
  });
});
