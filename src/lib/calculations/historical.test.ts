import { describe, expect, it } from "vitest";
import {
  avgPeriodReturn,
  calculateHistoricalReturns,
  dailyLogReturns,
  historicalVolatility,
  maxDrawdown,
  meanOf,
  movingAverage,
  percentile,
  rollingReturnDistribution,
  stdDevOf,
} from "./historical";
import type { HistoricalPricePoint } from "@/lib/types";

function series(start: number, days: number, drift = 0): HistoricalPricePoint[] {
  const pts: HistoricalPricePoint[] = [];
  let price = start;
  const base = new Date("2024-01-01").getTime();
  for (let i = 0; i < days; i++) {
    const date = new Date(base + i * 86400000).toISOString().slice(0, 10);
    pts.push({
      date,
      open: price,
      high: price * 1.01,
      low: price * 0.99,
      close: price,
      adjustedClose: price,
      volume: 1000000,
    });
    price = price * (1 + drift);
  }
  return pts;
}

describe("dailyLogReturns", () => {
  it("returns N-1 log returns", () => {
    const pts = series(100, 5, 0.01);
    const r = dailyLogReturns(pts);
    expect(r.length).toBe(4);
    expect(r[0]).toBeCloseTo(Math.log(1.01), 8);
  });
});

describe("meanOf / stdDevOf / percentile", () => {
  it("mean", () => {
    expect(meanOf([1, 2, 3])).toBe(2);
  });
  it("stdDev sample", () => {
    expect(stdDevOf([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
  });
  it("percentile median of 1..5", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });
});

describe("maxDrawdown", () => {
  it("computes drawdown", () => {
    const pts: HistoricalPricePoint[] = [
      { date: "2024-01-01", open: 100, high: 100, low: 100, close: 100, adjustedClose: 100, volume: 1 },
      { date: "2024-01-02", open: 120, high: 120, low: 120, close: 120, adjustedClose: 120, volume: 1 },
      { date: "2024-01-03", open: 90, high: 90, low: 90, close: 90, adjustedClose: 90, volume: 1 },
    ];
    // peak 120, trough 90 -> dd = 90/120 - 1 = -0.25
    expect(maxDrawdown(pts)).toBeCloseTo(-0.25, 8);
  });
});

describe("movingAverage", () => {
  it("returns SMA and priceAbove flag", () => {
    const pts = series(100, 50, 0.001);
    const ma = movingAverage(pts, 20);
    expect(ma).not.toBeNull();
    expect(ma?.period).toBe(20);
    expect(ma?.priceAbove).toBe(true); // rising series
  });
  it("null if insufficient data", () => {
    expect(movingAverage(series(100, 5), 20)).toBeNull();
  });
});

describe("historicalVolatility", () => {
  it("returns annualized vol", () => {
    const pts = series(100, 60, 0.005);
    const v = historicalVolatility(pts, 30);
    expect(v).not.toBeNull();
    expect(v!).toBeGreaterThan(0);
  });
});

describe("calculateHistoricalReturns", () => {
  it("computes returns and 52-week range", () => {
    const pts = series(100, 300, 0.001);
    const r = calculateHistoricalReturns(pts);
    expect(r.oneMonthReturn).not.toBeNull();
    expect(r.annualizedVolatility).not.toBeNull();
    expect(r.high52Week).not.toBeNull();
    expect(r.low52Week).not.toBeNull();
  });
});

describe("rollingReturnDistribution", () => {
  it("returns distribution and exceedance fraction", () => {
    const pts = series(100, 400, 0.002);
    const dist = rollingReturnDistribution(pts, 30, 0.1);
    expect(dist).not.toBeNull();
    expect(dist!.sampleSize).toBeGreaterThan(5);
    expect(dist!.percentExceedingThreshold).toBeGreaterThanOrEqual(0);
    expect(dist!.percentExceedingThreshold).toBeLessThanOrEqual(1);
  });
});

describe("avgPeriodReturn", () => {
  it("returns null for insufficient data", () => {
    expect(avgPeriodReturn(series(100, 5), 21)).toBeNull();
  });
});
