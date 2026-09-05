import { describe, it, expect } from "vitest";
import {
  blackScholes,
  binomialAmerican,
  impliedVolatility,
  probabilityOfTouch,
  analyzeTheoreticalValue,
  fillMissingGreeks,
} from "./pricing-model";

describe("blackScholes", () => {
  it("prices an ATM call correctly", () => {
    const result = blackScholes({
      spot: 100,
      strike: 100,
      timeToExpiry: 1,
      riskFreeRate: 0.05,
      volatility: 0.2,
      optionType: "CALL",
    });
    // Known value: ~10.45
    expect(result.price).toBeCloseTo(10.45, 1);
    expect(result.greeks.delta).toBeCloseTo(0.6368, 2);
    expect(result.greeks.gamma).toBeGreaterThan(0);
    expect(result.greeks.vega).toBeGreaterThan(0);
    expect(result.greeks.theta).toBeLessThan(0);
  });

  it("prices an ATM put correctly", () => {
    const result = blackScholes({
      spot: 100,
      strike: 100,
      timeToExpiry: 1,
      riskFreeRate: 0.05,
      volatility: 0.2,
      optionType: "PUT",
    });
    // Put-call parity: put = call - S + K*e^(-rT)
    // ~10.45 - 100 + 95.12 = ~5.57
    expect(result.price).toBeCloseTo(5.57, 1);
    expect(result.greeks.delta).toBeLessThan(0);
  });

  it("prices ITM call higher than ATM call", () => {
    const atm = blackScholes({ spot: 100, strike: 100, timeToExpiry: 0.25, riskFreeRate: 0.05, volatility: 0.3, optionType: "CALL" });
    const itm = blackScholes({ spot: 110, strike: 100, timeToExpiry: 0.25, riskFreeRate: 0.05, volatility: 0.3, optionType: "CALL" });
    expect(itm.price).toBeGreaterThan(atm.price);
  });

  it("returns intrinsic value at expiry", () => {
    const result = blackScholes({
      spot: 105,
      strike: 100,
      timeToExpiry: 0,
      riskFreeRate: 0.05,
      volatility: 0.2,
      optionType: "CALL",
    });
    expect(result.price).toBe(5);
    expect(result.greeks.gamma).toBe(0);
  });

  it("handles dividend yield", () => {
    const noDiv = blackScholes({ spot: 100, strike: 100, timeToExpiry: 1, riskFreeRate: 0.05, volatility: 0.2, optionType: "CALL" });
    const withDiv = blackScholes({ spot: 100, strike: 100, timeToExpiry: 1, riskFreeRate: 0.05, volatility: 0.2, dividendYield: 0.03, optionType: "CALL" });
    // Dividend yield reduces call price
    expect(withDiv.price).toBeLessThan(noDiv.price);
  });

  it("satisfies put-call parity", () => {
    const S = 100, K = 100, T = 1, r = 0.05, sigma = 0.2;
    const call = blackScholes({ spot: S, strike: K, timeToExpiry: T, riskFreeRate: r, volatility: sigma, optionType: "CALL" });
    const put = blackScholes({ spot: S, strike: K, timeToExpiry: T, riskFreeRate: r, volatility: sigma, optionType: "PUT" });
    // C - P = S - K*e^(-rT)
    const parity = S - K * Math.exp(-r * T);
    expect(call.price - put.price).toBeCloseTo(parity, 4);
  });
});

describe("binomialAmerican", () => {
  it("prices an American call close to European for no dividends", () => {
    const euro = blackScholes({ spot: 100, strike: 100, timeToExpiry: 0.5, riskFreeRate: 0.05, volatility: 0.3, optionType: "CALL" });
    const amer = binomialAmerican({ spot: 100, strike: 100, timeToExpiry: 0.5, riskFreeRate: 0.05, volatility: 0.3, optionType: "CALL", steps: 200 });
    // Without dividends, American call = European call (no early exercise)
    expect(amer.price).toBeCloseTo(euro.price, 1);
  });

  it("American put is worth >= European put", () => {
    const euro = blackScholes({ spot: 90, strike: 100, timeToExpiry: 0.5, riskFreeRate: 0.05, volatility: 0.3, optionType: "PUT" });
    const amer = binomialAmerican({ spot: 90, strike: 100, timeToExpiry: 0.5, riskFreeRate: 0.05, volatility: 0.3, optionType: "PUT", steps: 200 });
    expect(amer.price).toBeGreaterThanOrEqual(euro.price - 0.1);
  });

  it("returns intrinsic value at expiry", () => {
    const result = binomialAmerican({ spot: 95, strike: 100, timeToExpiry: 0, riskFreeRate: 0.05, volatility: 0.3, optionType: "PUT" });
    expect(result.price).toBe(5);
  });

  it("produces valid Greeks", () => {
    const result = binomialAmerican({ spot: 100, strike: 100, timeToExpiry: 0.25, riskFreeRate: 0.05, volatility: 0.3, optionType: "PUT", steps: 200 });
    expect(result.greeks.delta).toBeLessThan(0);
    expect(result.greeks.gamma).toBeGreaterThan(0);
    expect(result.greeks.vega).toBeGreaterThan(0);
  });
});

describe("impliedVolatility", () => {
  it("recovers the volatility used to generate a price", () => {
    const sigma = 0.35;
    const result = blackScholes({ spot: 100, strike: 105, timeToExpiry: 0.5, riskFreeRate: 0.05, volatility: sigma, optionType: "CALL" });
    const iv = impliedVolatility(result.price, 100, 105, 0.5, 0.05, "CALL");
    expect(iv).not.toBeNull();
    expect(iv!).toBeCloseTo(sigma, 3);
  });

  it("returns null for zero market price", () => {
    const iv = impliedVolatility(0, 100, 100, 0.5, 0.05, "CALL");
    expect(iv).toBeNull();
  });

  it("returns null for price below intrinsic", () => {
    const iv = impliedVolatility(0.01, 200, 100, 0.5, 0.05, "CALL");
    expect(iv).toBeNull();
  });

  it("works for puts", () => {
    const sigma = 0.4;
    const result = blackScholes({ spot: 95, strike: 100, timeToExpiry: 0.25, riskFreeRate: 0.05, volatility: sigma, optionType: "PUT" });
    const iv = impliedVolatility(result.price, 95, 100, 0.25, 0.05, "PUT");
    expect(iv).not.toBeNull();
    expect(iv!).toBeCloseTo(sigma, 3);
  });
});

describe("probabilityOfTouch", () => {
  it("returns 1 when spot equals barrier", () => {
    const prob = probabilityOfTouch(100, 100, 0.25, 0.3);
    expect(prob).toBe(1);
  });

  it("returns higher probability for closer barrier", () => {
    const farBarrier = probabilityOfTouch(100, 130, 0.08, 0.2)!;
    const nearBarrier = probabilityOfTouch(100, 110, 0.08, 0.2)!;
    expect(nearBarrier).toBeGreaterThan(farBarrier);
  });

  it("returns higher probability with more time", () => {
    const shortTime = probabilityOfTouch(100, 130, 0.08, 0.2)!;
    const longTime = probabilityOfTouch(100, 130, 1.0, 0.2)!;
    expect(longTime).toBeGreaterThan(shortTime);
  });

  it("returns higher probability with higher volatility", () => {
    const lowVol = probabilityOfTouch(100, 130, 0.25, 0.15)!;
    const highVol = probabilityOfTouch(100, 130, 0.25, 0.4)!;
    expect(highVol).toBeGreaterThan(lowVol);
  });

  it("returns null for invalid inputs", () => {
    expect(probabilityOfTouch(0, 100, 0.25, 0.3)).toBeNull();
    expect(probabilityOfTouch(100, 100, 0, 0.3)).toBeNull();
  });

  it("probability of touch >= probability of finishing ITM", () => {
    // For a call with strike 110, prob of touching 110 should be >= delta (prob ITM)
    const bs = blackScholes({ spot: 100, strike: 110, timeToExpiry: 0.25, riskFreeRate: 0.05, volatility: 0.3, optionType: "CALL" });
    const touchProb = probabilityOfTouch(100, 110, 0.25, 0.3, 0.05)!;
    expect(touchProb).toBeGreaterThanOrEqual(bs.greeks.delta! - 0.01);
  });
});

describe("analyzeTheoreticalValue", () => {
  it("identifies overpriced option when IV > reference vol", () => {
    const refVol = 0.2;
    const richPrice = blackScholes({ spot: 100, strike: 100, timeToExpiry: 0.5, riskFreeRate: 0.05, volatility: 0.4, optionType: "CALL" }).price;
    const analysis = analyzeTheoreticalValue(richPrice, 100, 100, 0.5, 0.05, "CALL", refVol);
    expect(analysis.label).toBe("overpriced");
    expect(analysis.impliedVol).toBeGreaterThan(refVol);
    expect(analysis.volEdge).toBeGreaterThan(0);
  });

  it("identifies underpriced option when IV < reference vol", () => {
    const refVol = 0.4;
    const cheapPrice = blackScholes({ spot: 100, strike: 100, timeToExpiry: 0.5, riskFreeRate: 0.05, volatility: 0.15, optionType: "CALL" }).price;
    const analysis = analyzeTheoreticalValue(cheapPrice, 100, 100, 0.5, 0.05, "CALL", refVol);
    expect(analysis.label).toBe("underpriced");
    expect(analysis.impliedVol).toBeLessThan(refVol);
  });

  it("identifies fairly priced option", () => {
    const refVol = 0.3;
    const fairPrice = blackScholes({ spot: 100, strike: 100, timeToExpiry: 0.5, riskFreeRate: 0.05, volatility: refVol, optionType: "CALL" }).price;
    const analysis = analyzeTheoreticalValue(fairPrice, 100, 100, 0.5, 0.05, "CALL", refVol);
    expect(analysis.label).toBe("fairly_priced");
  });
});

describe("fillMissingGreeks", () => {
  it("fills missing Greeks using Black-Scholes", () => {
    const result = fillMissingGreeks({
      strike: 100,
      underlyingPrice: 100,
      daysToExpiration: 90,
      impliedVolatility: 0.3,
      greeks: { delta: null, gamma: null, theta: null, vega: null, rho: null },
      optionType: "CALL",
      midpoint: 5,
      bid: 4.9,
      ask: 5.1,
      last: 5,
    });
    expect(result.greeks.delta).not.toBeNull();
    expect(result.greeks.gamma).not.toBeNull();
    expect(result.greeks.theta).not.toBeNull();
    expect(result.greeks.vega).not.toBeNull();
    expect(result.greeksProvenance).toBe("calculated");
  });

  it("does not overwrite provider Greeks", () => {
    const result = fillMissingGreeks({
      strike: 100,
      underlyingPrice: 100,
      daysToExpiration: 90,
      impliedVolatility: 0.3,
      greeks: { delta: 0.5, gamma: 0.02, theta: -0.05, vega: 0.15, rho: 0.01 },
      optionType: "CALL",
      midpoint: 5,
      bid: 4.9,
      ask: 5.1,
      last: 5,
    });
    expect(result.greeks.delta).toBe(0.5);
    expect(result.greeks.gamma).toBe(0.02);
    expect(result.greeksProvenance).toBe("provider");
  });

  it("solves IV when missing", () => {
    const result = fillMissingGreeks({
      strike: 100,
      underlyingPrice: 100,
      daysToExpiration: 365,
      impliedVolatility: null,
      greeks: { delta: null, gamma: null, theta: null, vega: null, rho: null },
      optionType: "CALL",
      midpoint: 10.45,
      bid: 10.4,
      ask: 10.5,
      last: 10.45,
    });
    expect(result.impliedVolatility).not.toBeNull();
    expect(result.impliedVolatility).toBeCloseTo(0.2, 1);
  });
});
