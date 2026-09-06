import { describe, it, expect } from "vitest";
import { analyzeMarketContext } from "./market-context";
import type { HistoricalPricePoint } from "@/lib/types";

function makePrices(
  start: number,
  days: number,
  drift: number,
  noise: number,
): HistoricalPricePoint[] {
  const points: HistoricalPricePoint[] = [];
  let price = start;
  const startDate = new Date("2022-01-01");
  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const dailyDrift = drift / 252;
    const dailyNoise = (Math.sin(i * 7.3) + Math.cos(i * 3.1)) * noise * 0.5;
    price = price * (1 + dailyDrift + dailyNoise);
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

function makeCorrelatedPrices(
  start: number,
  days: number,
  benchmark: HistoricalPricePoint[],
  beta: number,
  idioVol: number,
): HistoricalPricePoint[] {
  const points: HistoricalPricePoint[] = [];
  let price = start;
  for (let i = 0; i < days; i++) {
    const benchReturn =
      i > 0 && benchmark[i] && benchmark[i - 1]
        ? benchmark[i]!.adjustedClose / benchmark[i - 1]!.adjustedClose - 1
        : 0;
    const idio = Math.sin(i * 11.7) * idioVol * 0.5;
    const dailyReturn = beta * benchReturn + idio;
    price = price * (1 + dailyReturn);
    points.push({
      date: benchmark[i]!.date,
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

describe("analyzeMarketContext", () => {
  it("returns null when insufficient aligned data", () => {
    const stock = makePrices(100, 20, 0.1, 0.01);
    const bench = makePrices(400, 20, 0.1, 0.01);
    const result = analyzeMarketContext(stock, bench, "SPY", 10000);
    expect(result).toBeNull();
  });

  it("computes beta and correlation for correlated stock", () => {
    const bench = makePrices(400, 300, 0.05, 0.01);
    const stock = makeCorrelatedPrices(100, 300, bench, 1.2, 0.005);
    const result = analyzeMarketContext(stock, bench, "SPY", 10000);
    expect(result).not.toBeNull();
    expect(result!.avgBeta).toBeGreaterThan(0.8);
    expect(result!.avgCorrelation).toBeGreaterThan(0.5);
  });

  it("computes low correlation for uncorrelated stock", () => {
    const bench = makePrices(400, 300, 0.05, 0.01);
    // Use a completely different pattern — different phase and frequency
    const stockPrices: HistoricalPricePoint[] = [];
    let sp = 100;
    for (let i = 0; i < 300; i++) {
      const date = bench[i]!.date;
      const dailyDrift = 0.05 / 252;
      // Different phase/frequency than makePrices
      const dailyNoise = (Math.sin(i * 2.3) + Math.cos(i * 5.7)) * 0.02 * 0.5;
      sp = sp * (1 + dailyDrift + dailyNoise);
      stockPrices.push({
        date,
        open: sp, high: sp * 1.01, low: sp * 0.99, close: sp, adjustedClose: sp, volume: 1000000,
      });
    }
    const result = analyzeMarketContext(stockPrices, bench, "SPY", 10000);
    expect(result).not.toBeNull();
    // With different patterns, correlation should be low
    expect(result!.avgCorrelation).toBeLessThan(0.6);
  });

  it("detects BULL regime when market is trending up", () => {
    const bench = makePrices(400, 300, 0.15, 0.005);
    const stock = makeCorrelatedPrices(100, 300, bench, 1.0, 0.005);
    const result = analyzeMarketContext(stock, bench, "SPY", 10000);
    expect(result).not.toBeNull();
    expect(result!.currentRegime).toBe("BULL");
    expect(result!.benchmarkReturn).toBeGreaterThan(0);
  });

  it("detects BEAR/CRISIS regime when market drops sharply", () => {
    const bench = makePrices(400, 300, -0.25, 0.02);
    const stock = makeCorrelatedPrices(100, 300, bench, 1.3, 0.01);
    const result = analyzeMarketContext(stock, bench, "SPY", 10000);
    expect(result).not.toBeNull();
    expect(["BEAR", "CRISIS"]).toContain(result!.currentRegime);
  });

  it("attributes drawdown as systemic when both stock and market fall", () => {
    // Create a market that crashes 30% then recovers
    const benchPrices: HistoricalPricePoint[] = [];
    let bp = 400;
    const startDate = new Date("2022-01-01");
    for (let i = 0; i < 300; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      if (i > 50 && i < 120) {
        bp *= 0.99; // 30% crash over 70 days
      } else if (i >= 120) {
        bp *= 1.005; // slow recovery
      } else {
        bp *= 1.001;
      }
      benchPrices.push({
        date: date.toISOString().slice(0, 10),
        open: bp, high: bp * 1.01, low: bp * 0.99, close: bp, adjustedClose: bp, volume: 1000000,
      });
    }
    // Stock follows market closely (high beta)
    const stock = makeCorrelatedPrices(100, 300, benchPrices, 1.2, 0.003);
    const result = analyzeMarketContext(stock, benchPrices, "SPY", 10000);
    expect(result).not.toBeNull();
    expect(result!.drawdownAttributions.length).toBeGreaterThan(0);
    const systemic = result!.drawdownAttributions.filter((d) => d.type === "SYSTEMIC");
    expect(systemic.length).toBeGreaterThan(0);
    expect(result!.systemicDrawdownPct).toBeGreaterThan(0.5);
  });

  it("attributes drawdown as idiosyncratic when stock falls but market is fine", () => {
    // Market is steady/slightly up
    const bench = makePrices(400, 300, 0.08, 0.005);
    // Stock crashes independently
    const stockPrices: HistoricalPricePoint[] = [];
    let sp = 100;
    for (let i = 0; i < 300; i++) {
      const date = bench[i]!.date;
      if (i > 50 && i < 120) {
        sp *= 0.98; // Stock-specific crash
      } else if (i >= 120) {
        sp *= 1.002;
      } else {
        sp *= 1.001;
      }
      stockPrices.push({
        date,
        open: sp, high: sp * 1.01, low: sp * 0.99, close: sp, adjustedClose: sp, volume: 1000000,
      });
    }
    const result = analyzeMarketContext(stockPrices, bench, "SPY", 10000);
    expect(result).not.toBeNull();
    expect(result!.drawdownAttributions.length).toBeGreaterThan(0);
    const idio = result!.drawdownAttributions.filter((d) => d.type === "IDIOSYNCRATIC");
    expect(idio.length).toBeGreaterThan(0);
  });

  it("produces a human-readable summary", () => {
    const bench = makePrices(400, 300, 0.1, 0.01);
    const stock = makeCorrelatedPrices(100, 300, bench, 1.1, 0.005);
    const result = analyzeMarketContext(stock, bench, "SPY", 10000);
    expect(result).not.toBeNull();
    expect(result!.summary.length).toBeGreaterThan(100);
    expect(result!.summary).toContain("SPY");
    expect(result!.summary).toContain("beta");
  });

  it("normalizes benchmark equity to starting capital", () => {
    const bench = makePrices(400, 300, 0.1, 0.01);
    const stock = makeCorrelatedPrices(100, 300, bench, 1.0, 0.005);
    const result = analyzeMarketContext(stock, bench, "SPY", 50000);
    expect(result).not.toBeNull();
    expect(result!.benchmarkEquity[0]!.equity).toBeCloseTo(50000, 0);
  });

  it("handles stock with zero drawdowns gracefully", () => {
    const bench = makePrices(400, 300, 0.1, 0.01);
    const stock = makePrices(100, 300, 0.2, 0.001); // steady uptrend, no drawdowns
    const result = analyzeMarketContext(stock, bench, "SPY", 10000);
    expect(result).not.toBeNull();
    expect(result!.drawdownAttributions.length).toBe(0);
    expect(result!.systemicDrawdownPct).toBe(0);
  });
});
