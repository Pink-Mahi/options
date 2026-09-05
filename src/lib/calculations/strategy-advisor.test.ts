import { describe, it, expect } from "vitest";
import {
  scoreStockQuality,
  analyzeCall,
  selectBestCall,
  runStrategyAdvisor,
} from "./strategy-advisor";
import type { HistoricalPricePoint, OptionContract, OptionChain } from "@/lib/types";

function makePriceSeries(
  startPrice: number,
  days: number,
  dailyDrift = 0.0005,
  dailyVol = 0.01,
): HistoricalPricePoint[] {
  const points: HistoricalPricePoint[] = [];
  let price = startPrice;
  const start = new Date("2020-01-01");
  for (let i = 0; i < days; i++) {
    const date = new Date(start);
    date.setDate(date.getDate() + i);
    const shock = (i * 17) % 7 === 0 ? -dailyVol * 2 : dailyVol * ((i % 3) - 1);
    price = price * (1 + dailyDrift + shock);
    points.push({
      date: date.toISOString().slice(0, 10),
      open: price,
      high: price * 1.01,
      low: price * 0.99,
      close: price,
      adjustedClose: price,
      volume: 1000000,
    });
  }
  return points;
}

function makeContract(
  strike: number,
  dte: number,
  bid: number,
  ask: number,
  spot: number,
  delta = 0.3,
): OptionContract {
  const midpoint = (bid + ask) / 2;
  return {
    symbol: `TEST${strike}C${dte}`,
    underlyingSymbol: "TEST",
    optionType: "CALL",
    strike,
    expiration: new Date(Date.now() + dte * 86400000).toISOString().slice(0, 10),
    daysToExpiration: dte,
    bid,
    ask,
    midpoint,
    last: midpoint,
    volume: 100,
    openInterest: 500,
    impliedVolatility: 0.3,
    greeks: { delta, gamma: 0.01, theta: -0.05, vega: 0.1, rho: 0.01 },
    intrinsicValue: Math.max(0, spot - strike),
    extrinsicValue: Math.max(0, midpoint - Math.max(0, spot - strike)),
    inTheMoney: spot > strike,
    underlyingPrice: spot,
    quoteTimestamp: new Date().toISOString(),
    greeksProvenance: "provider" as any,
  };
}

function makeChain(strike: number, dte: number, spot: number): OptionChain {
  const calls: OptionContract[] = [];
  const strikes = [spot * 0.9, spot * 0.95, spot, spot * 1.02, spot * 1.05, spot * 1.08, spot * 1.10, spot * 1.15];
  for (const s of strikes) {
    const bid = Math.max(0.05, spot - s > 0 ? spot - s + 0.5 : 2 - (s - spot) * 0.3);
    const ask = bid + 0.05;
    const delta = s <= spot ? 0.7 : Math.max(0.05, 0.5 - (s - spot) / spot);
    calls.push(makeContract(s, dte, bid, ask, spot, delta));
  }
  return {
    underlyingSymbol: "TEST",
    expiration: new Date(Date.now() + dte * 86400000).toISOString().slice(0, 10),
    underlyingPrice: spot,
    calls,
    puts: [],
    quoteTimestamp: new Date().toISOString(),
  };
}

describe("scoreStockQuality", () => {
  it("returns a grade A for a steady uptrend with low volatility", () => {
    const points = makePriceSeries(100, 300, 0.0008, 0.005);
    const result = scoreStockQuality(points, "bullish", 50);
    expect(result.total).toBeGreaterThan(60);
    expect(result.grade).toMatch(/[ABC]/);
    expect(result.strengths.length).toBeGreaterThan(0);
  });

  it("returns a lower grade for high volatility declining stock", () => {
    const points = makePriceSeries(100, 300, -0.001, 0.03);
    const result = scoreStockQuality(points, "bearish", -50);
    expect(result.total).toBeLessThan(50);
    expect(result.concerns.length).toBeGreaterThan(0);
  });

  it("produces explanation text for every grade", () => {
    const points = makePriceSeries(100, 300, 0.0005, 0.01);
    const result = scoreStockQuality(points, "neutral", 0);
    expect(result.explanation).toBeTruthy();
    expect(result.explanation.length).toBeGreaterThan(20);
  });

  it("component scores sum to weighted total within tolerance", () => {
    const points = makePriceSeries(100, 300, 0.0005, 0.01);
    const result = scoreStockQuality(points, "neutral", 0);
    const weights = { trend: 0.25, stability: 0.20, growth: 0.25, drawdownRisk: 0.15, technicalBias: 0.15 };
    const expected =
      result.components.trend * weights.trend +
      result.components.stability * weights.stability +
      result.components.growth * weights.growth +
      result.components.drawdownRisk * weights.drawdownRisk +
      result.components.technicalBias * weights.technicalBias;
    expect(result.total).toBeCloseTo(expected, 0);
  });
});

describe("analyzeCall", () => {
  it("classifies OTM calls as income_keep", () => {
    const contract = makeContract(110, 30, 1.5, 1.6, 100, 0.25);
    const result = analyzeCall(contract, 100, 1);
    expect(result.strategy).toBe("income_keep");
    expect(result.strike).toBe(110);
    expect(result.premiumPerShare).toBeCloseTo(1.55, 1);
  });

  it("classifies near-the-money calls as balanced or income_sell", () => {
    const contract = makeContract(101, 30, 3.0, 3.1, 100, 0.48);
    const result = analyzeCall(contract, 100, 1);
    expect(["balanced", "income_sell"]).toContain(result.strategy);
  });

  it("computes expire worthless probability as 1 - assignment probability", () => {
    const contract = makeContract(105, 30, 2.0, 2.1, 100, 0.35);
    const result = analyzeCall(contract, 100, 1);
    expect(result.assignmentProbability).not.toBeNull();
    expect(result.expireWorthlessProbability).not.toBeNull();
    if (result.assignmentProbability != null && result.expireWorthlessProbability != null) {
      expect(result.assignmentProbability + result.expireWorthlessProbability).toBeCloseTo(1, 5);
    }
  });

  it("generates plain-English explanation with strike and DTE", () => {
    const contract = makeContract(105, 45, 2.0, 2.1, 100, 0.30);
    const result = analyzeCall(contract, 100, 1);
    expect(result.explanation).toContain("105");
    expect(result.explanation).toContain("45");
  });
});

describe("selectBestCall", () => {
  it("selects the call with highest balanced score", () => {
    const calls = [
      analyzeCall(makeContract(100, 30, 3.0, 3.1, 100, 0.50), 100, 1),
      analyzeCall(makeContract(105, 30, 2.0, 2.1, 100, 0.30), 100, 1),
      analyzeCall(makeContract(110, 30, 1.0, 1.1, 100, 0.15), 100, 1),
    ];
    const best = selectBestCall(calls);
    expect(best).not.toBeNull();
    expect(best!.isBestPick).toBe(true);
  });

  it("returns null for empty list", () => {
    expect(selectBestCall([])).toBeNull();
  });
});

describe("runStrategyAdvisor", () => {
  it("produces a complete result with verdict, quality, and DTE comparisons", () => {
    const points = makePriceSeries(100, 300, 0.0005, 0.01);
    const chains = [
      makeChain(100, 30, 100),
      makeChain(100, 60, 100),
    ];
    const result = runStrategyAdvisor("TEST", 100, points, chains, "bullish", 50, 1);

    expect(result.symbol).toBe("TEST");
    expect(result.currentPrice).toBe(100);
    expect(result.quality.total).toBeGreaterThan(0);
    expect(["strong_buy", "buy", "caution", "avoid"]).toContain(result.verdict);
    expect(result.verdictExplanation).toBeTruthy();
    expect(result.dteComparisons.length).toBe(2);
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it("recommends 30-60 DTE when available", () => {
    const points = makePriceSeries(100, 300, 0.0005, 0.01);
    const chains = [
      makeChain(100, 30, 100),
      makeChain(100, 45, 100),
      makeChain(100, 90, 100),
    ];
    const result = runStrategyAdvisor("TEST", 100, points, chains, "neutral", 0, 1);
    expect(result.recommendedDTE.dte).toBeGreaterThanOrEqual(25);
    expect(result.recommendedDTE.dte).toBeLessThanOrEqual(60);
    expect(result.recommendedDTE.reason).toBeTruthy();
  });

  it("selects a best pick across all chains", () => {
    const points = makePriceSeries(100, 300, 0.0005, 0.01);
    const chains = [
      makeChain(100, 30, 100),
      makeChain(100, 60, 100),
    ];
    const result = runStrategyAdvisor("TEST", 100, points, chains, "bullish", 50, 1);
    expect(result.bestPick).not.toBeNull();
    if (result.bestPick) {
      expect(result.bestPick.isBestPick).toBe(true);
      expect(result.bestPick.strike).toBeGreaterThan(0);
      expect(result.bestPick.explanation).toBeTruthy();
    }
  });

  it("handles empty chains gracefully", () => {
    const points = makePriceSeries(100, 300, 0.0005, 0.01);
    const result = runStrategyAdvisor("TEST", 100, points, [], "neutral", 0, 1);
    expect(result.bestPick).toBeNull();
    expect(result.dteComparisons.length).toBe(0);
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it("assigns avoid verdict for poor quality stocks", () => {
    const points = makePriceSeries(100, 300, -0.002, 0.04);
    const chains = [makeChain(100, 30, 100)];
    const result = runStrategyAdvisor("TEST", 100, points, chains, "bearish", -60, 1);
    expect(["caution", "avoid"]).toContain(result.verdict);
  });
});
