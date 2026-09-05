import { describe, it, expect } from "vitest";
import { assessAssignmentRisk } from "./assignment-risk";
import type { DividendEvent } from "@/lib/types";

describe("assessAssignmentRisk - short call", () => {
  it("flags high risk when extrinsic < dividend", () => {
    const dividends: DividendEvent[] = [
      { symbol: "TEST", exDate: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), amount: 0.50, payDate: null, frequency: "quarterly" },
    ];
    const result = assessAssignmentRisk("CALL", 90, 100, 10, 0.2, 0.05, dividends);
    // Deep ITM call, extrinsic ~0.124 < 0.50 dividend → very_high
    expect(result.riskLevel).toBe("very_high");
    expect(result.riskScore).toBeCloseTo(0.876, 2);
    expect(result.extrinsicValue).toBeCloseTo(0.124, 2);
    expect(result.daysToExDiv).toBeGreaterThanOrEqual(1);
    expect(result.daysToExDiv).toBeLessThanOrEqual(2);
    expect(result.dividendAmount).toBe(0.5);
    expect(result.reasons.length).toBe(2);
    expect(result.reasons[0]).toContain("Extrinsic value");
    expect(result.reasons[1]).toContain("Ex-div date");
  });

  it("returns none when no dividends and OTM", () => {
    const result = assessAssignmentRisk("CALL", 110, 100, 30, 0.3, 0.05, []);
    expect(result.riskLevel).toBe("none");
    expect(result.extrinsicValue).toBeCloseTo(0.667, 2);
  });

  it("flags near-certain assignment at expiration when ITM", () => {
    const result = assessAssignmentRisk("CALL", 90, 100, 1, 0.1, 0.05, []);
    expect(result.riskScore).toBe(0.6);
    expect(result.reasons).toEqual(["Call is ITM with 2 or fewer DTE: near-certain assignment at expiration."]);
  });

  it("flags deep ITM with minimal extrinsic", () => {
    const result = assessAssignmentRisk("CALL", 70, 100, 5, 0.05, 0.05, []);
    expect(result.riskScore).toBe(0.4);
    expect(result.extrinsicValue).toBeCloseTo(0.048, 2);
    expect(result.reasons).toEqual(["Call is deep ITM with minimal extrinsic value: assignment risk from early exercise."]);
  });
});

describe("assessAssignmentRisk - short put", () => {
  it("flags deep ITM put with minimal extrinsic", () => {
    const result = assessAssignmentRisk("PUT", 100, 70, 5, 0.05, 0.05, []);
    expect(result.riskScore).toBe(0.4);
    expect(result.extrinsicValue).toBe(0);
    expect(result.reasons.length).toBe(2);
    expect(result.reasons[0]).toContain("deep ITM");
    expect(result.reasons[1]).toContain("Interest on strike");
  });

  it("flags near-certain assignment at expiration when ITM", () => {
    const result = assessAssignmentRisk("PUT", 100, 90, 1, 0.1, 0.05, []);
    expect(result.riskScore).toBe(0.6);
    expect(result.reasons.length).toBe(2);
    expect(result.reasons.some((r) => r.includes("2 or fewer DTE"))).toBe(true);
  });

  it("returns none when OTM", () => {
    const result = assessAssignmentRisk("PUT", 90, 100, 30, 0.3, 0.05, []);
    expect(result.riskLevel).toBe("none");
    expect(result.reasons).toEqual(["No significant early-assignment risk factors detected."]);
  });

  it("flags interest on strike exceeding extrinsic", () => {
    // Deep ITM put, long DTE, low vol → interest > extrinsic
    const result = assessAssignmentRisk("PUT", 100, 80, 180, 0.1, 0.08, []);
    expect(result.riskScore).toBe(0.4);
    expect(result.extrinsicValue).toBe(0);
    expect(result.reasons.length).toBe(2);
    expect(result.reasons.some((r) => r.includes("Interest on strike"))).toBe(true);
  });
});

describe("assessAssignmentRisk - general", () => {
  it("provides a recommendation for high risk", () => {
    const dividends: DividendEvent[] = [
      { symbol: "TEST", exDate: new Date(Date.now() + 1 * 86400000).toISOString().slice(0, 10), amount: 1.0, payDate: null, frequency: "quarterly" },
    ];
    const result = assessAssignmentRisk("CALL", 90, 100, 5, 0.15, 0.05, dividends);
    expect(result.riskLevel).toBe("very_high");
    expect(result.riskScore).toBeCloseTo(0.969, 2);
    expect(result.recommendation).toBe("Consider closing the position or rolling before ex-div date to avoid assignment.");
  });

  it("extrinsic value is non-negative", () => {
    const result = assessAssignmentRisk("CALL", 100, 100, 30, 0.3, 0.05, []);
    expect(result.extrinsicValue).toBeCloseTo(3.632, 2);
  });
});
