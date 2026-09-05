import { describe, it, expect } from "vitest";
import { computeCostAwareLevels, computeVolTargetSizing } from "./position-sizing";

describe("computeCostAwareLevels", () => {
  it("computes long entry/stop/target for bullish signal", () => {
    const r = computeCostAwareLevels({
      spot: 100,
      volatility: 0.30,
      holdingDays: 30,
      signalScore: 0.5,
      costBps: 0.001, // 10bps round-trip
    });
    // expectedMove = 100 * 0.30 * sqrt(30/252) = 10.3510
    // halfCost = 100 * 0.001 / 2 = 0.05
    // entry = 100 + 0.05 = 100.05
    // stop = 100.05 - 1.5 * 10.3510 = 100.05 - 15.5265 = 84.5235
    // target = 100.05 + 2.0 * 10.3510 = 100.05 + 20.7020 = 120.7520
    expect(r.direction).toBe("LONG");
    expect(r.entryPrice).toBeCloseTo(100.05, 2);
    expect(r.stopLoss).toBeCloseTo(84.5235, 3);
    expect(r.takeProfit).toBeCloseTo(120.7520, 3);
    expect(r.expectedMove).toBeCloseTo(10.3510, 3);
    expect(r.expectedMovePct).toBeCloseTo(0.1035, 3);
  });

  it("computes short entry/stop/target for bearish signal", () => {
    const r = computeCostAwareLevels({
      spot: 50,
      volatility: 0.40,
      holdingDays: 10,
      signalScore: -0.3,
      costBps: 0.002,
    });
    // expectedMove = 50 * 0.40 * sqrt(10/252) = 50 * 0.40 * 0.1992 = 3.9841
    // halfCost = 50 * 0.002 / 2 = 0.05
    // entry = 50 - 0.05 = 49.95
    // stop = 49.95 + 1.5 * 3.9841 = 49.95 + 5.9762 = 55.9262
    // target = 49.95 - 2.0 * 3.9841 = 49.95 - 7.9682 = 41.9818
    expect(r.direction).toBe("SHORT");
    expect(r.entryPrice).toBeCloseTo(49.95, 2);
    expect(r.stopLoss).toBeCloseTo(55.9262, 3);
    expect(r.takeProfit).toBeCloseTo(41.9818, 3);
  });

  it("computes risk-reward ratio correctly", () => {
    const r = computeCostAwareLevels({
      spot: 100,
      volatility: 0.20,
      holdingDays: 45,
      signalScore: 0.8,
      costBps: 0.001,
      stopMultiplier: 1.0,
      targetMultiplier: 2.0,
    });
    // With stopMultiplier=1.0 and targetMultiplier=2.0:
    // risk = 1.0 * expectedMove, reward = 2.0 * expectedMove
    // riskReward = 2.0
    expect(r.riskRewardRatio).toBeCloseTo(2.0, 2);
    expect(r.riskPerShare).toBeGreaterThan(0);
    expect(r.rewardPerShare).toBeGreaterThan(r.riskPerShare);
  });

  it("computes breakeven and cost drag", () => {
    const r = computeCostAwareLevels({
      spot: 200,
      volatility: 0.25,
      holdingDays: 30,
      signalScore: 0.5,
      costBps: 0.001,
    });
    // breakevenMove = 200 * 0.001 = 0.20
    // expectedMove = 200 * 0.25 * sqrt(30/252) = 200 * 0.25 * 0.3450 = 17.2502
    // costDragPct = 0.20 / 17.2502 = 0.01159
    expect(r.breakevenMove).toBeCloseTo(0.20, 2);
    expect(r.costDragPct).toBeCloseTo(0.0116, 3);
  });

  it("higher cost increases entry price for longs", () => {
    const cheap = computeCostAwareLevels({
      spot: 100, volatility: 0.30, holdingDays: 30, signalScore: 0.5, costBps: 0.0005,
    });
    const expensive = computeCostAwareLevels({
      spot: 100, volatility: 0.30, holdingDays: 30, signalScore: 0.5, costBps: 0.005,
    });
    expect(expensive.entryPrice).toBeGreaterThan(cheap.entryPrice);
    expect(expensive.costDragPct).toBeGreaterThan(cheap.costDragPct);
  });
});

describe("computeVolTargetSizing", () => {
  it("sizes position to target volatility", () => {
    const r = computeVolTargetSizing({
      capital: 100000,
      assetVol: 0.30,
      targetVol: 0.15,
      price: 100,
    });
    // weight = 0.15 / 0.30 = 0.50
    // positionValue = 100000 * 0.50 = 50000
    // units = floor(50000 / 100) = 500
    expect(r.weight).toBeCloseTo(0.50, 4);
    expect(r.units).toBe(500);
    expect(r.positionValue).toBeCloseTo(50000, 2);
    expect(r.actualVolContribution).toBeCloseTo(0.15, 4);
    expect(r.leverageCapped).toBe(false);
    expect(r.kellyCapped).toBe(false);
  });

  it("caps at maximum leverage", () => {
    const r = computeVolTargetSizing({
      capital: 100000,
      assetVol: 0.10,
      targetVol: 0.30,
      price: 100,
      maxLeverage: 2.0,
    });
    // baseWeight = 0.30 / 0.10 = 3.0, but capped at 2.0
    expect(r.weight).toBeCloseTo(2.0, 4);
    expect(r.leverageCapped).toBe(true);
    expect(r.warnings.some((w) => w.includes("Leverage cap"))).toBe(true);
  });

  it("applies Kelly cap when expected return is low", () => {
    const r = computeVolTargetSizing({
      capital: 100000,
      assetVol: 0.40,
      targetVol: 0.20,
      price: 100,
      expectedReturn: 0.06,
      riskFreeRate: 0.05,
      kellyFraction: 0.25,
    });
    // kellyWeight = (0.06 - 0.05) / 0.40^2 = 0.01 / 0.16 = 0.0625
    // kellyCap = 0.0625 * 0.25 = 0.015625
    // baseWeight = 0.20 / 0.40 = 0.50
    // final = min(0.50, 0.015625, 2.0) = 0.015625
    expect(r.kellyWeight).toBeCloseTo(0.0625, 4);
    expect(r.weight).toBeCloseTo(0.0156, 3);
    expect(r.kellyCapped).toBe(true);
    expect(r.warnings.some((w) => w.includes("Kelly cap"))).toBe(true);
  });

  it("returns zero when Kelly weight is negative", () => {
    const r = computeVolTargetSizing({
      capital: 100000,
      assetVol: 0.30,
      targetVol: 0.15,
      price: 100,
      expectedReturn: 0.02,
      riskFreeRate: 0.05,
    });
    // kellyWeight = (0.02 - 0.05) / 0.09 = -0.333
    expect(r.weight).toBe(0);
    expect(r.units).toBe(0);
    expect(r.kellyCapped).toBe(true);
    expect(r.warnings.some((w) => w.includes("negative"))).toBe(true);
  });

  it("returns zero for zero volatility", () => {
    const r = computeVolTargetSizing({
      capital: 100000,
      assetVol: 0,
      targetVol: 0.15,
      price: 100,
    });
    expect(r.weight).toBe(0);
    expect(r.units).toBe(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("computes units as integer floor", () => {
    const r = computeVolTargetSizing({
      capital: 10000,
      assetVol: 0.25,
      targetVol: 0.12,
      price: 73,
    });
    // weight = 0.12 / 0.25 = 0.48
    // positionValue = 10000 * 0.48 = 4800
    // units = floor(4800 / 73) = floor(65.75) = 65
    expect(r.weight).toBeCloseTo(0.48, 4);
    expect(r.units).toBe(65);
  });
});
