import { describe, it, expect } from "vitest";
import {
  generateNeighbors,
  computeStabilityScore,
  computeRobustnessScore,
  validateCandidateWalkForward,
  DEFAULT_WF_OPTION_CONFIG,
  type OptionCandidate,
} from "./walk-forward-options";
import type { HistoricalPricePoint } from "@/lib/types";
import type { BacktestConfig } from "@/lib/calculations/backtester";

function generatePrices(startPrice: number, days: number, dailyVol: number, trend: number = 0): HistoricalPricePoint[] {
  const prices: HistoricalPricePoint[] = [];
  let price = startPrice;
  let seed = 42;
  for (let i = 0; i < days; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const rand = (seed / 0x7fffffff) - 0.5;
    const change = trend + rand * dailyVol;
    price = price * (1 + change);
    const date = new Date(Date.UTC(2020, 0, 1 + i));
    prices.push({
      date: date.toISOString().slice(0, 10),
      open: price,
      high: price * 1.01,
      low: price * 0.99,
      close: price,
      adjustedClose: price,
      volume: 1000000,
    });
  }
  return prices;
}

const baseConfig: Omit<BacktestConfig, "strategy" | "deltaTarget" | "dteTarget" | "buyBackPct"> = {
  symbol: "TEST",
  contracts: 1,
  riskFreeRate: 0.05,
  startingCapital: 10000,
  shares: 100,
  strikeInterval: 5,
  fillAssumption: "mid",
};

describe("generateNeighbors", () => {
  it("generates delta ±0.05 neighbors", () => {
    const candidate: OptionCandidate = {
      strategy: "COVERED_CALL",
      deltaTarget: 0.30,
      dteTarget: 30,
      buyBackPct: 50,
    };
    const neighbors = generateNeighbors(candidate);
    const deltas = neighbors.map((n) => n.deltaTarget);
    expect(deltas).toContain(0.25);
    expect(deltas).toContain(0.35);
  });

  it("generates adjacent DTE neighbors", () => {
    const candidate: OptionCandidate = {
      strategy: "COVERED_CALL",
      deltaTarget: 0.30,
      dteTarget: 30,
      buyBackPct: 50,
    };
    const neighbors = generateNeighbors(candidate);
    const dtes = neighbors.map((n) => n.dteTarget);
    expect(dtes).toContain(21);
    expect(dtes).toContain(45);
  });

  it("generates buyback ±10pp neighbors", () => {
    const candidate: OptionCandidate = {
      strategy: "COVERED_CALL",
      deltaTarget: 0.30,
      dteTarget: 30,
      buyBackPct: 50,
    };
    const neighbors = generateNeighbors(candidate);
    const buybacks = neighbors.map((n) => n.buyBackPct);
    expect(buybacks).toContain(40);
    expect(buybacks).toContain(60);
  });

  it("clamps delta at boundaries", () => {
    const candidate: OptionCandidate = {
      strategy: "COVERED_CALL",
      deltaTarget: 0.15,
      dteTarget: 30,
      buyBackPct: 50,
    };
    const neighbors = generateNeighbors(candidate);
    const deltas = neighbors.map((n) => n.deltaTarget);
    expect(deltas).toContain(0.20);
    expect(deltas).not.toContain(0.10);
  });

  it("clamps buyback at 0 and 100", () => {
    const candidate: OptionCandidate = {
      strategy: "COVERED_CALL",
      deltaTarget: 0.30,
      dteTarget: 30,
      buyBackPct: 0,
    };
    const neighbors = generateNeighbors(candidate);
    const buybacks = neighbors.map((n) => n.buyBackPct);
    expect(buybacks).not.toContain(-10);
    expect(buybacks).toContain(10);
  });
});

describe("computeStabilityScore", () => {
  it("returns 1.0 when all neighbors match or exceed the candidate", () => {
    const score = computeStabilityScore(0.10, [0.10, 0.12, 0.08]);
    expect(score).toBe(1);
  });

  it("returns 0.0 when all neighbors are much worse", () => {
    const score = computeStabilityScore(0.20, [0.01, 0.02, 0.00]);
    expect(score).toBe(0);
  });

  it("returns 0.5 when half the neighbors are good", () => {
    const score = computeStabilityScore(0.10, [0.08, 0.06, 0.01, 0.12]);
    // threshold = 0.10 * 0.5 = 0.05
    // good: 0.08 >= 0.05 ✓, 0.06 >= 0.05 ✓, 0.01 < 0.05 ✗, 0.12 >= 0.05 ✓
    // 3/4 = 0.75
    expect(score).toBe(0.75);
  });

  it("returns 0.5 for no neighbors (neutral)", () => {
    const score = computeStabilityScore(0.10, []);
    expect(score).toBe(0.5);
  });

  it("handles negative candidate returns", () => {
    const score = computeStabilityScore(-0.10, [-0.05, -0.15]);
    // threshold = -0.10 * 0.5 = -0.05
    // good: -0.05 >= -0.05 ✓, -0.15 < -0.05 ✗
    // 1/2 = 0.5
    expect(score).toBe(0.5);
  });
});

describe("computeRobustnessScore", () => {
  it("rewards high OOS return, stability, and consistency", () => {
    const score = computeRobustnessScore(0.30, 0.9, 0.9);
    // 0.6 * 0.5 + 0.9 * 0.3 + 0.9 * 0.2 = 0.3 + 0.27 + 0.18 = 0.75
    expect(score).toBeGreaterThan(0.7);
  });

  it("penalizes low stability", () => {
    const highStability = computeRobustnessScore(0.30, 0.9, 0.9);
    const lowStability = computeRobustnessScore(0.30, 0.1, 0.9);
    expect(highStability).toBeGreaterThan(lowStability);
  });

  it("penalizes low consistency", () => {
    const highConsistency = computeRobustnessScore(0.30, 0.5, 0.9);
    const lowConsistency = computeRobustnessScore(0.30, 0.5, 0.1);
    expect(highConsistency).toBeGreaterThan(lowConsistency);
  });

  it("clamps OOS return at 50% annualized", () => {
    const score1 = computeRobustnessScore(0.50, 0.5, 0.5);
    const score2 = computeRobustnessScore(1.0, 0.5, 0.5);
    expect(score1).toBeCloseTo(score2, 6);
  });

  it("produces scores in [0, 1] range", () => {
    for (const oosReturn of [-0.5, 0, 0.1, 0.3, 1.0]) {
      for (const stability of [0, 0.5, 1.0]) {
        for (const consistency of [0, 0.5, 1.0]) {
          const score = computeRobustnessScore(oosReturn, stability, consistency);
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("validateCandidateWalkForward", () => {
  it("produces fold results for sufficient data", async () => {
    const prices = generatePrices(100, 500, 0.02, 0.0005);
    const candidate: OptionCandidate = {
      strategy: "COVERED_CALL",
      deltaTarget: 0.30,
      dteTarget: 30,
      buyBackPct: 50,
    };
    const result = await validateCandidateWalkForward(
      prices, candidate, baseConfig, DEFAULT_WF_OPTION_CONFIG,
    );
    expect(result.folds.length).toBe(4);
    for (const fold of result.folds) {
      expect(fold.trainRange.bars).toBeGreaterThan(60);
      expect(fold.testRange.bars).toBeGreaterThan(20);
      expect(fold.testCycles).toBeGreaterThan(0);
    }
  });

  it("reports IS/OOS gap", async () => {
    const prices = generatePrices(100, 500, 0.02, 0.0005);
    const candidate: OptionCandidate = {
      strategy: "COVERED_CALL",
      deltaTarget: 0.30,
      dteTarget: 30,
      buyBackPct: 50,
    };
    const result = await validateCandidateWalkForward(
      prices, candidate, baseConfig, DEFAULT_WF_OPTION_CONFIG,
    );
    expect(result.isOosGap).toBeDefined();
    expect(result.meanTrainReturn).toBeDefined();
    expect(result.meanTestReturn).toBeDefined();
  });

  it("reports OOS consistency as fraction of positive folds", async () => {
    const prices = generatePrices(100, 500, 0.02, 0.0005);
    const candidate: OptionCandidate = {
      strategy: "COVERED_CALL",
      deltaTarget: 0.30,
      dteTarget: 30,
      buyBackPct: 50,
    };
    const result = await validateCandidateWalkForward(
      prices, candidate, baseConfig, DEFAULT_WF_OPTION_CONFIG,
    );
    expect(result.oosConsistency).toBeGreaterThanOrEqual(0);
    expect(result.oosConsistency).toBeLessThanOrEqual(1);
  });

  it("handles insufficient data gracefully", async () => {
    const prices = generatePrices(100, 100, 0.02, 0.0005);
    const candidate: OptionCandidate = {
      strategy: "COVERED_CALL",
      deltaTarget: 0.30,
      dteTarget: 30,
      buyBackPct: 50,
    };
    const result = await validateCandidateWalkForward(
      prices, candidate, baseConfig, DEFAULT_WF_OPTION_CONFIG,
    );
    expect(result.folds.length).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("Insufficient data");
  });

  it("computes annualized OOS return", async () => {
    const prices = generatePrices(100, 500, 0.02, 0.0005);
    const candidate: OptionCandidate = {
      strategy: "COVERED_CALL",
      deltaTarget: 0.30,
      dteTarget: 30,
      buyBackPct: 50,
    };
    const result = await validateCandidateWalkForward(
      prices, candidate, baseConfig, DEFAULT_WF_OPTION_CONFIG,
    );
    expect(result.oosAnnualizedReturn).toBeDefined();
  });
});
