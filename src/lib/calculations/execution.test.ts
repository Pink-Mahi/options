import { describe, it, expect } from "vitest";
import { estimateExecution, estimateFillProbability } from "./execution";

describe("estimateExecution", () => {
  it("market order pays the ask plus impact", () => {
    const result = estimateExecution({
      bid: 1.00, ask: 1.10, volume: 500, openInterest: 1000,
      orderSize: 1, orderType: "MARKET",
    });
    // mid=1.05, spread=0.10, volumeRatio=1/500=0.002, impact=0.10*0.002*0.5=0.0001
    // fill=1.10+0.0001=1.1001, slippage=1.1001-1.05=0.0501
    expect(result.estimatedFillPrice).toBeCloseTo(1.1001, 4);
    expect(result.slippage).toBeCloseTo(0.0501, 4);
    expect(result.fillProbability).toBe(0.95);
    expect(result.marketImpact).toBeCloseTo(0.0001, 6);
  });

  it("limit order at ask has high fill probability", () => {
    const result = estimateExecution({
      bid: 1.00, ask: 1.10, volume: 500, openInterest: 1000,
      orderSize: 1, orderType: "LIMIT", limitPrice: 1.10,
    });
    // limitPrice=1.10 >= ask → fillProb=0.95, no size reduction (1<=10)
    expect(result.fillProbability).toBe(0.95);
    expect(result.estimatedFillPrice).toBe(1.10);
    expect(result.slippage).toBeCloseTo(0.05, 2);
  });

  it("limit order at bid has low fill probability", () => {
    const result = estimateExecution({
      bid: 1.00, ask: 1.10, volume: 500, openInterest: 1000,
      orderSize: 1, orderType: "LIMIT", limitPrice: 1.00,
    });
    // limitPrice=1.00 >= bid but < mid → fillProb=0.3
    expect(result.fillProbability).toBe(0.3);
  });

  it("mid order has moderate fill probability", () => {
    const result = estimateExecution({
      bid: 1.00, ask: 1.10, volume: 500, openInterest: 1000,
      orderSize: 1, orderType: "MID",
    });
    // mid=1.05, spread=0.10000000000000009 (FP > 0.10 so wide-spread reduction applies)
    // fillProb = 0.4 * 0.7 = 0.28, volOi=500/1000=0.5 > 0.1 so no liquidity reduction
    expect(result.estimatedFillPrice).toBeCloseTo(1.05, 2);
    expect(result.slippage).toBe(0);
    expect(result.fillProbability).toBeCloseTo(0.28, 2);
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
    // small: volumeRatio=1/1000=0.001, impact=0.10*0.001*0.5=0.00005
    // large: volumeRatio=100/1000=0.1, impact=0.10*0.1*0.5=0.005
    expect(small.marketImpact).toBeCloseTo(0.00005, 7);
    expect(large.marketImpact).toBeCloseTo(0.005, 4);
    expect(large.marketImpact).toBeGreaterThan(small.marketImpact);
  });
});

describe("estimateFillProbability", () => {
  it("aggressive limit has higher fill probability", () => {
    const aggressive = estimateFillProbability(0.3, 30, 0.02, 1, 0.05);
    const passive = estimateFillProbability(0.3, 30, 0.02, 1, -0.05);
    // aggressive: 0.5 + 0.05*2 - 0.02*5 = 0.5 + 0.1 - 0.1 = 0.5
    // passive: 0.5 + (-0.05)*2 - 0.02*5 = 0.5 - 0.1 - 0.1 = 0.3
    expect(aggressive).toBeCloseTo(0.5, 2);
    expect(passive).toBeCloseTo(0.3, 2);
    expect(aggressive).toBeGreaterThan(passive);
  });

  it("wider spread reduces fill probability", () => {
    const tight = estimateFillProbability(0.3, 30, 0.01, 1, 0);
    const wide = estimateFillProbability(0.3, 30, 0.05, 1, 0);
    // tight: 0.5 - 0.01*5 = 0.45
    // wide: 0.5 - 0.05*5 = 0.25
    expect(tight).toBeCloseTo(0.45, 2);
    expect(wide).toBeCloseTo(0.25, 2);
    expect(tight).toBeGreaterThan(wide);
  });

  it("larger order reduces fill probability", () => {
    const small = estimateFillProbability(0.3, 30, 0.02, 1, 0);
    const large = estimateFillProbability(0.3, 30, 0.02, 100, 0);
    // small: 0.5 - 0.02*5 = 0.4 (orderSize 1 <= 10, no reduction)
    // large: 0.4 - 0.1 - 0.15 = 0.15 (orderSize 100 > 50)
    expect(small).toBeCloseTo(0.4, 2);
    expect(large).toBeCloseTo(0.15, 2);
    expect(small).toBeGreaterThan(large);
  });

  it("returns value between 0 and 1", () => {
    const prob = estimateFillProbability(0.5, 45, 0.03, 10, 0.02);
    // 0.5 + 0.02*2 - 0.03*5 + 0.1(delta) + 0.05(dte) = 0.5 + 0.04 - 0.15 + 0.1 + 0.05 = 0.54
    expect(prob).toBeCloseTo(0.54, 2);
    expect(prob).toBeGreaterThan(0);
    expect(prob).toBeLessThan(1);
  });
});
