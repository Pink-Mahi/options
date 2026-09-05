import { describe, expect, it } from "vitest";
import { calculateCoveredCall } from "./covered-call";
import { calculateCashSecuredPut } from "./cash-secured-put";
import { coveredCallPayoff, cashSecuredPutPayoff } from "./payoff";
import { upsideCapCost } from "./opportunity-cost";
import type { OptionContract } from "@/lib/types";

function makeCall(overrides: Partial<OptionContract> = {}): OptionContract {
  return {
    symbol: "AAPL260116C00150000",
    underlyingSymbol: "AAPL",
    optionType: "CALL",
    strike: 150,
    expiration: "2026-01-16",
    daysToExpiration: 60,
    bid: 4.7,
    ask: 5.0,
    midpoint: 4.85,
    last: 4.9,
    volume: 500,
    openInterest: 1200,
    impliedVolatility: 0.32,
    greeks: { delta: 0.23, gamma: 0.02, theta: -0.05, vega: 0.15, rho: 0.01 },
    intrinsicValue: 0,
    extrinsicValue: 4.85,
    inTheMoney: false,
    underlyingPrice: 130,
    quoteTimestamp: "2026-08-23T16:00:00Z",
    greeksProvenance: "provider",
    ...overrides,
  };
}

function makePut(overrides: Partial<OptionContract> = {}): OptionContract {
  return {
    symbol: "AAPL260116P00120000",
    underlyingSymbol: "AAPL",
    optionType: "PUT",
    strike: 120,
    expiration: "2026-01-16",
    daysToExpiration: 60,
    bid: 4.8,
    ask: 5.2,
    midpoint: 5.0,
    last: 5.1,
    volume: 400,
    openInterest: 900,
    impliedVolatility: 0.35,
    greeks: { delta: -0.22, gamma: 0.02, theta: -0.04, vega: 0.16, rho: -0.01 },
    intrinsicValue: 0,
    extrinsicValue: 5.0,
    inTheMoney: false,
    underlyingPrice: 130,
    quoteTimestamp: "2026-08-23T16:00:00Z",
    greeksProvenance: "provider",
    ...overrides,
  };
}

describe("calculateCoveredCall", () => {
  it("computes premium income and yields", () => {
    const c = calculateCoveredCall({
      contract: makeCall(),
      contracts: 1,
      currentPrice: 130,
      costBasisPerShare: 115,
    });
    // midpoint 4.85 -> 485 income, market value 130*100=13000 -> 0.0373
    expect(c.premiumPerShare).toBeCloseTo(4.85, 10);
    expect(c.premiumPerContract).toBeCloseTo(485, 6);
    expect(c.premiumIncome).toBeCloseTo(485, 6);
    expect(c.premiumYield).toBeCloseTo(485 / 13000, 8);
    expect(c.premiumYieldOnCost).toBeCloseTo(485 / 11500, 8);
  });

  it("computes OTM%, appreciation, max total return", () => {
    const c = calculateCoveredCall({
      contract: makeCall({ strike: 150 }),
      contracts: 1,
      currentPrice: 130,
    });
    expect(c.strikeOtmPercent).toBeCloseTo((150 - 130) / 130, 8);
    expect(c.potentialStockAppreciation).toBeCloseTo((150 - 130) / 130, 8);
    // maxProfit = 4.85 + (150-130) = 24.85, /130
    expect(c.maxProfitPerShare).toBeCloseTo(24.85, 6);
    expect(c.maxTotalReturn).toBeCloseTo(24.85 / 130, 8);
  });

  it("computes break-even and downside protection", () => {
    const c = calculateCoveredCall({
      contract: makeCall(),
      contracts: 1,
      currentPrice: 130,
      costBasisPerShare: 115,
    });
    // breakEven relative to cost basis = 115 - 4.85
    expect(c.breakEven).toBeCloseTo(115 - 4.85, 6);
    expect(c.downsideProtectionPercent).toBeCloseTo(4.85 / 130, 8);
  });

  it("annualizes premium yield", () => {
    const c = calculateCoveredCall({
      contract: makeCall({ daysToExpiration: 30 }),
      contracts: 1,
      currentPrice: 130,
    });
    const expected = (485 / 13000) * (365 / 30);
    expect(c.annualizedPremiumYield).toBeCloseTo(expected, 8);
  });

  it("flags earnings before expiration", () => {
    const c = calculateCoveredCall({
      contract: makeCall({ expiration: "2026-02-16" }),
      contracts: 1,
      currentPrice: 130,
      earningsDate: "2026-01-30",
    });
    expect(c.earningsBeforeExpiration).toBe(true);
  });

  it("score is 0-100 and total is reasonable", () => {
    const c = calculateCoveredCall({
      contract: makeCall(),
      contracts: 1,
      currentPrice: 130,
    });
    expect(c.score.total).toBeGreaterThanOrEqual(0);
    expect(c.score.total).toBeLessThanOrEqual(100);
  });
});

describe("calculateCashSecuredPut", () => {
  it("computes collateral and effective entry", () => {
    const p = calculateCashSecuredPut({
      contract: makePut({ strike: 120 }),
      contracts: 1,
      currentPrice: 130,
    });
    expect(p.premiumPerShare).toBe(5.0);
    expect(p.grossCollateral).toBe(12000);
    expect(p.netCapitalAtRisk).toBe(11500);
    expect(p.effectivePurchasePrice).toBe(115);
    expect(p.breakEven).toBe(115);
    // discount = (130 - 115)/130
    expect(p.discountToCurrentPrice).toBeCloseTo(15 / 130, 8);
  });

  it("return on gross vs net are distinct", () => {
    const p = calculateCashSecuredPut({
      contract: makePut(),
      contracts: 1,
      currentPrice: 130,
    });
    expect(p.returnOnGrossCollateral).not.toBe(p.returnOnNetCapital);
    expect(p.returnOnGrossCollateral).toBeCloseTo(500 / 12000, 8);
    expect(p.returnOnNetCapital).toBeCloseTo(500 / 11500, 8);
  });
});

describe("payoff", () => {
  it("covered call payoff: max profit at/above strike, linear below", () => {
    const series = coveredCallPayoff({
      currentPrice: 100,
      strike: 110,
      premiumPerShare: 8,
      contracts: 1,
      points: 5,
      priceRange: [90, 130],
    });
    const atStrike = series.points.find((p) => p.stockPrice === 110);
    const above = series.points.find((p) => p.stockPrice === 130);
    const below = series.points.find((p) => p.stockPrice === 90);
    expect(atStrike?.combinedPnl).toBe(800 + (110 - 100) * 100); // 1800
    expect(above?.combinedPnl).toBe(1800); // capped
    // below strike: combined = (90 - 100)*100 + 800 = -200
    expect(below?.combinedPnl).toBe(-200);
    expect(series.breakEven).toBe(92);
  });

  it("cash-secured put payoff: max profit above strike, losses below", () => {
    const series = cashSecuredPutPayoff({
      currentPrice: 100,
      strike: 90,
      premiumPerShare: 5,
      contracts: 1,
      points: 5,
      priceRange: [70, 110],
    });
    const above = series.points.find((p) => p.stockPrice === 110);
    const atStrike = series.points.find((p) => p.stockPrice === 90);
    const below = series.points.find((p) => p.stockPrice === 70);
    expect(above?.combinedPnl).toBe(500); // keep full premium
    expect(atStrike?.combinedPnl).toBe(500);
    // below: 5 - (90-70) = -15 per share * 100 = -1500
    expect(below?.combinedPnl).toBe(-1500);
  });
});

describe("upsideCapCost", () => {
  it("computes extra premium vs surrendered upside", () => {
    const cmp = upsideCapCost(
      { strike: 110, premiumPerShare: 8 },
      { strike: 130, premiumPerShare: 4 },
    );
    expect(cmp.extraPremiumPerShare).toBe(4);
    expect(cmp.additionalUpsideSurrenderedPerShare).toBe(20);
    expect(cmp.premiumPerDollarOfUpsideSurrendered).toBe(0.2);
  });
});
