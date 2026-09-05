import { describe, expect, it } from "vitest";
import {
  bidAskSpread,
  bidAskSpreadPercent,
  compoundAnnualizedRate,
  daysBetween,
  estimatedAssignmentProbability,
  eventBeforeExpiration,
  extrinsicValue,
  intrinsicValue,
  liquidityScore,
  premiumIncome,
  premiumPerContract,
  resolveOptionPrice,
  simpleAnnualizedRate,
  strikeDiscountPercent,
  strikeOtmPercent,
} from "./core";

describe("intrinsicValue", () => {
  it("call intrinsic = max(0, stock - strike)", () => {
    expect(intrinsicValue("CALL", 100, 90)).toBe(10);
    expect(intrinsicValue("CALL", 90, 100)).toBe(0);
    expect(intrinsicValue("CALL", 100, 100)).toBe(0);
  });
  it("put intrinsic = max(0, strike - stock)", () => {
    expect(intrinsicValue("PUT", 90, 100)).toBe(10);
    expect(intrinsicValue("PUT", 100, 90)).toBe(0);
  });
});

describe("extrinsicValue", () => {
  it("extrinsic = price - intrinsic, clamped >= 0", () => {
    expect(extrinsicValue("CALL", 100, 90, 12)).toBe(2);
    expect(extrinsicValue("CALL", 90, 100, 5)).toBe(5);
    expect(extrinsicValue("CALL", 100, 90, 8)).toBe(0); // would be -2, clamped
  });
});

describe("resolveOptionPrice", () => {
  const contract = { bid: 4.7, ask: 5.0, midpoint: 4.85, last: 4.9 };
  it("uses midpoint by default", () => {
    expect(resolveOptionPrice(contract, "midpoint").pricePerShare).toBe(4.85);
  });
  it("uses bid", () => {
    expect(resolveOptionPrice(contract, "bid").pricePerShare).toBe(4.7);
  });
  it("uses ask", () => {
    expect(resolveOptionPrice(contract, "ask").pricePerShare).toBe(5.0);
  });
  it("uses last", () => {
    expect(resolveOptionPrice(contract, "last").pricePerShare).toBe(4.9);
  });
  it("uses custom", () => {
    expect(resolveOptionPrice(contract, "custom", 4.8).pricePerShare).toBe(4.8);
  });
  it("falls back when midpoint null", () => {
    const c = { bid: 4.7 as number | null, ask: 5.0 as number | null, midpoint: null, last: 4.9 as number | null };
    expect(resolveOptionPrice(c, "midpoint").pricePerShare).toBe(4.85);
  });
});

describe("premiumIncome / premiumPerContract", () => {
  it("premium per contract = perShare * 100", () => {
    expect(premiumPerContract(4.85)).toBeCloseTo(485, 6);
  });
  it("premium income scales with contracts", () => {
    expect(premiumIncome(4.85, 3)).toBeCloseTo(1455, 6);
  });
});

describe("annualization", () => {
  it("simple annualized = periodReturn * 365/DTE", () => {
    expect(simpleAnnualizedRate(0.02, 30)).toBeCloseTo(0.02 * (365 / 30), 10);
  });
  it("compound annualized = (1+r)^(365/DTE) - 1", () => {
    expect(compoundAnnualizedRate(0.02, 30)).toBeCloseTo(
      Math.pow(1.02, 365 / 30) - 1,
      10,
    );
  });
  it("DTE <= 0 returns 0", () => {
    expect(simpleAnnualizedRate(0.02, 0)).toBe(0);
    expect(compoundAnnualizedRate(0.02, 0)).toBe(0);
  });
});

describe("strike distance", () => {
  it("OTM% for call", () => {
    expect(strikeOtmPercent(130, 100)).toBe(0.3);
    expect(strikeOtmPercent(110, 100)).toBe(0.1);
  });
  it("discount% for put", () => {
    expect(strikeDiscountPercent(90, 100)).toBe(0.1);
  });
});

describe("liquidity", () => {
  it("spread = ask - bid", () => {
    expect(bidAskSpread(4.7, 5.0)).toBeCloseTo(0.3, 10);
    expect(bidAskSpread(null, 5.0)).toBeNull();
  });
  it("spread% = (ask-bid)/mid", () => {
    expect(bidAskSpreadPercent(4.7, 5.0)).toBeCloseTo(0.3 / 4.85, 8);
  });
  it("liquidity score increases with OI/volume and tight spread", () => {
    const good = liquidityScore({ openInterest: 1000, volume: 500, bidAskSpreadPercent: 0.005 });
    const bad = liquidityScore({ openInterest: 5, volume: 1, bidAskSpreadPercent: 0.25 });
    expect(good).toBeGreaterThan(bad);
    expect(good).toBeLessThanOrEqual(100);
    expect(bad).toBeGreaterThanOrEqual(0);
  });
});

describe("assignment probability", () => {
  it("call uses delta directly", () => {
    expect(estimatedAssignmentProbability(0.2, "CALL")).toBe(0.2);
  });
  it("put uses |delta|", () => {
    expect(estimatedAssignmentProbability(-0.2, "PUT")).toBe(0.2);
  });
  it("null delta -> null", () => {
    expect(estimatedAssignmentProbability(null, "CALL")).toBeNull();
  });
  it("clamps to [0,1]", () => {
    expect(estimatedAssignmentProbability(1.5, "CALL")).toBe(1);
  });
});

describe("date helpers", () => {
  it("daysBetween", () => {
    expect(daysBetween("2026-01-01", "2026-02-01")).toBe(31);
  });
  it("eventBeforeExpiration", () => {
    expect(eventBeforeExpiration("2026-01-15", "2026-02-15")).toBe(true);
    expect(eventBeforeExpiration("2026-03-15", "2026-02-15")).toBe(false);
    expect(eventBeforeExpiration(null, "2026-02-15")).toBe(false);
  });
});
