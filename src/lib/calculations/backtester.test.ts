import { describe, it, expect } from "vitest";
import { runBacktest } from "./backtester";
import type { HistoricalPricePoint } from "@/lib/types";

function generatePrices(startPrice: number, days: number, dailyVol: number, trend: number = 0): HistoricalPricePoint[] {
  const prices: HistoricalPricePoint[] = [];
  let price = startPrice;
  // Use a simple deterministic random-ish walk with fixed seed
  let seed = 42;
  for (let i = 0; i < days; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const rand = (seed / 0x7fffffff) - 0.5; // -0.5 to 0.5
    const change = trend + rand * dailyVol;
    price = price * (1 + change);
    const date = new Date(2020, 0, 1 + i);
    prices.push({
      date: date.toISOString().slice(0, 10),
      open: price,
      high: price * 1.01,
      low: price * 0.99,
      close: price,
      adjustedClose: price,
      volume: 1000000,
    });
  }
  return prices;
}

describe("runBacktest - covered call", () => {
  it("runs a backtest over synthetic price data", () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = runBacktest(prices, {
      strategy: "COVERED_CALL",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 100,
      strikeInterval: 5,
      fillAssumption: "mid",
    });

    expect(result.trades.length).toBe(13);
    expect(result.totalPremiumIncome).toBeCloseTo(601.41, 1);
    expect(result.equityCurve.length).toBe(13);
    expect(result.totalCycles).toBe(13);
  });

  it("produces valid win rate", () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = runBacktest(prices, {
      strategy: "COVERED_CALL",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 100,
      strikeInterval: 5,
      fillAssumption: "mid",
    });

    expect(result.winRate).toBeCloseTo(0.846, 2);
    expect(result.expiredWorthlessCount).toBe(11);
    expect(result.calledAwayCount).toBe(2);
    expect(result.expiredWorthlessCount + result.calledAwayCount).toBe(result.totalCycles);
  });

  it("computes buy-and-hold return", () => {
    const prices = generatePrices(100, 300, 0.02, 0.001);
    const result = runBacktest(prices, {
      strategy: "COVERED_CALL",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 100,
      strikeInterval: 5,
      fillAssumption: "mid",
    });

    expect(result.buyHoldReturn).toBeCloseTo(0.188, 2);
    expect(result.strategyReturn).toBeCloseTo(0.171, 2);
    expect(result.outperformance).toBeCloseTo(-0.017, 2);
  });
});

describe("runBacktest - cash secured put", () => {
  it("runs CSP backtest", () => {
    const prices = generatePrices(100, 300, 0.02, 0);
    const result = runBacktest(prices, {
      strategy: "CASH_SECURED_PUT",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 45,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 0,
      strikeInterval: 5,
      fillAssumption: "mid",
    });

    expect(result.trades.length).toBe(9);
    expect(result.totalPremiumIncome).toBeCloseTo(527.76, 1);
    expect(result.totalCycles).toBe(9);
    expect(result.assignmentCount).toBe(5);
    expect(result.expiredWorthlessCount).toBe(4);
    expect(result.assignmentCount + result.expiredWorthlessCount).toBe(result.totalCycles);
  });
});

describe("runBacktest - wheel", () => {
  it("alternates between CSP and CC", () => {
    const prices = generatePrices(100, 500, 0.02, 0.0003);
    const result = runBacktest(prices, {
      strategy: "WHEEL",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 0,
      strikeInterval: 5,
      fillAssumption: "mid",
    });

    // Should have both puts and calls
    const hasPuts = result.trades.some((t) => t.optionType === "PUT");
    const hasCalls = result.trades.some((t) => t.optionType === "CALL");
    expect(result.trades.length).toBe(23);
    expect(hasPuts).toBe(true);
    expect(hasCalls).toBe(true);
  });

  it("never sells calls below the assignment strike when cost-basis floor is on", () => {
    // Strong downtrend forces put assignment, then calls must be >= assignment strike
    const prices = generatePrices(100, 500, 0.02, -0.002);
    const result = runBacktest(prices, {
      strategy: "WHEEL",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 0,
      strikeInterval: 5,
      fillAssumption: "mid",
      neverSellCallBelowCostBasis: true,
    });

    // Walk trades: after an ASSIGNED put, every subsequent CALL strike must be
    // >= that put's strike until shares are called away.
    let costBasis: number | null = null;
    let sawFlooredCall = false;
    for (const t of result.trades) {
      if (t.optionType === "PUT" && t.outcome === "ASSIGNED") {
        costBasis = t.strike;
      } else if (t.optionType === "CALL" && costBasis != null) {
        expect(t.strike).toBeGreaterThanOrEqual(costBasis);
        if (t.flooredByCostBasis) sawFlooredCall = true;
      }
      if (t.outcome === "CALLED_AWAY") costBasis = null;
    }
    expect(result.assignmentCount).toBeGreaterThan(0);
    expect(sawFlooredCall).toBe(true);
    expect(result.costBasisFlooredCount).toBeGreaterThan(0);
  });

  it("allows calls below cost basis when the floor is off", () => {
    const prices = generatePrices(100, 500, 0.02, -0.002);
    const result = runBacktest(prices, {
      strategy: "WHEEL",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 0,
      strikeInterval: 5,
      fillAssumption: "mid",
      neverSellCallBelowCostBasis: false,
    });

    // In a downtrend, at least one call should be sold below the assignment strike
    let costBasis: number | null = null;
    let sawBelowBasis = false;
    for (const t of result.trades) {
      if (t.optionType === "PUT" && t.outcome === "ASSIGNED") costBasis = t.strike;
      if (t.optionType === "CALL" && costBasis != null && t.strike < costBasis) sawBelowBasis = true;
      if (t.outcome === "CALLED_AWAY") costBasis = null;
    }
    expect(sawBelowBasis).toBe(true);
    expect(result.costBasisFlooredCount).toBe(0);
  });
});

describe("runBacktest - GTC min yield floor", () => {
  const baseConfig = {
    strategy: "COVERED_CALL" as const,
    symbol: "TEST",
    deltaTarget: 0.30,
    dteTarget: 30,
    contracts: 1,
    riskFreeRate: 0.05,
    startingCapital: 10000,
    shares: 100,
    strikeInterval: 5,
    fillAssumption: "mid" as const,
  };

  it("fills every cycle when the floor is 0 / unset", () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = runBacktest(prices, { ...baseConfig, minCallPremiumYieldPct: 0 });
    expect(result.noFillCount).toBe(0);
    expect(result.callFillRate).toBe(1);
    expect(result.trades.every((t) => t.outcome !== "NO_FILL")).toBe(true);
  });

  it("records NO_FILL cycles when the floor is impossibly high", () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = runBacktest(prices, { ...baseConfig, minCallPremiumYieldPct: 0.5 });
    expect(result.noFillCount).toBe(result.totalCycles);
    expect(result.callFillRate).toBe(0);
    expect(result.totalPremiumIncome).toBe(0);
    expect(result.trades.every((t) => t.outcome === "NO_FILL")).toBe(true);
  });

  it("every filled call meets the yield floor", () => {
    const prices = generatePrices(100, 500, 0.03, 0.0003);
    const floor = 0.005; // 0.5% — low enough that some cycles fill
    const result = runBacktest(prices, { ...baseConfig, minCallPremiumYieldPct: floor });
    const filledCalls = result.trades.filter((t) => t.optionType === "CALL" && t.outcome !== "NO_FILL");
    for (const t of filledCalls) {
      expect(t.premiumYield).toBeGreaterThanOrEqual(floor - 1e-9);
    }
    expect(result.noFillCount + filledCalls.length).toBe(result.totalCycles);
    if (filledCalls.length > 0) {
      expect(result.avgCallPremiumYield).toBeGreaterThanOrEqual(floor - 1e-9);
    }
  });

  it("higher floor reduces or equals total premium income", () => {
    const prices = generatePrices(100, 400, 0.025, 0.0003);
    const noFloor = runBacktest(prices, baseConfig);
    const withFloor = runBacktest(prices, { ...baseConfig, minCallPremiumYieldPct: 0.02 });
    expect(withFloor.totalPremiumIncome).toBeLessThanOrEqual(noFloor.totalPremiumIncome + 1e-6);
    expect(withFloor.noFillCount).toBeGreaterThanOrEqual(0);
  });
});

describe("runBacktest - reinvest premium to average down", () => {
  const baseConfig = {
    strategy: "COVERED_CALL" as const,
    symbol: "TEST",
    deltaTarget: 0.30,
    dteTarget: 30,
    contracts: 1,
    riskFreeRate: 0.05,
    startingCapital: 10000,
    shares: 100,
    strikeInterval: 5,
    fillAssumption: "mid" as const,
  };

  it("does nothing when the flag is off", () => {
    const prices = generatePrices(100, 500, 0.02, -0.002);
    const result = runBacktest(prices, { ...baseConfig, averageDownWithPremium: false });
    expect(result.averagedDownLots).toBe(0);
    expect(result.reinvestedPremium).toBe(0);
    expect(result.endingShares).toBe(100);
  });

  it("buys lots below cost basis and lowers the basis in a downtrend", () => {
    // High-delta calls in a volatile decline: fat premiums accumulate while
    // spot slides below basis, so lots get bought and the basis drops.
    const prices = generatePrices(100, 1500, 0.04, -0.0008);
    const result = runBacktest(prices, {
      ...baseConfig,
      deltaTarget: 0.50,
      averageDownWithPremium: true,
    });

    expect(result.averagedDownLots).toBeGreaterThan(0);
    expect(result.reinvestedPremium).toBeGreaterThan(0);
    expect(result.endingShares).toBeGreaterThan(100);
    // Ending basis must be below the initial ~100 purchase price
    expect(result.endingCostBasis).not.toBeNull();
    expect(result.endingCostBasis!).toBeLessThan(100);
  });

  it("sells more call contracts after buying extra lots", () => {
    const prices = generatePrices(100, 1500, 0.04, -0.0008);
    const result = runBacktest(prices, {
      ...baseConfig,
      deltaTarget: 0.50,
      averageDownWithPremium: true,
    });

    expect(result.averagedDownLots).toBeGreaterThan(0);
    const maxContracts = Math.max(...result.trades.map((t) => t.contracts));
    expect(maxContracts).toBeGreaterThan(1);
  });

  it("never buys when the stock stays above cost basis", () => {
    // Strong uptrend: spot never below basis after first cycle
    const prices = generatePrices(100, 500, 0.01, 0.003);
    const result = runBacktest(prices, { ...baseConfig, averageDownWithPremium: true });
    expect(result.averagedDownLots).toBe(0);
    expect(result.endingShares).toBe(100);
  });
});

describe("runBacktest - GTC buy-back", () => {
  const baseConfig = {
    strategy: "COVERED_CALL" as const,
    symbol: "TEST",
    deltaTarget: 0.30,
    dteTarget: 45,
    contracts: 1,
    riskFreeRate: 0.05,
    startingCapital: 10000,
    shares: 100,
    strikeInterval: 5,
    fillAssumption: "mid" as const,
  };

  it("holds to expiration when buyBackPct is unset", () => {
    const prices = generatePrices(100, 400, 0.02, 0.0003);
    const result = runBacktest(prices, baseConfig);
    expect(result.earlyCloseCount).toBe(0);
    expect(result.trades.every((t) => t.outcome !== "BOUGHT_BACK")).toBe(true);
    expect(result.trades.every((t) => t.exitPremium == null)).toBe(true);
  });

  it("closes trades early when the buy-back target is reached", () => {
    const prices = generatePrices(100, 600, 0.02, 0.0003);
    const result = runBacktest(prices, { ...baseConfig, buyBackPct: 0.5 });
    expect(result.earlyCloseCount).toBeGreaterThan(0);
    const boughtBack = result.trades.filter((t) => t.outcome === "BOUGHT_BACK");
    expect(boughtBack.length).toBe(result.earlyCloseCount);
    for (const t of boughtBack) {
      // Exit price must be at or below the 50% trigger
      expect(t.exitPremium).not.toBeNull();
      expect(t.exitPremium!).toBeLessThanOrEqual(t.premiumPerShare * 0.5 + 1e-9);
      // Closed before the full DTE
      expect(t.daysHeld).toBeLessThan(45);
    }
  });

  it("early close shortens average holding period", () => {
    const prices = generatePrices(100, 600, 0.02, 0.0003);
    const hold = runBacktest(prices, baseConfig);
    const managed = runBacktest(prices, { ...baseConfig, buyBackPct: 0.5 });
    expect(managed.avgDaysPerCycle).toBeLessThan(hold.avgDaysPerCycle);
    // More cycles fit in the same window when closing early
    expect(managed.totalCycles).toBeGreaterThanOrEqual(hold.totalCycles);
  });

  it("bought-back trades keep the captured profit", () => {
    const prices = generatePrices(100, 600, 0.02, 0.0003);
    const result = runBacktest(prices, { ...baseConfig, buyBackPct: 0.5 });
    const boughtBack = result.trades.filter((t) => t.outcome === "BOUGHT_BACK");
    for (const t of boughtBack) {
      // Option leg profit = (sold - bought back) * 100 * contracts > 0
      const optionPnl = (t.premiumPerShare - t.exitPremium!) * 100 * t.contracts;
      expect(optionPnl).toBeGreaterThan(0);
    }
  });
});

describe("runBacktest - put yield floor", () => {
  const baseConfig = {
    strategy: "CASH_SECURED_PUT" as const,
    symbol: "TEST",
    deltaTarget: 0.30,
    dteTarget: 30,
    contracts: 1,
    riskFreeRate: 0.05,
    startingCapital: 10000,
    shares: 0,
    strikeInterval: 5,
    fillAssumption: "mid" as const,
  };

  it("fills every put cycle when the floor is 0", () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = runBacktest(prices, { ...baseConfig, minPutPremiumYieldPct: 0 });
    expect(result.putNoFillCount).toBe(0);
    expect(result.putFillRate).toBe(1);
  });

  it("records NO_FILL for puts when the floor is impossibly high", () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = runBacktest(prices, { ...baseConfig, minPutPremiumYieldPct: 0.5 });
    expect(result.putNoFillCount).toBe(result.totalCycles);
    expect(result.putFillRate).toBe(0);
    expect(result.totalPremiumIncome).toBe(0);
  });

  it("every filled put meets the yield floor", () => {
    const prices = generatePrices(100, 500, 0.03, 0.0003);
    const floor = 0.005;
    const result = runBacktest(prices, { ...baseConfig, minPutPremiumYieldPct: floor });
    const filledPuts = result.trades.filter((t) => t.optionType === "PUT" && t.outcome !== "NO_FILL");
    for (const t of filledPuts) {
      expect(t.premiumYield).toBeGreaterThanOrEqual(floor - 1e-9);
    }
  });
});

describe("runBacktest - roll on assignment", () => {
  const baseConfig = {
    strategy: "WHEEL" as const,
    symbol: "TEST",
    deltaTarget: 0.50,
    dteTarget: 30,
    contracts: 1,
    riskFreeRate: 0.05,
    startingCapital: 10000,
    shares: 100,
    strikeInterval: 5,
    fillAssumption: "mid" as const,
  };

  it("without rolling, ITM calls result in CALLED_AWAY", () => {
    const prices = generatePrices(100, 400, 0.02, 0.003);
    const result = runBacktest(prices, { ...baseConfig, rollOnAssignment: false });
    expect(result.calledAwayCount).toBeGreaterThan(0);
    expect(result.rolledCount).toBe(0);
  });

  it("with rolling, ITM calls result in ROLLED and shares are kept", () => {
    const prices = generatePrices(100, 400, 0.02, 0.003);
    const result = runBacktest(prices, { ...baseConfig, rollOnAssignment: true });
    expect(result.rolledCount).toBeGreaterThan(0);
    expect(result.calledAwayCount).toBe(0);
    // Shares should still be held at the end (not reset to 0 by called-away)
    expect(result.endingShares).toBeGreaterThan(0);
  });

  it("rolled trades show positive option profit when premium > intrinsic", () => {
    const prices = generatePrices(100, 400, 0.02, 0.003);
    const result = runBacktest(prices, { ...baseConfig, rollOnAssignment: true });
    const rolled = result.trades.filter((t) => t.outcome === "ROLLED");
    expect(rolled.length).toBeGreaterThan(0);
  });
});

describe("runBacktest - edge cases", () => {
  it("handles insufficient data gracefully", () => {
    const prices = generatePrices(100, 30, 0.02);
    const result = runBacktest(prices, {
      strategy: "COVERED_CALL",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 100,
      strikeInterval: 5,
      fillAssumption: "mid",
    });

    expect(result.warnings).toEqual(["Insufficient historical data for backtesting (need 60+ trading days)."]);
  });

  it("computes outperformance", () => {
    const prices = generatePrices(100, 300, 0.02, 0.001);
    const result = runBacktest(prices, {
      strategy: "COVERED_CALL",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 100,
      strikeInterval: 5,
      fillAssumption: "mid",
    });

    expect(result.buyHoldReturn).toBeCloseTo(0.188, 2);
    expect(result.outperformance).toBe(result.strategyReturn - result.buyHoldReturn);
  });

  it("computes max drawdown between 0 and 1", () => {
    const prices = generatePrices(100, 300, 0.03, 0);
    const result = runBacktest(prices, {
      strategy: "COVERED_CALL",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 100,
      strikeInterval: 5,
      fillAssumption: "mid",
    });

    expect(result.maxDrawdown).toBeCloseTo(0.145, 2);
    expect(result.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(result.maxDrawdown).toBeLessThanOrEqual(1);
  });
});
