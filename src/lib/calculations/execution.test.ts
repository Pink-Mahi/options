import { describe, it, expect } from "vitest";
import { estimateExecution, estimateFillProbability } from "./execution";

describe("estimateExecution", () => {
  it("market order pays the ask plus impact", () => {
    const result = estimateExecution({
      bid: 1.00, ask: 1.10, volume: 500, openInterest: 1000,
      orderSize: 1, orderType: "MARKET",
    });
    expect(result.estimatedFillPrice).toBeGreaterThanOrEqual(1.10);
    expect(result.slippage).toBeGreaterThan(0);
    expect(result.fillProbability).toBeGreaterThan(0.9);
  });

  it("limit order at ask has high fill probability", () => {
    const result = estimateExecution({
      bid: 1.00, ask: 1.10, volume: 500, openInterest: 1000,
      orderSize: 1, orderType: "LIMIT", limitPrice: 1.10,
    });
    expect(result.fillProbability).toBeGreaterThan(0.9);
  });

  it("limit order at bid has low fill probability", () => {
    const result = estimateExecution({
      bid: 1.00, ask: 1.10, volume: 500, openInterest: 1000,
      orderSize: 1, orderType: "LIMIT", limitPrice: 1.00,
    });
    expect(result.fillProbability).toBeLessThan(0.4);
  });

  it("mid order has moderate fill probability", () => {
    const result = estimateExecution({
      bid: 1.00, ask: 1.10, volume: 500, openInterest: 1000,
      orderSize: 1, orderType: "MID",
    });
    expect(result.estimatedFillPrice).toBeCloseTo(1.05, 2);
    expect(result.slippage).toBe(0);
    expect(result.fillProbability).toBeLessThan(0.6);
  });

  it("warns on wide spread", () => {
    const result = estimateExecution({
      bid: 0.50, ask: 0.80, volume: 100, openInterest: 50,
      orderSize: 1, orderType: "MARKET",
    });
    expect(result.warning).not.toBeNull();
    expect(result.warning).toContain("Wide spread");
  });

  it("warns on low open interest", () => {
    const result = estimateExecution({
      bid: 1.00, ask: 1.05, volume: 500, openInterest: 50,
      orderSize: 1, orderType: "MARKET",
    });
    expect(result.warning).not.toBeNull();
    expect(result.warning).toContain("Low open interest");
  });

  it("large order has market impact", () => {
    const small = estimateExecution({
      bid: 1.00, ask: 1.10, volume: 1000, openInterest: 5000,
      orderSize: 1, orderType: "MARKET",
    });
    const large = estimateExecution({
      bid: 1.00, ask: 1.10, volume: 1000, openInterest: 5000,
      orderSize: 100, orderType: "MARKET",
    });
    expect(large.marketImpact).toBeGreaterThan(small.marketImpact);
  });
});

describe("estimateFillProbability", () => {
  it("aggressive limit has higher fill probability", () => {
    const aggressive = estimateFillProbability(0.3, 30, 0.02, 1, 0.05);
    const passive = estimateFillProbability(0.3, 30, 0.02, 1, -0.05);
    expect(aggressive).toBeGreaterThan(passive);
  });

  it("wider spread reduces fill probability", () => {
    const tight = estimateFillProbability(0.3, 30, 0.01, 1, 0);
    const wide = estimateFillProbability(0.3, 30, 0.05, 1, 0);
    expect(tight).toBeGreaterThan(wide);
  });

  it("larger order reduces fill probability", () => {
    const small = estimateFillProbability(0.3, 30, 0.02, 1, 0);
    const large = estimateFillProbability(0.3, 30, 0.02, 100, 0);
    expect(small).toBeGreaterThan(large);
  });

  it("returns value between 0 and 1", () => {
    const prob = estimateFillProbability(0.5, 45, 0.03, 10, 0.02);
    expect(prob).toBeGreaterThan(0);
    expect(prob).toBeLessThan(1);
  });
});
