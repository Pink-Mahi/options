import { describe, expect, it } from "vitest";
import {
  assignmentStockGainPerShare,
  breakEvenForCall,
  cspBreakEven,
  discountToCurrentPrice,
  downsideProtectionPercent,
  effectivePurchasePrice,
  grossCollateral,
  maxProfitPerShareForCall,
  maxTotalReturnForCall,
  maxTotalReturnOnCostForCall,
  netCapitalAtRisk,
  premiumYield,
  premiumYieldOnCost,
  returnOnGrossCollateral,
  returnOnNetCapital,
  totalAssignedProfit,
} from "./returns";

describe("covered call returns", () => {
  it("premiumYield = income / market value", () => {
    expect(premiumYield(485, 100 * 100)).toBe(0.0485);
  });
  it("premiumYieldOnCost = income / cost basis", () => {
    expect(premiumYieldOnCost(485, 155 * 100)).toBeCloseTo(485 / 15500, 10);
  });
  it("maxProfitPerShare = premium + max(0, strike - current)", () => {
    expect(maxProfitPerShareForCall(12, 130, 100)).toBe(42);
    expect(maxProfitPerShareForCall(12, 90, 100)).toBe(12); // no appreciation
  });
  it("maxTotalReturn = maxProfit / current", () => {
    expect(maxTotalReturnForCall(42, 100)).toBe(0.42);
  });
  it("maxTotalReturnOnCost", () => {
    // premium 12 + (130 - 115) = 27, / 115
    expect(maxTotalReturnOnCostForCall(12, 130, 115)).toBeCloseTo(27 / 115, 10);
  });
  it("breakEven = reference - premium", () => {
    expect(breakEvenForCall(100, 12)).toBe(88);
  });
  it("downsideProtection = premium / current", () => {
    expect(downsideProtectionPercent(12, 100)).toBe(0.12);
  });
  it("assignmentStockGainPerShare = strike - costBasis", () => {
    expect(assignmentStockGainPerShare(130, 115)).toBe(15);
  });
  it("totalAssignedProfit = gain*shares + premiumIncome", () => {
    // 15 * 100 + 1200 = 2700
    expect(totalAssignedProfit(130, 115, 100, 1200)).toBe(2700);
  });
});

describe("cash-secured put returns", () => {
  it("grossCollateral = strike * 100 * contracts", () => {
    expect(grossCollateral(90, 1)).toBe(9000);
    expect(grossCollateral(90, 2)).toBe(18000);
  });
  it("netCapitalAtRisk = gross - premium", () => {
    expect(netCapitalAtRisk(9000, 500)).toBe(8500);
  });
  it("returnOnGrossCollateral", () => {
    expect(returnOnGrossCollateral(500, 9000)).toBeCloseTo(500 / 9000, 10);
  });
  it("returnOnNetCapital", () => {
    expect(returnOnNetCapital(500, 8500)).toBeCloseTo(500 / 8500, 10);
  });
  it("effectivePurchasePrice = strike - premium", () => {
    expect(effectivePurchasePrice(90, 5)).toBe(85);
  });
  it("cspBreakEven = strike - premium", () => {
    expect(cspBreakEven(90, 5)).toBe(85);
  });
  it("discountToCurrentPrice = (current - effective) / current", () => {
    // (100 - 85) / 100 = 0.15
    expect(discountToCurrentPrice(100, 85)).toBe(0.15);
  });
});
