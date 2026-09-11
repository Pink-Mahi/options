import { describe, it, expect } from "vitest";
import {
  computeNormalizedScores,
  MIN_CYCLES,
  type OptimizeResult,
} from "./scoring";

/** Build a minimal OptimizeResult for testing. */
function makeResult(overrides: Partial<OptimizeResult> = {}): OptimizeResult {
  return {
    strategy: "COVERED_CALL",
    dte: 30,
    buyBackPct: 50,
    deltaTarget: 0.30,
    minCallYieldPct: 0,
    minPutYieldPct: 0,
    neverBelowCost: false,
    averageDown: false,
    rollOnAssignment: false,
    strategyReturn: 0.5,
    annualizedReturn: 0.10,
    buyHoldReturn: 0.3,
    outperformance: 0.2,
    sharpeRatio: 1.0,
    sortinoRatio: 1.5,
    calmarRatio: 0.8,
    maxDrawdown: 0.15,
    totalPremiumIncome: 5000,
    winRate: 0.85,
    totalCycles: 20,
    assignmentCount: 2,
    earlyCloseCount: 5,
    avgPremiumPerCycle: 250,
    realDataCycles: 0,
    bsModelCycles: 20,
    compositeScore: 0,
    avgMonthlyIncome: 400,
    interestIncome: 0,
    totalCommissions: 0,
    returnOnCapitalDeployed: 0.12,
    capitalUtilization: 0.85,
    monthlyIncomeStdDev: 100,
    zeroIncomeMonths: 0,
    worstCyclePnl: -200,
    worstMonthPnl: 100,
    daysUnderwater: 10,
    deflatedSharpe: null,
    deflatedSharpeVerdict: null,
    trials: 0,
    ...overrides,
  };
}

describe("computeNormalizedScores", () => {
  it("ranks a candidate with higher Sharpe above one with lower Sharpe (balanced)", () => {
    const results = [
      makeResult({ sharpeRatio: 2.0, sortinoRatio: 2.5, calmarRatio: 1.5 }),
      makeResult({ sharpeRatio: 0.5, sortinoRatio: 0.7, calmarRatio: 0.3 }),
    ];
    computeNormalizedScores(results, 1.0, "balanced");
    expect(results[0]!.compositeScore).toBeGreaterThan(results[1]!.compositeScore);
  });

  it("penalizes candidates with fewer than MIN_CYCLES cycles", () => {
    const results = [
      makeResult({ totalCycles: MIN_CYCLES - 1, sharpeRatio: 3.0 }),
      makeResult({ totalCycles: 50, sharpeRatio: 1.0 }),
    ];
    computeNormalizedScores(results, 1.0, "balanced");
    // The high-Sharpe but low-cycle candidate should be heavily penalized
    expect(results[0]!.compositeScore).toBeLessThan(results[1]!.compositeScore);
    expect(results[0]!.compositeScore).toBeLessThan(-900);
  });

  it("rewards higher return for long_term_gains goal", () => {
    const results = [
      makeResult({ annualizedReturn: 0.20, outperformance: 0.15, returnOnCapitalDeployed: 0.25 }),
      makeResult({ annualizedReturn: 0.05, outperformance: -0.05, returnOnCapitalDeployed: 0.03 }),
    ];
    computeNormalizedScores(results, 1.0, "long_term_gains");
    expect(results[0]!.compositeScore).toBeGreaterThan(results[1]!.compositeScore);
  });

  it("rewards income consistency for cash_flow goal", () => {
    const results = [
      makeResult({ avgMonthlyIncome: 500, monthlyIncomeStdDev: 50, capitalUtilization: 0.95 }),
      makeResult({ avgMonthlyIncome: 500, monthlyIncomeStdDev: 300, capitalUtilization: 0.50 }),
    ];
    computeNormalizedScores(results, 1.0, "cash_flow");
    expect(results[0]!.compositeScore).toBeGreaterThan(results[1]!.compositeScore);
  });

  it("penalizes drawdown more for conservative risk tolerance", () => {
    const results = [
      makeResult({ maxDrawdown: 0.40, annualizedReturn: 0.20, sharpeRatio: 1.5 }),
      makeResult({ maxDrawdown: 0.05, annualizedReturn: 0.08, sharpeRatio: 1.0 }),
    ];
    // Conservative
    computeNormalizedScores(results, 0.0, "balanced");
    const conservativeLowDdScore = results[1]!.compositeScore;
    const conservativeHighDdScore = results[0]!.compositeScore;

    // Aggressive
    computeNormalizedScores(results, 2.0, "balanced");
    const aggressiveLowDdScore = results[1]!.compositeScore;
    const aggressiveHighDdScore = results[0]!.compositeScore;

    // The drawdown penalty should be larger for conservative users, so the
    // gap between low-DD and high-DD should be wider for conservative.
    const conservativeGap = conservativeLowDdScore - conservativeHighDdScore;
    const aggressiveGap = aggressiveLowDdScore - aggressiveHighDdScore;
    expect(conservativeGap).toBeGreaterThan(aggressiveGap);
  });

  it("penalizes zero-income months for cash_flow goal", () => {
    const results = [
      makeResult({ zeroIncomeMonths: 5, avgMonthlyIncome: 500, monthlyIncomeStdDev: 100 }),
      makeResult({ zeroIncomeMonths: 0, avgMonthlyIncome: 500, monthlyIncomeStdDev: 100 }),
    ];
    computeNormalizedScores(results, 1.0, "cash_flow");
    expect(results[1]!.compositeScore).toBeGreaterThan(results[0]!.compositeScore);
  });

  it("produces scores in a reasonable range (0 to 1 for eligible candidates)", () => {
    const results = Array.from({ length: 20 }, (_, i) =>
      makeResult({
        sharpeRatio: 0.5 + i * 0.1,
        annualizedReturn: 0.05 + i * 0.01,
        sortinoRatio: 0.7 + i * 0.1,
        calmarRatio: 0.3 + i * 0.05,
      }),
    );
    computeNormalizedScores(results, 1.0, "balanced");
    for (const r of results) {
      expect(r.compositeScore).toBeGreaterThanOrEqual(0);
      expect(r.compositeScore).toBeLessThanOrEqual(1);
    }
  });

  it("handles a single candidate (no crash, neutral score)", () => {
    const results = [makeResult()];
    computeNormalizedScores(results, 1.0, "balanced");
    // Single candidate gets 0.5 percentile on every metric → score = 0.5 * total weight
    expect(results[0]!.compositeScore).toBeGreaterThan(0);
    expect(results[0]!.compositeScore).toBeLessThan(1);
  });

  it("handles all candidates having the same values (no crash)", () => {
    const results = [
      makeResult({ sharpeRatio: 1.0 }),
      makeResult({ sharpeRatio: 1.0 }),
      makeResult({ sharpeRatio: 1.0 }),
    ];
    computeNormalizedScores(results, 1.0, "balanced");
    // All should have the same score
    expect(results[0]!.compositeScore).toBeCloseTo(results[1]!.compositeScore, 6);
    expect(results[1]!.compositeScore).toBeCloseTo(results[2]!.compositeScore, 6);
  });
});
