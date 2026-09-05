import { describe, it, expect } from "vitest";
import {
  runWalkForward,
  buildCandidates,
  toFactorScores,
  scoreSignal,
  DEFAULT_WALK_FORWARD_CONFIG,
  FACTOR_NAMES,
  type FactorWeights,
} from "./walk-forward";
import type { HistoricalPricePoint } from "@/lib/types";

function bar(date: string, close: number, volume = 1_000_000): HistoricalPricePoint {
  return {
    date,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    adjustedClose: close,
    volume,
  };
}

function series(n: number, start = 100, drift = 0, amplitude = 0): HistoricalPricePoint[] {
  const out: HistoricalPricePoint[] = [];
  let price = start;
  for (let i = 0; i < n; i++) {
    price = price * (1 + drift) + amplitude * Math.sin(i / 5);
    const d = new Date(Date.UTC(2020, 0, 1));
    d.setUTCDate(d.getUTCDate() + i);
    out.push(bar(d.toISOString().slice(0, 10), Math.max(price, 1)));
  }
  return out;
}

describe("buildCandidates", () => {
  it("excludes the all-zero vector", () => {
    const candidates = buildCandidates([0, 1]);
    for (const c of candidates) {
      expect(FACTOR_NAMES.some((n) => c[n] !== 0)).toBe(true);
    }
  });

  it("produces grid^factors - 1 candidates", () => {
    expect(buildCandidates([0, 1]).length).toBe(Math.pow(2, FACTOR_NAMES.length) - 1);
    expect(buildCandidates([0, 0.5, 1]).length).toBe(Math.pow(3, FACTOR_NAMES.length) - 1);
  });
});

describe("toFactorScores", () => {
  it("clips momentum to [-1, 1]", () => {
    const f = {
      momentum3m: 0.9,
      momentum12m: -0.9,
      trend200: 0,
      meanReversion: 0,
      lowVol: 0,
    } as any;
    const s = toFactorScores(f);
    expect(s.momentum3m).toBe(1);
    expect(s.momentum12m).toBe(-1);
  });

  it("inverts zScore for mean reversion", () => {
    const highZ = { zScore20: 3 } as any;
    const lowZ = { zScore20: -3 } as any;
    expect(toFactorScores(highZ).meanReversion).toBeLessThan(0);
    expect(toFactorScores(lowZ).meanReversion).toBeGreaterThan(0);
  });

  it("returns 0 for null features", () => {
    const f = {
      momentum3m: null,
      momentum12m: null,
      trend200: null,
      meanReversion: null,
      lowVol: null,
    } as any;
    const s = toFactorScores(f);
    for (const n of FACTOR_NAMES) {
      expect(s[n]).toBe(0);
    }
  });
});

describe("scoreSignal", () => {
  it("is 0 when all weights are 0", () => {
    const scores: FactorWeights = { momentum3m: 1, momentum12m: 1, trend200: 1, meanReversion: 1, lowVol: 1 };
    const weights: FactorWeights = { momentum3m: 0, momentum12m: 0, trend200: 0, meanReversion: 0, lowVol: 0 };
    expect(scoreSignal(scores, weights)).toBe(0);
  });

  it("is positive when scores and weights align positively", () => {
    const scores: FactorWeights = { momentum3m: 1, momentum12m: 1, trend200: 1, meanReversion: 0, lowVol: 0 };
    const weights: FactorWeights = { momentum3m: 1, momentum12m: 1, trend200: 1, meanReversion: 0, lowVol: 0 };
    expect(scoreSignal(scores, weights)).toBeGreaterThan(0);
  });

  it("is scale-invariant (doubling weights gives the same score)", () => {
    const scores: FactorWeights = { momentum3m: 0.5, momentum12m: 0.3, trend200: 0.2, meanReversion: -0.1, lowVol: 0.1 };
    const w1: FactorWeights = { momentum3m: 1, momentum12m: 0.5, trend200: 0, meanReversion: 0, lowVol: 0 };
    const w2: FactorWeights = { momentum3m: 2, momentum12m: 1, trend200: 0, meanReversion: 0, lowVol: 0 };
    expect(scoreSignal(scores, w1)).toBeCloseTo(scoreSignal(scores, w2), 10);
  });
});

describe("runWalkForward", () => {
  it("returns a warning when history is too short", () => {
    const r = runWalkForward(series(100), "TEST");
    expect(r.folds).toHaveLength(0);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings[0]).toContain("scoreable bars");
  });

  it("produces folds with train and test segments", () => {
    const r = runWalkForward(series(1500, 100, 0.001, 0.5), "TEST");
    expect(r.folds.length).toBe(DEFAULT_WALK_FORWARD_CONFIG.folds);
    for (const f of r.folds) {
      expect(f.trainRange.bars).toBeGreaterThan(0);
      expect(f.testRange.bars).toBeGreaterThan(0);
      expect(f.selectedWeights).toBeDefined();
    }
  });

  it("stitches OOS returns across all test segments", () => {
    const r = runWalkForward(series(1500, 100, 0.001, 0.5), "TEST");
    expect(r.oosReturns.length).toBeGreaterThan(0);
    const totalTestBars = r.folds.reduce((s, f) => s + f.testRange.bars, 0);
    // The very last bar across all folds has no forward return, so OOS returns
    // are one fewer than the sum of test-range bars.
    expect(r.oosReturns.length).toBe(totalTestBars - 1);
  });

  it("reports a deflated Sharpe ratio with the trial count", () => {
    const r = runWalkForward(series(1500, 100, 0.001, 0.5), "TEST");
    expect(r.deflated.trials).toBeGreaterThan(0);
    expect(r.deflated.verdict).toBeDefined();
  });

  it("reports totalTrials as candidates x folds", () => {
    const r = runWalkForward(series(1500, 100, 0.001, 0.5), "TEST");
    expect(r.totalTrials).toBe(r.candidatesPerFold * r.folds.length);
  });

  it("computes buyHoldReturn over the same OOS period", () => {
    const r = runWalkForward(series(1500, 100, 0.002), "TEST");
    expect(r.buyHoldReturn).toBeGreaterThan(0);
  });

  it("produces an equity curve matching the OOS return series length", () => {
    const r = runWalkForward(series(1500, 100, 0.001, 0.5), "TEST");
    expect(r.oosEquityCurve.length).toBe(r.oosReturns.length);
  });

  it("charges transaction costs (higher cost reduces total return)", () => {
    const cheap = runWalkForward(series(1500, 100, 0.001, 0.5), "TEST", {
      ...DEFAULT_WALK_FORWARD_CONFIG,
      costBps: 1,
    });
    const expensive = runWalkForward(series(1500, 100, 0.001, 0.5), "TEST", {
      ...DEFAULT_WALK_FORWARD_CONFIG,
      costBps: 100,
    });
    expect(expensive.oosTotalReturn).toBeLessThanOrEqual(cheap.oosTotalReturn + 0.001);
  });

  it("reports sharpeDegradation as mean train minus OOS Sharpe", () => {
    const r = runWalkForward(series(1500, 100, 0.001, 0.5), "TEST");
    if (r.meanTrainSharpe != null && r.oosSharpe != null) {
      expect(r.sharpeDegradation).toBeCloseTo(r.meanTrainSharpe - r.oosSharpe, 6);
    }
  });
});
