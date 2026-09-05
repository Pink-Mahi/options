import { describe, it, expect } from "vitest";
import { runBacktest } from "./backtester";
import type { HistoricalPricePoint } from "@/lib/types";

function generatePrices(startPrice: number, days: number, dailyVol: number, trend: number = 0): HistoricalPricePoint[] {
  const prices: HistoricalPricePoint[] = [];
  let price = startPrice;
  // Use a simple deterministic random-ish walk with fixed seed
  let seed = 42;
  for (let i = 0; i < days; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const rand = (seed / 0x7fffffff) - 0.5; // -0.5 to 0.5
    const change = trend + rand * dailyVol;
    price = price * (1 + change);
    const date = new Date(2020, 0, 1 + i);
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

describe("runBacktest - covered call", () => {
  it("runs a backtest over synthetic price data", () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = runBacktest(prices, {
      strategy: "COVERED_CALL",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 100,
      strikeInterval: 5,
      fillAssumption: "mid",
    });

    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.totalPremiumIncome).toBeGreaterThan(0);
    expect(result.equityCurve.length).toBeGreaterThan(0);
  });

  it("produces valid win rate", () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = runBacktest(prices, {
      strategy: "COVERED_CALL",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 100,
      strikeInterval: 5,
      fillAssumption: "mid",
    });

    expect(result.winRate).toBeGreaterThanOrEqual(0);
    expect(result.winRate).toBeLessThanOrEqual(1);
    expect(result.expiredWorthlessCount + result.calledAwayCount).toBe(result.totalCycles);
  });

  it("computes buy-and-hold return", () => {
    const prices = generatePrices(100, 300, 0.02, 0.001);
    const result = runBacktest(prices, {
      strategy: "COVERED_CALL",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 100,
      strikeInterval: 5,
      fillAssumption: "mid",
    });

    expect(result.buyHoldReturn).toBeGreaterThan(0); // uptrend
  });
});

describe("runBacktest - cash secured put", () => {
  it("runs CSP backtest", () => {
    const prices = generatePrices(100, 300, 0.02, 0);
    const result = runBacktest(prices, {
      strategy: "CASH_SECURED_PUT",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 45,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 0,
      strikeInterval: 5,
      fillAssumption: "mid",
    });

    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.totalPremiumIncome).toBeGreaterThan(0);
    expect(result.assignmentCount + result.expiredWorthlessCount).toBe(result.totalCycles);
  });
});

describe("runBacktest - wheel", () => {
  it("alternates between CSP and CC", () => {
    const prices = generatePrices(100, 500, 0.02, 0.0003);
    const result = runBacktest(prices, {
      strategy: "WHEEL",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 0,
      strikeInterval: 5,
      fillAssumption: "mid",
    });

    // Should have both puts and calls
    const hasPuts = result.trades.some((t) => t.optionType === "PUT");
    const hasCalls = result.trades.some((t) => t.optionType === "CALL");
    expect(hasPuts).toBe(true);
    expect(hasCalls).toBe(true);
  });
});

describe("runBacktest - edge cases", () => {
  it("handles insufficient data gracefully", () => {
    const prices = generatePrices(100, 30, 0.02);
    const result = runBacktest(prices, {
      strategy: "COVERED_CALL",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 100,
      strikeInterval: 5,
      fillAssumption: "mid",
    });

    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("computes outperformance", () => {
    const prices = generatePrices(100, 300, 0.02, 0.001);
    const result = runBacktest(prices, {
      strategy: "COVERED_CALL",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 100,
      strikeInterval: 5,
      fillAssumption: "mid",
    });

    expect(result.outperformance).toBe(result.strategyReturn - result.buyHoldReturn);
  });

  it("computes max drawdown between 0 and 1", () => {
    const prices = generatePrices(100, 300, 0.03, 0);
    const result = runBacktest(prices, {
      strategy: "COVERED_CALL",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 100,
      strikeInterval: 5,
      fillAssumption: "mid",
    });

    expect(result.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(result.maxDrawdown).toBeLessThanOrEqual(1);
  });
});
