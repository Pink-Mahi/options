import { describe, it, expect } from "vitest";
import {
  analyzeMultiLegStrategy,
  classifyStrategy,
  bullPutSpread,
  bearCallSpread,
  ironCondor,
  collar,
  poorMansCoveredCall,
} from "./multi-leg";

describe("classifyStrategy", () => {
  it("classifies bull put spread", () => {
    const legs = bullPutSpread({ shortStrike: 100, longStrike: 95, shortPremium: 2, longPremium: 0.75, contracts: 1, daysToExpiration: 45, expiration: "2025-01-17" });
    expect(classifyStrategy(legs)).toBe("BULL_PUT_SPREAD");
  });

  it("classifies bear call spread", () => {
    const legs = bearCallSpread({ shortStrike: 100, longStrike: 105, shortPremium: 2, longPremium: 0.75, contracts: 1, daysToExpiration: 45, expiration: "2025-01-17" });
    expect(classifyStrategy(legs)).toBe("BEAR_CALL_SPREAD");
  });

  it("classifies iron condor", () => {
    const legs = ironCondor({
      putLongStrike: 90, putShortStrike: 95, callShortStrike: 105, callLongStrike: 110,
      putShortPremium: 1.5, putLongPremium: 0.5, callShortPremium: 1.5, callLongPremium: 0.5,
      contracts: 1, daysToExpiration: 45, expiration: "2025-01-17",
    });
    expect(classifyStrategy(legs)).toBe("IRON_CONDOR");
  });

  it("classifies collar", () => {
    const legs = collar({ shares: 100, stockPrice: 100, putStrike: 95, putPremium: 1.5, callStrike: 110, callPremium: 1, contracts: 1, daysToExpiration: 90, expiration: "2025-03-21" });
    expect(classifyStrategy(legs)).toBe("COLLAR");
  });

  it("classifies poor man's covered call", () => {
    const legs = poorMansCoveredCall({
      longStrike: 80, longPremium: 15, longDte: 365, longExpiration: "2025-12-19",
      shortStrike: 105, shortPremium: 1.5, shortDte: 45, shortExpiration: "2025-01-17",
      contracts: 1,
    });
    expect(classifyStrategy(legs)).toBe("POOR_MANS_COVERED_CALL");
  });
});

describe("analyzeMultiLegStrategy - bull put spread", () => {
  it("computes net credit", () => {
    const legs = bullPutSpread({ shortStrike: 100, longStrike: 95, shortPremium: 2, longPremium: 0.75, contracts: 1, daysToExpiration: 45, expiration: "2025-01-17" });
    const result = analyzeMultiLegStrategy(legs, 100);
    // Credit = 2 - 0.75 = 1.25 per share = $125
    expect(result.netPremiumPerShare).toBeCloseTo(1.25, 2);
    expect(result.netPremiumTotal).toBe(125);
  });

  it("max profit = credit received", () => {
    const legs = bullPutSpread({ shortStrike: 100, longStrike: 95, shortPremium: 2, longPremium: 0.75, contracts: 1, daysToExpiration: 45, expiration: "2025-01-17" });
    const result = analyzeMultiLegStrategy(legs, 100);
    expect(result.maxProfit).toBe(125);
  });

  it("max loss = width - credit", () => {
    const legs = bullPutSpread({ shortStrike: 100, longStrike: 95, shortPremium: 2, longPremium: 0.75, contracts: 1, daysToExpiration: 45, expiration: "2025-01-17" });
    const result = analyzeMultiLegStrategy(legs, 100);
    // Width = 5, credit = 1.25, max loss = (5 - 1.25) * 100 = 375
    expect(result.maxLoss).toBeCloseTo(-375, 0);
  });

  it("has one breakeven", () => {
    const legs = bullPutSpread({ shortStrike: 100, longStrike: 95, shortPremium: 2, longPremium: 0.75, contracts: 1, daysToExpiration: 45, expiration: "2025-01-17" });
    const result = analyzeMultiLegStrategy(legs, 100);
    // Breakeven = short strike - credit = 100 - 1.25 = 98.75
    expect(result.breakevens.length).toBe(1);
    expect(result.breakevens[0]).toBeCloseTo(98.75, 1);
  });

  it("computes margin requirement", () => {
    const legs = bullPutSpread({ shortStrike: 100, longStrike: 95, shortPremium: 2, longPremium: 0.75, contracts: 1, daysToExpiration: 45, expiration: "2025-01-17" });
    const result = analyzeMultiLegStrategy(legs, 100);
    // Margin = width * 100 = 500
    expect(result.marginRequirement).toBe(500);
  });

  it("computes risk/reward ratio", () => {
    const legs = bullPutSpread({ shortStrike: 100, longStrike: 95, shortPremium: 2, longPremium: 0.75, contracts: 1, daysToExpiration: 45, expiration: "2025-01-17" });
    const result = analyzeMultiLegStrategy(legs, 100);
    // R/R = 125 / 375 = 0.333
    expect(result.riskRewardRatio).toBeCloseTo(0.333, 2);
  });
});

describe("analyzeMultiLegStrategy - iron condor", () => {
  it("computes net credit for iron condor", () => {
    const legs = ironCondor({
      putLongStrike: 90, putShortStrike: 95, callShortStrike: 105, callLongStrike: 110,
      putShortPremium: 1.5, putLongPremium: 0.5, callShortPremium: 1.5, callLongPremium: 0.5,
      contracts: 1, daysToExpiration: 45, expiration: "2025-01-17",
    });
    const result = analyzeMultiLegStrategy(legs, 100);
    // Credit = (1.5 + 1.5) - (0.5 + 0.5) = 2.0 per share = $200
    expect(result.netPremiumPerShare).toBeCloseTo(2.0, 2);
    expect(result.netPremiumTotal).toBe(200);
  });

  it("max profit = credit", () => {
    const legs = ironCondor({
      putLongStrike: 90, putShortStrike: 95, callShortStrike: 105, callLongStrike: 110,
      putShortPremium: 1.5, putLongPremium: 0.5, callShortPremium: 1.5, callLongPremium: 0.5,
      contracts: 1, daysToExpiration: 45, expiration: "2025-01-17",
    });
    const result = analyzeMultiLegStrategy(legs, 100);
    expect(result.maxProfit).toBe(200);
  });

  it("max loss = widest wing - credit", () => {
    const legs = ironCondor({
      putLongStrike: 90, putShortStrike: 95, callShortStrike: 105, callLongStrike: 110,
      putShortPremium: 1.5, putLongPremium: 0.5, callShortPremium: 1.5, callLongPremium: 0.5,
      contracts: 1, daysToExpiration: 45, expiration: "2025-01-17",
    });
    const result = analyzeMultiLegStrategy(legs, 100);
    // Widest wing = 5, credit = 2, max loss = (5-2)*100 = 300
    expect(result.maxLoss).toBeCloseTo(-300, 0);
  });

  it("has two breakevens", () => {
    const legs = ironCondor({
      putLongStrike: 90, putShortStrike: 95, callShortStrike: 105, callLongStrike: 110,
      putShortPremium: 1.5, putLongPremium: 0.5, callShortPremium: 1.5, callLongPremium: 0.5,
      contracts: 1, daysToExpiration: 45, expiration: "2025-01-17",
    });
    const result = analyzeMultiLegStrategy(legs, 100);
    expect(result.breakevens.length).toBe(2);
    // Put breakeven = 95 - 2 = 93, Call breakeven = 105 + 2 = 107
    expect(result.breakevens[0]).toBeCloseTo(93, 1);
    expect(result.breakevens[1]).toBeCloseTo(107, 1);
  });
});

describe("analyzeMultiLegStrategy - collar", () => {
  it("classifies as collar", () => {
    const legs = collar({ shares: 100, stockPrice: 100, putStrike: 95, putPremium: 1.5, callStrike: 110, callPremium: 1, contracts: 1, daysToExpiration: 90, expiration: "2025-03-21" });
    const result = analyzeMultiLegStrategy(legs, 100);
    expect(result.kind).toBe("COLLAR");
  });

  it("net premium = call credit - put debit", () => {
    const legs = collar({ shares: 100, stockPrice: 100, putStrike: 95, putPremium: 1.5, callStrike: 110, callPremium: 1, contracts: 1, daysToExpiration: 90, expiration: "2025-03-21" });
    const result = analyzeMultiLegStrategy(legs, 100);
    // Net = 1 - 1.5 = -0.5 (debit)
    expect(result.netPremiumPerShare).toBeCloseTo(-0.5, 2);
  });
});

describe("analyzeMultiLegStrategy - poor man's covered call", () => {
  it("classifies correctly", () => {
    const legs = poorMansCoveredCall({
      longStrike: 80, longPremium: 15, longDte: 365, longExpiration: "2025-12-19",
      shortStrike: 105, shortPremium: 1.5, shortDte: 45, shortExpiration: "2025-01-17",
      contracts: 1,
    });
    const result = analyzeMultiLegStrategy(legs, 100);
    expect(result.kind).toBe("POOR_MANS_COVERED_CALL");
  });

  it("net premium is a debit (pay for LEAPS, collect short call)", () => {
    const legs = poorMansCoveredCall({
      longStrike: 80, longPremium: 15, longDte: 365, longExpiration: "2025-12-19",
      shortStrike: 105, shortPremium: 1.5, shortDte: 45, shortExpiration: "2025-01-17",
      contracts: 1,
    });
    const result = analyzeMultiLegStrategy(legs, 100);
    // Net = 1.5 - 15 = -13.5 (debit)
    expect(result.netPremiumPerShare).toBeCloseTo(-13.5, 2);
  });
});

describe("analyzeMultiLegStrategy - payoff points", () => {
  it("generates payoff points across price range", () => {
    const legs = bullPutSpread({ shortStrike: 100, longStrike: 95, shortPremium: 2, longPremium: 0.75, contracts: 1, daysToExpiration: 45, expiration: "2025-01-17" });
    const result = analyzeMultiLegStrategy(legs, 100);
    expect(result.payoffPoints.length).toBeGreaterThan(50);
    // At high prices, profit = credit
    const highPayoff = result.payoffPoints[result.payoffPoints.length - 1];
    expect(highPayoff?.optionPnl).toBeCloseTo(125, 0);
    // At low prices, loss = max loss
    const lowPayoff = result.payoffPoints[0];
    expect(lowPayoff?.optionPnl).toBeCloseTo(-375, 0);
  });
});
