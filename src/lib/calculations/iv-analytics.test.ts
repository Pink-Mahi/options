import { describe, it, expect } from "vitest";
import { computeIVAnalytics } from "./iv-analytics";
import { runMonteCarlo } from "./monte-carlo";
import type { OptionChain, HistoricalPricePoint } from "@/lib/types";

function makeChain(spot: number, iv: number, dte: number): OptionChain {
  const strike = Math.round(spot);
  const call = {
    symbol: "TEST",
    underlyingSymbol: "TEST",
    exchange: "MOCK",
    optionType: "CALL" as const,
    strike,
    expiration: "2026-01-16",
    daysToExpiration: dte,
    bid: 2,
    ask: 2.5,
    last: 2.25,
    midpoint: 2.25,
    volume: 100,
    openInterest: 500,
    impliedVolatility: iv,
    inTheMoney: false,
    intrinsicValue: 0,
    extrinsicValue: 2.25,
    greeks: { delta: 0.5, gamma: 0.05, theta: -0.05, vega: 0.1, rho: 0.01 },
    greeksProvenance: "provider" as const,
    underlyingPrice: spot,
    dataQuality: "realtime" as const,
    quoteTimestamp: "2025-01-01T00:00:00Z",
    fetchedAt: "2025-01-01T00:00:00Z",
  };
  return {
    underlyingSymbol: "TEST",
    underlyingPrice: spot,
    expiration: "2026-01-16",
    quoteTimestamp: "2025-01-01T00:00:00Z",
    calls: [call],
    puts: [{ ...call, optionType: "PUT" as const, inTheMoney: false }],
  };
}

function makeHistory(days: number, start = 100, vol = 0.3): HistoricalPricePoint[] {
  const pts: HistoricalPricePoint[] = [];
  let price = start;
  // Deterministic pseudo-random walk for reproducibility.
  let seed = 1;
  const rng = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < days; i++) {
    const r = (rng() - 0.5) * vol / Math.sqrt(252);
    price *= Math.exp(r);
    pts.push({
      date: `2024-${String(Math.floor(i / 30) + 1).padStart(2, "0")}-${String((i % 30) + 1).padStart(2, "0")}`,
      open: price, high: price * 1.01, low: price * 0.99, close: price, adjustedClose: price, volume: 1000000,
    });
  }
  return pts;
}

describe("computeIVAnalytics", () => {
  it("computes ATM IV and expected move", () => {
    const chain = makeChain(100, 0.3, 30);
    const hist = makeHistory(300);
    const a = computeIVAnalytics(chain, hist);
    expect(a.currentAtmIv).toBeCloseTo(0.3, 6);
    expect(a.expectedMove).not.toBeNull();
    expect(a.expectedMove!.dte).toBe(30);
    // 1sd ≈ 100 * 0.3 * sqrt(30/365) ≈ 8.59
    expect(a.expectedMove!.oneStdDev).toBeCloseTo(100 * 0.3 * Math.sqrt(30 / 365), 2);
    expect(a.expectedMove!.upper1sd).toBeCloseTo(100 + a.expectedMove!.oneStdDev, 2);
  });

  it("produces IV percentile in [0,1] with enough history", () => {
    const chain = makeChain(100, 0.3, 30);
    const hist = makeHistory(300);
    const a = computeIVAnalytics(chain, hist);
    expect(a.ivPercentile).not.toBeNull();
    expect(a.ivPercentile!).toBeGreaterThanOrEqual(0);
    expect(a.ivPercentile!).toBeLessThanOrEqual(1);
    expect(a.ivRank).not.toBeNull();
    expect(a.ivRank!).toBeGreaterThanOrEqual(0);
    // IV rank can exceed 1 when current IV is above the historical range —
    // that is the whole point of the metric.
  });

  it("warns when history is insufficient", () => {
    const chain = makeChain(100, 0.3, 30);
    const a = computeIVAnalytics(chain, []);
    expect(a.currentAtmIv).toBe(0.3);
    expect(a.ivPercentile).toBeNull();
    expect(a.warnings.length).toBeGreaterThan(0);
  });
});

describe("runMonteCarlo", () => {
  it("runs and returns distribution statistics", () => {
    const hist = makeHistory(300);
    const r = runMonteCarlo(hist, {
      paths: 200,
      horizonDays: 252,
      periodDte: 30,
      strikeOtmPercent: 0.05,
      premiumYieldPerPeriod: 0.01,
      initialPrice: 100,
      seed: 42,
    });
    expect(r.paths).toBe(200);
    expect(r.buyAndHold.meanFinalValue).toBeGreaterThan(0);
    expect(r.coveredCall.meanFinalValue).toBeGreaterThan(0);
    expect(r.buyAndHold.probPositive).toBeGreaterThanOrEqual(0);
    expect(r.buyAndHold.probPositive).toBeLessThanOrEqual(1);
    expect(r.comparison.probCCBeatsBH).toBeGreaterThanOrEqual(0);
    expect(r.comparison.probCCBeatsBH).toBeLessThanOrEqual(1);
    expect(r.coveredCall.meanTimesAssigned).toBeGreaterThanOrEqual(0);
  });

  it("is deterministic given the same seed", () => {
    const hist = makeHistory(300);
    const r1 = runMonteCarlo(hist, { paths: 50, horizonDays: 90, periodDte: 30, strikeOtmPercent: 0.05, premiumYieldPerPeriod: 0.01, initialPrice: 100, seed: 7 });
    const r2 = runMonteCarlo(hist, { paths: 50, horizonDays: 90, periodDte: 30, strikeOtmPercent: 0.05, premiumYieldPerPeriod: 0.01, initialPrice: 100, seed: 7 });
    expect(r1.buyAndHold.meanFinalValue).toBeCloseTo(r2.buyAndHold.meanFinalValue, 6);
    expect(r1.coveredCall.meanFinalValue).toBeCloseTo(r2.coveredCall.meanFinalValue, 6);
  });

  it("warns with insufficient history", () => {
    const r = runMonteCarlo([], { paths: 10, horizonDays: 30, periodDte: 30, strikeOtmPercent: 0.05, premiumYieldPerPeriod: 0.01, initialPrice: 100 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
