import { describe, it, expect } from "vitest";
import {
  yangZhangVolatility,
  garmanKlassVolatility,
  classifyVolRegime,
  calibratedVrpMultiplier,
  calibratedImpliedVol,
  earlyAssignmentProbability,
  shouldSimulateEarlyAssignment,
} from "./volatility";
import type { HistoricalPricePoint } from "@/lib/types";

function generateOhlcPrices(startPrice: number, days: number, dailyVol: number, trend: number = 0): HistoricalPricePoint[] {
  const prices: HistoricalPricePoint[] = [];
  let price = startPrice;
  let seed = 42;
  for (let i = 0; i < days; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const rand = (seed / 0x7fffffff) - 0.5;
    const change = trend + rand * dailyVol;
    const open = price;
    price = price * (1 + change);
    const high = Math.max(open, price) * (1 + Math.abs(rand) * 0.005);
    const low = Math.min(open, price) * (1 - Math.abs(rand) * 0.005);
    const date = new Date(Date.UTC(2020, 0, 1 + i));
    prices.push({
      date: date.toISOString().slice(0, 10),
      open,
      high,
      low,
      close: price,
      adjustedClose: price,
      volume: 1000000,
    });
  }
  return prices;
}

describe("yangZhangVolatility", () => {
  it("returns a positive volatility for sufficient data", () => {
    const prices = generateOhlcPrices(100, 100, 0.02, 0.0005);
    const vol = yangZhangVolatility(prices, 100, 30);
    expect(vol).toBeGreaterThan(0);
    expect(vol).toBeLessThan(2);
  });

  it("returns higher vol for more volatile data", () => {
    const lowVol = generateOhlcPrices(100, 100, 0.005, 0);
    const highVol = generateOhlcPrices(100, 100, 0.05, 0);
    const lv = yangZhangVolatility(lowVol, 100, 30);
    const hv = yangZhangVolatility(highVol, 100, 30);
    expect(hv).toBeGreaterThan(lv);
  });

  it("returns fallback for insufficient data", () => {
    const prices = generateOhlcPrices(100, 10, 0.02, 0);
    const vol = yangZhangVolatility(prices, 10, 30);
    expect(vol).toBe(0.3); // fallback
  });
});

describe("garmanKlassVolatility", () => {
  it("returns a positive volatility for sufficient data", () => {
    const prices = generateOhlcPrices(100, 100, 0.02, 0.0005);
    const vol = garmanKlassVolatility(prices, 100, 30);
    expect(vol).toBeGreaterThan(0);
    expect(vol).toBeLessThan(2);
  });

  it("returns higher vol for more volatile data", () => {
    const lowVol = generateOhlcPrices(100, 100, 0.005, 0);
    const highVol = generateOhlcPrices(100, 100, 0.05, 0);
    const lv = garmanKlassVolatility(lowVol, 100, 30);
    const hv = garmanKlassVolatility(highVol, 100, 30);
    expect(hv).toBeGreaterThan(lv);
  });
});

describe("classifyVolRegime", () => {
  it("classifies low vol when recent << long", () => {
    expect(classifyVolRegime(0.10, 0.30)).toBe("low_vol");
  });

  it("classifies normal vol when recent ≈ long", () => {
    expect(classifyVolRegime(0.25, 0.30)).toBe("normal_vol");
  });

  it("classifies high vol when recent > 1.5× long", () => {
    expect(classifyVolRegime(0.50, 0.30)).toBe("high_vol");
  });

  it("classifies crisis vol when recent > 2× long", () => {
    expect(classifyVolRegime(0.80, 0.30)).toBe("crisis_vol");
  });

  it("returns normal when longVol is 0", () => {
    expect(classifyVolRegime(0.30, 0)).toBe("normal_vol");
  });
});

describe("calibratedVrpMultiplier", () => {
  it("increases multiplier in low vol regime", () => {
    const base = 1.15;
    const m = calibratedVrpMultiplier("low_vol", base);
    expect(m).toBeGreaterThan(base);
  });

  it("keeps multiplier unchanged in normal vol", () => {
    const base = 1.15;
    const m = calibratedVrpMultiplier("normal_vol", base);
    expect(m).toBe(base);
  });

  it("decreases multiplier in high vol regime", () => {
    const base = 1.15;
    const m = calibratedVrpMultiplier("high_vol", base);
    expect(m).toBeLessThan(base);
  });

  it("decreases multiplier most in crisis vol regime", () => {
    const base = 1.15;
    const highM = calibratedVrpMultiplier("high_vol", base);
    const crisisM = calibratedVrpMultiplier("crisis_vol", base);
    expect(crisisM).toBeLessThan(highM);
  });
});

describe("calibratedImpliedVol", () => {
  it("produces IV > RV in normal regime", () => {
    const rv = 0.25;
    const longVol = 0.25;
    const iv = calibratedImpliedVol(rv, longVol, 1.15);
    expect(iv).toBeGreaterThan(rv);
  });

  it("produces lower IV in crisis regime", () => {
    const rv = 0.80;
    const longVol = 0.30;
    const iv = calibratedImpliedVol(rv, longVol, 1.15);
    // In crisis, the multiplier is reduced
    expect(iv).toBeLessThan(rv * 1.15);
  });
});

describe("earlyAssignmentProbability", () => {
  it("returns 0 for OTM puts", () => {
    const prob = earlyAssignmentProbability(110, 100, 0.1, 0.30, 0.05);
    expect(prob).toBe(0);
  });

  it("returns low probability for ATM puts with time remaining", () => {
    const prob = earlyAssignmentProbability(99, 100, 0.1, 0.30, 0.05);
    // Near ATM, extrinsic is still meaningful
    expect(prob).toBeLessThan(0.5);
  });

  it("returns high probability for deep ITM puts near expiry", () => {
    const prob = earlyAssignmentProbability(50, 100, 0.01, 0.30, 0.05);
    // Deep ITM, 1 day to expiry → very high assignment risk
    expect(prob).toBeGreaterThan(0.5);
  });

  it("returns very high probability for deep ITM with no time", () => {
    const prob = earlyAssignmentProbability(50, 100, 0.001, 0.30, 0.05);
    expect(prob).toBeGreaterThanOrEqual(0.6);
  });
});

describe("shouldSimulateEarlyAssignment", () => {
  it("returns false for OTM puts", () => {
    expect(shouldSimulateEarlyAssignment(110, 100, 30, 0.30, 0.05)).toBe(false);
  });

  it("returns true for deep ITM puts near expiry", () => {
    expect(shouldSimulateEarlyAssignment(50, 100, 1, 0.30, 0.05)).toBe(true);
  });

  it("returns false for ATM puts with time remaining", () => {
    expect(shouldSimulateEarlyAssignment(99, 100, 30, 0.30, 0.05)).toBe(false);
  });

  it("respects custom threshold", () => {
    // Deep ITM, near expiry → high probability
    // With threshold 0.95, should not trigger
    expect(shouldSimulateEarlyAssignment(50, 100, 5, 0.30, 0.05, 0.95)).toBe(false);
    // With threshold 0.30, should trigger
    expect(shouldSimulateEarlyAssignment(50, 100, 1, 0.30, 0.05, 0.30)).toBe(true);
  });
});
