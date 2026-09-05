import { describe, it, expect } from "vitest";
import { computeBetaWeightedDelta } from "./beta-risk";
import type { PositionDelta } from "./beta-risk";

describe("computeBetaWeightedDelta", () => {
  it("computes total beta-weighted delta", () => {
    const positions: PositionDelta[] = [
      { symbol: "AAPL", delta: 100, marketValue: 18000, beta: 1.2 },
      { symbol: "MSFT", delta: 50, marketValue: 20000, beta: 0.9 },
    ];
    const result = computeBetaWeightedDelta(positions, 500);
    // Total = 100*1.2 + 50*0.9 = 165
    expect(result.totalBetaWeightedDelta).toBe(165);
  });

  it("computes SPY equivalent exposure", () => {
    const positions: PositionDelta[] = [
      { symbol: "AAPL", delta: 100, marketValue: 18000, beta: 1.2 },
    ];
    const result = computeBetaWeightedDelta(positions, 500);
    // 100 * 1.2 * 500 = 60000
    expect(result.spyEquivalentExposure).toBe(60000);
  });

  it("identifies bullish directional bias", () => {
    const positions: PositionDelta[] = [
      { symbol: "AAPL", delta: 200, marketValue: 36000, beta: 1.3 },
    ];
    const result = computeBetaWeightedDelta(positions, 500);
    expect(result.directionalBias).toBe("bullish");
  });

  it("identifies bearish directional bias", () => {
    const positions: PositionDelta[] = [
      { symbol: "AAPL", delta: -200, marketValue: 36000, beta: 1.3 },
    ];
    const result = computeBetaWeightedDelta(positions, 500);
    expect(result.directionalBias).toBe("bearish");
  });

  it("identifies neutral directional bias", () => {
    const positions: PositionDelta[] = [
      { symbol: "AAPL", delta: 10, marketValue: 1800, beta: 1.0 },
    ];
    const result = computeBetaWeightedDelta(positions, 500);
    expect(result.directionalBias).toBe("neutral");
  });

  it("flags highly concentrated portfolio", () => {
    const positions: PositionDelta[] = [
      { symbol: "AAPL", delta: 100, marketValue: 45000, beta: 1.2 },
      { symbol: "MSFT", delta: 50, marketValue: 5000, beta: 0.9 },
    ];
    const result = computeBetaWeightedDelta(positions, 500);
    expect(result.concentrationRisk.riskLevel).toBe("highly_concentrated");
    expect(result.concentrationRisk.maxSinglePosition).toBeCloseTo(0.9, 2);
    expect(result.concentrationRisk.warnings.length).toBe(2);
    expect(result.concentrationRisk.warnings[0]).toContain("exceeds 40%");
    expect(result.concentrationRisk.warnings[1]).toContain("exceed 80%");
  });

  it("flags diversified portfolio", () => {
    const positions: PositionDelta[] = Array.from({ length: 10 }, (_, i) => ({
      symbol: `S${i}`,
      delta: 20,
      marketValue: 10000,
      beta: 1.0,
    }));
    const result = computeBetaWeightedDelta(positions, 500);
    expect(result.concentrationRisk.riskLevel).toBe("diversified");
    expect(result.concentrationRisk.maxSinglePosition).toBeCloseTo(0.1, 2);
  });

  it("computes Herfindahl index correctly", () => {
    // 2 equal positions: H = 0.5^2 + 0.5^2 = 0.5
    const positions: PositionDelta[] = [
      { symbol: "A", delta: 100, marketValue: 10000, beta: 1.0 },
      { symbol: "B", delta: 100, marketValue: 10000, beta: 1.0 },
    ];
    const result = computeBetaWeightedDelta(positions, 500);
    expect(result.concentrationRisk.herfindahlIndex).toBeCloseTo(0.5, 2);
  });

  it("handles empty portfolio", () => {
    const result = computeBetaWeightedDelta([], 500);
    expect(result.totalBetaWeightedDelta).toBe(0);
    expect(result.totalMarketValue).toBe(0);
    expect(result.concentrationRisk.riskLevel).toBe("diversified");
  });
});
