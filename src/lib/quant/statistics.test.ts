import { describe, it, expect } from "vitest";
import {
  computeMoments,
  sharpe,
  sortino,
  maxDrawdown,
  probabilisticSharpeRatio,
  expectedMaxSharpe,
  deflatedSharpeRatio,
  normalCdf,
  normalInv,
} from "./statistics";

describe("normalCdf", () => {
  it("is 0.5 at zero", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
  });

  it("matches known quantiles", () => {
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
    expect(normalCdf(1.645)).toBeCloseTo(0.95, 3);
  });

  it("is monotonic", () => {
    expect(normalCdf(-1)).toBeLessThan(normalCdf(0));
    expect(normalCdf(0)).toBeLessThan(normalCdf(1));
  });
});

describe("normalInv", () => {
  it("is 0 at p=0.5", () => {
    expect(normalInv(0.5)).toBeCloseTo(0, 6);
  });

  it("matches known quantiles", () => {
    expect(normalInv(0.975)).toBeCloseTo(1.95996, 4);
    expect(normalInv(0.025)).toBeCloseTo(-1.95996, 4);
    expect(normalInv(0.95)).toBeCloseTo(1.64485, 4);
  });

  it("round-trips with normalCdf", () => {
    for (const p of [0.01, 0.1, 0.3, 0.5, 0.7, 0.9, 0.99]) {
      expect(normalCdf(normalInv(p))).toBeCloseTo(p, 3);
    }
  });

  it("handles the tail branches", () => {
    // p < 0.02425 and p > 0.97575 use separate rational branches.
    expect(normalInv(0.001)).toBeCloseTo(-3.09023, 3);
    expect(normalInv(0.999)).toBeCloseTo(3.09023, 3);
  });
});

describe("computeMoments", () => {
  it("returns null for fewer than 2 points", () => {
    expect(computeMoments([])).toBeNull();
    expect(computeMoments([0.01])).toBeNull();
  });

  it("computes mean and stdDev", () => {
    const m = computeMoments([1, 2, 3, 4, 5])!;
    expect(m.mean).toBe(3);
    // Sample stdDev of 1..5 is sqrt(2.5)
    expect(m.stdDev).toBeCloseTo(Math.sqrt(2.5), 6);
    expect(m.count).toBe(5);
  });

  it("reports ~zero skew for a symmetric series", () => {
    const m = computeMoments([-2, -1, 0, 1, 2])!;
    expect(m.skewness).toBeCloseTo(0, 6);
  });

  it("reports positive skew for a right-tailed series", () => {
    const m = computeMoments([1, 1, 1, 1, 10])!;
    expect(m.skewness).toBeGreaterThan(0);
  });

  it("reports kurtosis of 3 for a constant-variance edge case", () => {
    const m = computeMoments([5, 5, 5])!;
    expect(m.stdDev).toBe(0);
    expect(m.kurtosis).toBe(3);
  });
});

describe("sharpe", () => {
  it("annualizes by sqrt(periodsPerYear)", () => {
    const returns = [0.01, 0.02, -0.01, 0.015, 0.005];
    const daily = sharpe(returns, 1)!;
    const annual = sharpe(returns, 252)!;
    expect(annual).toBeCloseTo(daily * Math.sqrt(252), 6);
  });

  it("subtracts the risk-free rate", () => {
    const returns = [0.01, 0.02, -0.01, 0.015, 0.005];
    const withoutRf = sharpe(returns, 252, 0)!;
    const withRf = sharpe(returns, 252, 0.05)!;
    expect(withRf).toBeLessThan(withoutRf);
  });

  it("returns null for zero-variance returns", () => {
    expect(sharpe([0.01, 0.01, 0.01], 252)).toBeNull();
  });

  it("is negative for a losing series", () => {
    expect(sharpe([-0.01, -0.02, -0.005, -0.015], 252)!).toBeLessThan(0);
  });
});

describe("sortino", () => {
  it("returns null when there is no downside", () => {
    expect(sortino([0.01, 0.02, 0.03], 252)).toBeNull();
  });

  it("exceeds Sharpe when downside is small relative to total vol", () => {
    // Big upside moves inflate total stdDev but not downside deviation.
    const returns = [0.10, 0.12, -0.01, 0.11, -0.005];
    const sr = sharpe(returns, 252)!;
    const so = sortino(returns, 252)!;
    expect(so).toBeGreaterThan(sr);
  });
});

describe("maxDrawdown", () => {
  it("is 0 for a monotonically rising curve", () => {
    expect(maxDrawdown([100, 110, 120, 130])).toBe(0);
  });

  it("computes a simple drawdown", () => {
    // Peak 200 -> trough 150 is 25%
    expect(maxDrawdown([100, 200, 150, 180])).toBeCloseTo(0.25, 6);
  });

  it("keeps the worst drawdown, not the last", () => {
    expect(maxDrawdown([100, 200, 100, 150, 140])).toBeCloseTo(0.5, 6);
  });

  it("handles an empty curve", () => {
    expect(maxDrawdown([])).toBe(0);
  });
});

describe("probabilisticSharpeRatio", () => {
  it("returns 0.5 when observed equals the benchmark", () => {
    expect(probabilisticSharpeRatio(0.1, 0.1, 100, 0, 3)).toBeCloseTo(0.5, 6);
  });

  it("rises with a larger sample for the same Sharpe", () => {
    const small = probabilisticSharpeRatio(0.1, 0, 30, 0, 3)!;
    const large = probabilisticSharpeRatio(0.1, 0, 300, 0, 3)!;
    expect(large).toBeGreaterThan(small);
  });

  it("is penalized by negative skew", () => {
    const symmetric = probabilisticSharpeRatio(0.1, 0, 100, 0, 3)!;
    const negSkew = probabilisticSharpeRatio(0.1, 0, 100, -1.5, 3)!;
    expect(negSkew).toBeLessThan(symmetric);
  });

  it("is penalized by fat tails", () => {
    const normalTails = probabilisticSharpeRatio(0.1, 0, 100, 0, 3)!;
    const fatTails = probabilisticSharpeRatio(0.1, 0, 100, 0, 12)!;
    expect(fatTails).toBeLessThan(normalTails);
  });

  it("returns null for an insufficient sample", () => {
    expect(probabilisticSharpeRatio(0.1, 0, 1, 0, 3)).toBeNull();
  });
});

describe("expectedMaxSharpe", () => {
  it("is 0 for a single trial", () => {
    expect(expectedMaxSharpe(1, 0.04)).toBe(0);
  });

  it("is 0 when trial Sharpes have no spread", () => {
    expect(expectedMaxSharpe(100, 0)).toBe(0);
  });

  it("grows with the number of trials", () => {
    const few = expectedMaxSharpe(10, 0.04);
    const many = expectedMaxSharpe(1000, 0.04);
    expect(many).toBeGreaterThan(few);
  });

  it("grows with the spread across trials", () => {
    const tight = expectedMaxSharpe(100, 0.01);
    const wide = expectedMaxSharpe(100, 0.25);
    expect(wide).toBeGreaterThan(tight);
  });
});

describe("deflatedSharpeRatio", () => {
  // A modest but consistent positive drift.
  const decentReturns = Array.from({ length: 250 }, (_, i) =>
    0.0006 + 0.01 * Math.sin(i / 7) * 0.5,
  );

  it("flags insufficient data on a short series", () => {
    const r = deflatedSharpeRatio([0.01, 0.02, -0.01], [0.1], 252);
    expect(r.verdict).toBe("insufficient_data");
  });

  it("treats a single trial as PSR with a zero hurdle", () => {
    const r = deflatedSharpeRatio(decentReturns, [0.1], 252);
    expect(r.trials).toBe(1);
    expect(r.benchmarkSharpe).toBe(0);
    expect(r.notes.some((n) => n.includes("Probabilistic Sharpe Ratio"))).toBe(true);
  });

  it("raises the hurdle as more variants are tried", () => {
    const fewTrials = deflatedSharpeRatio(decentReturns, [0.02, 0.05, 0.08], 252);
    const manyTrials = deflatedSharpeRatio(
      decentReturns,
      Array.from({ length: 500 }, (_, i) => (i % 50) * 0.004),
      252,
    );
    expect(manyTrials.benchmarkSharpe).toBeGreaterThan(fewTrials.benchmarkSharpe);
  });

  it("deflated confidence never exceeds undeflated confidence", () => {
    const r = deflatedSharpeRatio(
      decentReturns,
      Array.from({ length: 200 }, (_, i) => (i % 20) * 0.01),
      252,
    );
    expect(r.deflatedSharpe!).toBeLessThanOrEqual(r.probabilisticSharpe!);
  });

  it("calls a noisy strategy searched over many variants likely_overfit", () => {
    // Near-zero edge, heavily searched.
    const noise = Array.from({ length: 120 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.0098));
    const r = deflatedSharpeRatio(
      noise,
      Array.from({ length: 400 }, (_, i) => (i % 40) * 0.01),
      252,
    );
    expect(r.verdict).toBe("likely_overfit");
    expect(r.notes.some((n) => n.includes("not statistically distinguishable from luck"))).toBe(true);
  });

  it("annualizes the reported Sharpe consistently", () => {
    const r = deflatedSharpeRatio(decentReturns, [0.1], 252);
    expect(r.annualizedSharpe).toBeCloseTo(r.observedSharpe * Math.sqrt(252), 6);
  });

  it("warns about negative skew", () => {
    // Many small gains, occasional large loss.
    const negSkew = Array.from({ length: 120 }, (_, i) => (i % 30 === 0 ? -0.08 : 0.004));
    const r = deflatedSharpeRatio(negSkew, [0.1], 252);
    expect(r.skewness).toBeLessThan(0);
    expect(r.notes.some((n) => n.includes("negatively skewed"))).toBe(true);
  });
});
