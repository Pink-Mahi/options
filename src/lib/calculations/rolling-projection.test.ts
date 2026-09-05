import { describe, it, expect } from "vitest";
import { projectRollingIncome } from "./rolling-projection";
import { calculateRiskAdjustedReturns } from "./historical";
import type { HistoricalPricePoint } from "@/lib/types";

function makeHistory(days: number, start = 100, vol = 0.3, drift = 0.08): HistoricalPricePoint[] {
  const pts: HistoricalPricePoint[] = [];
  let price = start;
  let seed = 1;
  const rng = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < days; i++) {
    const r = (rng() - 0.5) * vol / Math.sqrt(252) + drift / 252;
    price *= Math.exp(r);
    pts.push({
      date: `2024-${String(Math.floor(i / 30) + 1).padStart(2, "0")}-${String((i % 30) + 1).padStart(2, "0")}`,
      open: price, high: price * 1.01, low: price * 0.99, close: price, adjustedClose: price, volume: 1000000,
    });
  }
  return pts;
}

describe("projectRollingIncome", () => {
  it("projects rolling income from history", () => {
    const hist = makeHistory(500);
    const r = projectRollingIncome(hist, {
      periodDte: 30,
      strikeOtmPercent: 0.05,
      premiumYieldPerPeriod: 0.01,
      periodsPerYear: 12,
    });
    expect(r).not.toBeNull();
    expect(r!.periodsAnalyzed).toBeGreaterThan(10);
    expect(r!.assignmentRate).toBeGreaterThanOrEqual(0);
    expect(r!.assignmentRate).toBeLessThanOrEqual(1);
    expect(r!.projectedAnnualPremiumIncome).toBeCloseTo(0.12, 1); // 0.01 * 12
  });

  it("returns null-equivalent with insufficient history", () => {
    const r = projectRollingIncome([], {
      periodDte: 30,
      strikeOtmPercent: 0.05,
      premiumYieldPerPeriod: 0.01,
      periodsPerYear: 12,
    });
    expect(r).not.toBeNull();
    expect(r!.periodsAnalyzed).toBe(0);
    expect(r!.warnings.length).toBeGreaterThan(0);
  });
});

describe("calculateRiskAdjustedReturns", () => {
  it("computes Sharpe, Sortino, Calmar", () => {
    const hist = makeHistory(500);
    const r = calculateRiskAdjustedReturns(hist, 0.045);
    expect(r.sharpeRatio).not.toBeNull();
    expect(r.sortinoRatio).not.toBeNull();
    expect(r.calmarRatio).not.toBeNull();
    expect(r.annualizedVolatility).toBeGreaterThan(0);
    expect(r.maxDrawdown).toBeLessThanOrEqual(0);
  });

  it("handles insufficient history", () => {
    const r = calculateRiskAdjustedReturns([], 0.045);
    expect(r.sharpeRatio).toBeNull();
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("uses the provided risk-free rate", () => {
    const hist = makeHistory(500);
    const r1 = calculateRiskAdjustedReturns(hist, 0.0);
    const r2 = calculateRiskAdjustedReturns(hist, 0.10);
    // Higher risk-free rate → lower Sharpe (all else equal).
    expect(r1.sharpeRatio!).toBeGreaterThan(r2.sharpeRatio!);
  });
});
