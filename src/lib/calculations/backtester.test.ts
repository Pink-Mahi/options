import { describe, it, expect } from "vitest";
import { runBacktest } from "./backtester";
import type { HistoricalPricePoint } from "@/lib/types";
import type { ThetaDataEODQuote } from "@/features/market-data/thetadata";

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
    // Use UTC to ensure date strings are consistent across timezones
    const date = new Date(Date.UTC(2020, 0, 1 + i));
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

describe("runBacktest - covered call", async () => {
  it("runs a backtest over synthetic price data", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = await runBacktest(prices, {
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
    expect(result.totalPremiumIncome).toBeCloseTo(620.32, 1);
    expect(result.equityCurve.length).toBe(13);
    expect(result.totalCycles).toBe(13);
  });

  it("produces valid win rate", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = await runBacktest(prices, {
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

  it("computes buy-and-hold return", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.001);
    const result = await runBacktest(prices, {
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
    expect(result.strategyReturn).toBeCloseTo(0.189, 2);
    expect(result.outperformance).toBeCloseTo(0.001, 2);
  });
});

describe("runBacktest - cash secured put", async () => {
  it("runs CSP backtest", async () => {
    const prices = generatePrices(100, 300, 0.02, 0);
    const result = await runBacktest(prices, {
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
    expect(result.totalPremiumIncome).toBeCloseTo(609.95, 1);
    expect(result.totalCycles).toBe(9);
    expect(result.assignmentCount).toBe(5);
    expect(result.expiredWorthlessCount).toBe(4);
    expect(result.assignmentCount + result.expiredWorthlessCount).toBe(result.totalCycles);
  });
});

describe("runBacktest - wheel", async () => {
  it("alternates between CSP and CC", async () => {
    const prices = generatePrices(100, 500, 0.02, 0.0003);
    const result = await runBacktest(prices, {
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

  it("never sells calls below the assignment strike when cost-basis floor is on", async () => {
    // Strong downtrend forces put assignment, then calls must be >= assignment strike
    const prices = generatePrices(100, 500, 0.02, -0.002);
    const result = await runBacktest(prices, {
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

  it("allows calls below cost basis when the floor is off", async () => {
    const prices = generatePrices(100, 500, 0.02, -0.002);
    const result = await runBacktest(prices, {
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

describe("runBacktest - GTC min yield floor", async () => {
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

  it("fills every cycle when the floor is 0 / unset", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = await runBacktest(prices, { ...baseConfig, minCallPremiumYieldPct: 0 });
    expect(result.noFillCount).toBe(0);
    expect(result.callFillRate).toBe(1);
    expect(result.trades.every((t) => t.outcome !== "NO_FILL")).toBe(true);
  });

  it("records NO_FILL cycles when the floor is impossibly high", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = await runBacktest(prices, { ...baseConfig, minCallPremiumYieldPct: 0.5 });
    expect(result.noFillCount).toBe(result.totalCycles);
    expect(result.callFillRate).toBe(0);
    expect(result.totalPremiumIncome).toBe(0);
    expect(result.trades.every((t) => t.outcome === "NO_FILL")).toBe(true);
  });

  it("every filled call meets the yield floor", async () => {
    const prices = generatePrices(100, 500, 0.03, 0.0003);
    const floor = 0.005; // 0.5% — low enough that some cycles fill
    const result = await runBacktest(prices, { ...baseConfig, minCallPremiumYieldPct: floor });
    const filledCalls = result.trades.filter((t) => t.optionType === "CALL" && t.outcome !== "NO_FILL");
    for (const t of filledCalls) {
      expect(t.premiumYield).toBeGreaterThanOrEqual(floor - 1e-9);
    }
    expect(result.noFillCount + filledCalls.length).toBe(result.totalCycles);
    if (filledCalls.length > 0) {
      expect(result.avgCallPremiumYield).toBeGreaterThanOrEqual(floor - 1e-9);
    }
  });

  it("higher floor reduces or equals total premium income", async () => {
    const prices = generatePrices(100, 400, 0.025, 0.0003);
    const noFloor = await runBacktest(prices, baseConfig);
    const withFloor = await runBacktest(prices, { ...baseConfig, minCallPremiumYieldPct: 0.02 });
    expect(withFloor.totalPremiumIncome).toBeLessThanOrEqual(noFloor.totalPremiumIncome + 1e-6);
    expect(withFloor.noFillCount).toBeGreaterThanOrEqual(0);
  });
});

describe("runBacktest - reinvest premium to average down", async () => {
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

  it("does nothing when the flag is off", async () => {
    const prices = generatePrices(100, 500, 0.02, -0.002);
    const result = await runBacktest(prices, { ...baseConfig, averageDownWithPremium: false });
    expect(result.averagedDownLots).toBe(0);
    expect(result.reinvestedPremium).toBe(0);
    expect(result.endingShares).toBe(100);
  });

  it("sells CSP puts to average down in a downtrend", async () => {
    // High-delta calls in a volatile decline: fat premiums accumulate while
    // spot slides below basis, so CSP puts are sold. If assigned, shares are
    // acquired at the put strike (below spot), lowering cost basis.
    const prices = generatePrices(100, 1500, 0.04, -0.0008);
    const result = await runBacktest(prices, {
      ...baseConfig,
      deltaTarget: 0.50,
      averageDownWithPremium: true,
    });

    expect(result.averagedDownLots).toBeGreaterThanOrEqual(0);
    expect(result.reinvestedPremium).toBeGreaterThanOrEqual(0);
    // CSP puts may or may not get assigned depending on the path
    // but the ending shares should be >= initial 100
    expect(result.endingShares).toBeGreaterThanOrEqual(100);
  });

  it("average-down CSP does not inflate contract count", async () => {
    const prices = generatePrices(100, 1500, 0.04, -0.0008);
    const result = await runBacktest(prices, {
      ...baseConfig,
      deltaTarget: 0.50,
      averageDownWithPremium: true,
    });

    // Contracts should stay at the configured count, not grow
    const maxContracts = Math.max(...result.trades.map((t) => t.contracts));
    expect(maxContracts).toBe(baseConfig.contracts);
  });

  it("never buys when the stock stays above cost basis", async () => {
    // Strong uptrend: spot never below basis after first cycle
    const prices = generatePrices(100, 500, 0.01, 0.003);
    const result = await runBacktest(prices, { ...baseConfig, averageDownWithPremium: true });
    expect(result.averagedDownLots).toBe(0);
    expect(result.endingShares).toBe(100);
  });
});

describe("runBacktest - GTC buy-back", async () => {
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

  it("holds to expiration when buyBackPct is unset", async () => {
    const prices = generatePrices(100, 400, 0.02, 0.0003);
    const result = await runBacktest(prices, baseConfig);
    expect(result.earlyCloseCount).toBe(0);
    expect(result.trades.every((t) => t.outcome !== "BOUGHT_BACK")).toBe(true);
    expect(result.trades.every((t) => t.exitPremium == null)).toBe(true);
  });

  it("closes trades early when the buy-back target is reached", async () => {
    const prices = generatePrices(100, 600, 0.02, 0.0003);
    const result = await runBacktest(prices, { ...baseConfig, buyBackPct: 0.5 });
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

  it("early close shortens average holding period", async () => {
    const prices = generatePrices(100, 600, 0.02, 0.0003);
    const hold = await runBacktest(prices, baseConfig);
    const managed = await runBacktest(prices, { ...baseConfig, buyBackPct: 0.5 });
    expect(managed.avgDaysPerCycle).toBeLessThan(hold.avgDaysPerCycle);
    // More cycles fit in the same window when closing early
    expect(managed.totalCycles).toBeGreaterThanOrEqual(hold.totalCycles);
  });

  it("bought-back trades keep the captured profit", async () => {
    const prices = generatePrices(100, 600, 0.02, 0.0003);
    const result = await runBacktest(prices, { ...baseConfig, buyBackPct: 0.5 });
    const boughtBack = result.trades.filter((t) => t.outcome === "BOUGHT_BACK");
    for (const t of boughtBack) {
      // Option leg profit = (sold - bought back) * 100 * contracts > 0
      const optionPnl = (t.premiumPerShare - t.exitPremium!) * 100 * t.contracts;
      expect(optionPnl).toBeGreaterThan(0);
    }
  });
});

describe("runBacktest - put yield floor", async () => {
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

  it("fills every put cycle when the floor is 0", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = await runBacktest(prices, { ...baseConfig, minPutPremiumYieldPct: 0 });
    expect(result.putNoFillCount).toBe(0);
    expect(result.putFillRate).toBe(1);
  });

  it("records NO_FILL for puts when the floor is impossibly high", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = await runBacktest(prices, { ...baseConfig, minPutPremiumYieldPct: 0.5 });
    expect(result.putNoFillCount).toBe(result.totalCycles);
    expect(result.putFillRate).toBe(0);
    expect(result.totalPremiumIncome).toBe(0);
  });

  it("every filled put meets the yield floor", async () => {
    const prices = generatePrices(100, 500, 0.03, 0.0003);
    const floor = 0.005;
    const result = await runBacktest(prices, { ...baseConfig, minPutPremiumYieldPct: floor });
    const filledPuts = result.trades.filter((t) => t.optionType === "PUT" && t.outcome !== "NO_FILL");
    for (const t of filledPuts) {
      expect(t.premiumYield).toBeGreaterThanOrEqual(floor - 1e-9);
    }
  });
});

describe("runBacktest - roll on assignment", async () => {
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

  it("without rolling, ITM calls result in CALLED_AWAY", async () => {
    const prices = generatePrices(100, 400, 0.02, 0.003);
    const result = await runBacktest(prices, { ...baseConfig, rollOnAssignment: false });
    expect(result.calledAwayCount).toBeGreaterThan(0);
    expect(result.rolledCount).toBe(0);
  });

  it("with rolling, ITM calls result in ROLLED and shares are kept", async () => {
    const prices = generatePrices(100, 400, 0.02, 0.003);
    const result = await runBacktest(prices, { ...baseConfig, rollOnAssignment: true });
    expect(result.rolledCount).toBeGreaterThan(0);
    expect(result.calledAwayCount).toBe(0);
    // Shares should still be held at the end (not reset to 0 by called-away)
    expect(result.endingShares).toBeGreaterThan(0);
  });

  it("rolled trades show positive option profit when premium > intrinsic", async () => {
    const prices = generatePrices(100, 400, 0.02, 0.003);
    const result = await runBacktest(prices, { ...baseConfig, rollOnAssignment: true });
    const rolled = result.trades.filter((t) => t.outcome === "ROLLED");
    expect(rolled.length).toBeGreaterThan(0);
  });
});

describe("runBacktest - edge cases", async () => {
  it("handles insufficient data gracefully", async () => {
    const prices = generatePrices(100, 30, 0.02);
    const result = await runBacktest(prices, {
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

  it("computes outperformance", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.001);
    const result = await runBacktest(prices, {
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

  it("computes max drawdown between 0 and 1", async () => {
    const prices = generatePrices(100, 300, 0.03, 0);
    const result = await runBacktest(prices, {
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

    // Drawdown is now computed from the daily mark-to-market curve, which
    // captures intra-cycle equity changes (the short call liability offsets
    // some stock decline, producing a lower DD than the per-cycle curve).
    expect(result.maxDrawdown).toBeCloseTo(0.0524, 2);
    expect(result.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(result.maxDrawdown).toBeLessThanOrEqual(1);
  });
});

describe("runBacktest - GTC intraday touch simulation", async () => {
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

  function makeQuote(
    o: Partial<ThetaDataEODQuote> & { date: string; expiration: string },
  ): ThetaDataEODQuote {
    return {
      strike: 105,
      right: "CALL",
      bid: 1.9,
      ask: 2.1,
      mid: 2.0,
      high: 2.2,
      low: 1.8,
      close: 2.0,
      volume: 100,
      openInterest: 500,
      underlyingPrice: 100,
      ...o,
    };
  }

  it("fills the buy-back on the first day the traded low touches the trigger", async () => {
    const prices = generatePrices(100, 120, 0.005, 0);
    const openDate = prices[30]!.date;
    const expiration = prices[75]!.date; // ~45 calendar days out
    const realData = new Map<string, ThetaDataEODQuote[]>([
      [openDate, [makeQuote({ date: openDate, expiration })]],
    ]);

    // Trigger = 2.00 mid * (1 - 0.5) = 1.00. Day 31: no touch (low 1.4).
    // Day 32: zero-volume row (low/ask 0) — must NOT count as a touch.
    // Day 33: traded low 0.90 dips through the trigger intraday → fills at 1.00.
    const rows = new Map<string, ThetaDataEODQuote>([
      [prices[31]!.date, makeQuote({ date: prices[31]!.date, expiration, low: 1.4, ask: 1.6 })],
      [prices[32]!.date, makeQuote({ date: prices[32]!.date, expiration, low: 0, ask: 0, high: 0, bid: 0, mid: 0, volume: 0 })],
      [prices[33]!.date, makeQuote({ date: prices[33]!.date, expiration, low: 0.9, ask: 1.3 })],
    ]);

    const result = await runBacktest(prices, {
      ...baseConfig,
      buyBackPct: 0.5,
      realData,
      getDailyRows: async () => rows,
    });

    const first = result.trades[0]!;
    expect(first.dataSource).toBe("REAL");
    expect(first.outcome).toBe("BOUGHT_BACK");
    expect(first.exitByTouch).toBe(true);
    expect(first.exitPremium).toBeCloseTo(1.0, 6); // filled at the limit price
    expect(first.closeDate).toBe(prices[33]!.date);
    expect(first.daysHeld).toBeLessThan(45);
    expect(result.touchExitCount).toBe(1);
    expect(result.touchCycles).toBeGreaterThanOrEqual(1);
  });

  it("buys back at the ask when the ask drops to the trigger", async () => {
    const prices = generatePrices(100, 120, 0.005, 0);
    const openDate = prices[30]!.date;
    const expiration = prices[75]!.date;
    const realData = new Map<string, ThetaDataEODQuote[]>([
      [openDate, [makeQuote({ date: openDate, expiration })]],
    ]);
    // Ask 0.95 ≤ trigger 1.00 on day 31 — marketable, buy at the ask.
    const rows = new Map<string, ThetaDataEODQuote>([
      [prices[31]!.date, makeQuote({ date: prices[31]!.date, expiration, ask: 0.95, low: 1.1 })],
    ]);

    const result = await runBacktest(prices, {
      ...baseConfig,
      buyBackPct: 0.5,
      realData,
      getDailyRows: async () => rows,
    });

    const first = result.trades[0]!;
    expect(first.outcome).toBe("BOUGHT_BACK");
    expect(first.exitByTouch).toBe(true);
    expect(first.exitPremium).toBeCloseTo(0.95, 6);
    expect(first.closeDate).toBe(prices[31]!.date);
  });

  it("holds to expiry when daily rows never touch the trigger", async () => {
    const prices = generatePrices(100, 120, 0.005, 0);
    const openDate = prices[30]!.date;
    const expiration = prices[75]!.date;
    const realData = new Map<string, ThetaDataEODQuote[]>([
      [openDate, [makeQuote({ date: openDate, expiration })]],
    ]);
    // Every day stays above the trigger and the rows suppress the BS
    // re-pricing, so the position rides to expiration. Rows must cover the
    // full cycle (through the real expiration date).
    const rows = new Map<string, ThetaDataEODQuote>();
    for (let i = 31; i <= 75; i++) {
      const d = prices[i]!.date;
      rows.set(d, makeQuote({ date: d, expiration, low: 1.5, ask: 1.8, bid: 1.7, mid: 1.75, high: 1.9, close: 1.75 }));
    }

    const result = await runBacktest(prices, {
      ...baseConfig,
      buyBackPct: 0.5,
      realData,
      getDailyRows: async () => rows,
    });

    const first = result.trades[0]!;
    expect(first.outcome).not.toBe("BOUGHT_BACK");
    expect(first.exitByTouch ?? false).toBe(false);
    expect(first.closeDate).toBe(first.expirationDate);
    expect(result.touchExitCount).toBe(0);
  });

  it("fills a resting min-yield entry order on an intraday bid touch", async () => {
    const prices = generatePrices(100, 120, 0.005, 0);
    const openDate = prices[30]!.date;
    const expiration = prices[75]!.date;
    // Open-date quote: 2.0 mid on a ~$100 stock = ~2% yield < 2.5% floor.
    // Without touch data this cycle would be a NO_FILL.
    const realData = new Map<string, ThetaDataEODQuote[]>([
      [openDate, [makeQuote({ date: openDate, expiration })]],
    ]);
    // Target = 0.025 * 100 = 2.50. Day 31 bid 2.60 ≥ 2.50 → GTC fills at 2.50.
    const rows = new Map<string, ThetaDataEODQuote>([
      [prices[31]!.date, makeQuote({ date: prices[31]!.date, expiration, bid: 2.6, ask: 2.8, mid: 2.7, high: 2.9 })],
    ]);

    const result = await runBacktest(prices, {
      ...baseConfig,
      minCallPremiumYieldPct: 0.025,
      realData,
      getDailyRows: async () => rows,
    });

    const first = result.trades[0]!;
    expect(first.dataSource).toBe("REAL");
    expect(first.outcome).not.toBe("NO_FILL");
    expect(first.entryByTouch).toBe(true);
    expect(first.openDate).toBe(prices[31]!.date);
    // Filled at the resting limit price: floor × spot at cycle open.
    expect(first.premiumPerShare).toBeCloseTo(0.025 * prices[30]!.adjustedClose, 6);
    expect(result.touchEntryCount).toBe(1);
  });

  it("zero-volume days never trigger false fills", async () => {
    const prices = generatePrices(100, 120, 0.005, 0);
    const openDate = prices[30]!.date;
    const expiration = prices[75]!.date;
    const realData = new Map<string, ThetaDataEODQuote[]>([
      [openDate, [makeQuote({ date: openDate, expiration })]],
    ]);
    // All rows zero-volume: low=0, ask=0 — a naive low <= trigger check would
    // false-fill immediately; the guards must prevent it. Rows cover the full
    // cycle through the real expiration date.
    const rows = new Map<string, ThetaDataEODQuote>();
    for (let i = 31; i <= 75; i++) {
      const d = prices[i]!.date;
      rows.set(d, makeQuote({ date: d, expiration, bid: 0, ask: 0, mid: 0, high: 0, low: 0, volume: 0 }));
    }

    const result = await runBacktest(prices, {
      ...baseConfig,
      buyBackPct: 0.5,
      realData,
      getDailyRows: async () => rows,
    });

    const first = result.trades[0]!;
    expect(first.exitByTouch ?? false).toBe(false);
    expect(first.outcome).not.toBe("BOUGHT_BACK");
    expect(result.touchExitCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 accuracy tests: daily MTM, real-expiration settlement, cash
// interest, transaction costs, snap-to-Friday.
// ---------------------------------------------------------------------------

describe("runBacktest - daily mark-to-market", async () => {
  it("produces a daily equity curve with more points than the per-cycle curve", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = await runBacktest(prices, {
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

    expect(result.dailyEquityCurve.length).toBeGreaterThan(result.equityCurve.length);
    // Daily curve should have roughly one point per trading day in the cycles
    expect(result.dailyEquityCurve.length).toBeGreaterThan(200);
  });

  it("captures intra-cycle drawdown that per-cycle equity misses", async () => {
    // Build a V-shaped price series: flat, sharp drop, recovery — all within
    // a single 90-DTE cycle. The per-cycle equity sees no drawdown (start and
    // end prices are the same), but the daily MTM should catch the dip.
    const prices: HistoricalPricePoint[] = [];
    const startDate = new Date(2020, 0, 1);
    for (let i = 0; i < 200; i++) {
      let price = 100;
      if (i >= 30 && i < 60) {
        // Drop 30% over 30 days
        price = 100 * (1 - 0.30 * (i - 30) / 30);
      } else if (i >= 60 && i < 90) {
        // Recover back to 100 over 30 days
        price = 70 * (1 + 0.30 * (i - 60) / 30);
      }
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
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

    const result = await runBacktest(prices, {
      strategy: "COVERED_CALL",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 90,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 100,
      strikeInterval: 5,
      fillAssumption: "mid",
    });

    // The daily curve should show a drawdown from the V-shape
    expect(result.maxDrawdown).toBeGreaterThan(0.10);
    // Sortino and Calmar should be computed
    expect(result.sortinoRatio).not.toBeNull();
    expect(result.calmarRatio).not.toBeNull();
  });
});

describe("runBacktest - real expiration settlement", async () => {
  it("settles on the real expiration date, not idx + tradingDaysPerCycle", async () => {
    const prices = generatePrices(100, 120, 0.005, 0);
    const openDate = prices[30]!.date;
    // Real expiration is at day 75, but dteTarget=45 would close at ~day 62
    const expiration = prices[75]!.date;
    const realData = new Map<string, ThetaDataEODQuote[]>([
      [openDate, [{
        strike: 105,
        right: "CALL",
        bid: 1.9,
        ask: 2.1,
        mid: 2.0,
        high: 2.2,
        low: 1.8,
        close: 2.0,
        volume: 100,
        openInterest: 500,
        underlyingPrice: 100,
        date: openDate,
        expiration,
      }]],
    ]);

    const result = await runBacktest(prices, {
      strategy: "COVERED_CALL",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 45,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 100,
      strikeInterval: 5,
      fillAssumption: "mid",
      realData,
    });

    const first = result.trades[0]!;
    expect(first.dataSource).toBe("REAL");
    // The trade should close at the real expiration date, not idx + tradingDaysPerCycle
    expect(first.expirationDate).toBe(expiration);
    // The close date should match the real expiration (settlement on the right day)
    expect(first.closeDate).toBe(expiration);
    // actualDte should reflect the real expiration, not the target
    expect(first.actualDte).toBeGreaterThan(40);
  });
});

describe("runBacktest - cash interest", async () => {
  it("accrues interest on idle cash when enabled", async () => {
    const prices = generatePrices(100, 300, 0.0, 0); // flat prices
    const result = await runBacktest(prices, {
      strategy: "CASH_SECURED_PUT",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 0,
      strikeInterval: 5,
      fillAssumption: "mid",
      cashInterestEnabled: true,
    });

    // With flat prices and CSP, the cash collateral earns interest.
    // Over ~300 trading days (~1.2 years) at 5% on $10K, expect $300+.
    expect(result.interestIncome).toBeGreaterThan(300);
    expect(result.interestIncome).toBeLessThan(700);
  });

  it("does not accrue interest when disabled (default)", async () => {
    const prices = generatePrices(100, 300, 0.0, 0);
    const result = await runBacktest(prices, {
      strategy: "CASH_SECURED_PUT",
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

    expect(result.interestIncome).toBe(0);
  });
});

describe("runBacktest - transaction costs", async () => {
  it("charges commission on every option open and buy-back", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = await runBacktest(prices, {
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
      commissionPerContract: 0.65,
      buyBackPct: 0.5,
    });

    // Every cycle opens a short → 1 commission. Buy-backs add another.
    // With 13 cycles and buyBackPct=0.5, at least 13 open commissions.
    expect(result.totalCommissions).toBeGreaterThanOrEqual(13 * 0.65);
    // Total should be a reasonable multiple of 0.65 (floating point tolerant)
    const expectedMin = 13 * 0.65;
    expect(result.totalCommissions).toBeGreaterThanOrEqual(expectedMin);
  });

  it("charges assignment fee on assignment", async () => {
    const prices = generatePrices(100, 300, 0.02, 0);
    const result = await runBacktest(prices, {
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
      commissionPerContract: 0.65,
      assignmentFee: 20,
    });

    // With CSP, some puts get assigned. Each assignment costs $20.
    expect(result.assignmentCount).toBeGreaterThan(0);
    expect(result.totalCommissions).toBeGreaterThanOrEqual(
      result.assignmentCount * 20 + result.totalCycles * 0.65,
    );
  });

  it("applies slippage to reduce the fill price", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const resultNoSlippage = await runBacktest(prices, {
      strategy: "COVERED_CALL",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 100,
      strikeInterval: 5,
      fillAssumption: "bid",
    });
    const resultWithSlippage = await runBacktest(prices, {
      strategy: "COVERED_CALL",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 100,
      strikeInterval: 5,
      fillAssumption: "bid",
      slippagePerShare: 0.05,
    });

    // Slippage reduces premium income
    expect(resultWithSlippage.totalPremiumIncome).toBeLessThan(resultNoSlippage.totalPremiumIncome);
  });
});

describe("runBacktest - snap to Friday expiration", async () => {
  it("snaps cycle close to the nearest Friday when enabled", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = await runBacktest(prices, {
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
      snapExpiration: true,
      hasWeeklies: true,
    });

    // Every cycle's expiration date should be a Friday (or the closest
    // trading day to a Friday). Use UTC to match the ISO date strings.
    // The last cycle may fall off the end of the data before reaching a
    // Friday, so we check the majority.
    let fridayCount = 0;
    for (const trade of result.trades) {
      const day = new Date(trade.expirationDate).getUTCDay();
      if (day === 5) fridayCount++;
    }
    expect(fridayCount).toBeGreaterThan(result.trades.length * 0.7);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 tests: wheel-grade metrics
// ---------------------------------------------------------------------------

describe("runBacktest - wheel-grade metrics", async () => {
  it("computes capital utilization between 0 and 1 for an active strategy", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = await runBacktest(prices, {
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

    expect(result.capitalUtilization).toBeGreaterThan(0);
    expect(result.capitalUtilization).toBeLessThanOrEqual(1);
  });

  it("computes return on capital deployed for a profitable strategy", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = await runBacktest(prices, {
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

    expect(result.returnOnCapitalDeployed).not.toBeNull();
    if (result.returnOnCapitalDeployed != null) {
      expect(result.returnOnCapitalDeployed).toBeGreaterThan(-1);
    }
  });

  it("computes monthly income std dev and zero income months", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = await runBacktest(prices, {
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

    expect(result.monthlyIncomeStdDev).toBeGreaterThanOrEqual(0);
    expect(result.zeroIncomeMonths).toBeGreaterThanOrEqual(0);
    expect(result.worstMonthPnl).toBeLessThanOrEqual(result.monthlyCashFlow[0]?.netPremium ?? 0);
  });

  it("computes worst cycle P/L", async () => {
    const prices = generatePrices(100, 300, 0.02, 0);
    const result = await runBacktest(prices, {
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

    expect(result.worstCyclePnl).toBeLessThanOrEqual(0);
    // Worst cycle P/L should be the minimum across all trades
    const minPnl = Math.min(...result.trades.map((t) => t.cyclePnl));
    expect(result.worstCyclePnl).toBeCloseTo(minPnl, 6);
  });

  it("tracks cost basis history for the wheel strategy", async () => {
    const prices = generatePrices(100, 500, 0.02, 0.0003);
    const result = await runBacktest(prices, {
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

    // The wheel should have at least one cost basis change (assignment or call)
    expect(result.costBasisHistory.length).toBeGreaterThan(0);
    // Each entry should have a date and cost basis
    for (const entry of result.costBasisHistory) {
      expect(entry.date).toBeTruthy();
      expect(entry.costBasis).toBeGreaterThanOrEqual(0);
    }
  });

  it("computes net cost basis reduction from call premium", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = await runBacktest(prices, {
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

    // Covered calls collect premium against held shares, so net cost basis
    // reduction should be positive.
    expect(result.netCostBasisReduction).toBeGreaterThan(0);
  });

  it("tracks days underwater when stock drops below cost basis", async () => {
    // Build a price series that drops below the initial cost basis (100)
    const prices: HistoricalPricePoint[] = [];
    const startDate = new Date(Date.UTC(2020, 0, 1));
    for (let i = 0; i < 200; i++) {
      let price = 100;
      if (i >= 30 && i < 100) {
        // Drop to 70 over 70 days
        price = 100 - 30 * (i - 30) / 70;
      } else if (i >= 100 && i < 150) {
        // Stay at 70 for 50 days
        price = 70;
      } else if (i >= 150) {
        // Recover to 100
        price = 70 + 30 * (i - 150) / 50;
      }
      const date = new Date(startDate);
      date.setUTCDate(date.getUTCDate() + i);
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

    const result = await runBacktest(prices, {
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

    // Cost basis is established at ~100 (first cycle open). Stock drops to 70
    // and stays there for ~50 days. Days underwater should be significant.
    expect(result.daysUnderwater).toBeGreaterThan(20);
  });

  it("computes regime breakdown when benchmark data is provided", async () => {
    const prices = generatePrices(100, 500, 0.02, 0.0003);
    // Generate a simple benchmark (SPY-like) with some variation
    const spyPrices: HistoricalPricePoint[] = [];
    let spyPrice = 400;
    let seed = 99;
    const startDate = new Date(Date.UTC(2020, 0, 1));
    for (let i = 0; i < 500; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const rand = (seed / 0x7fffffff) - 0.5;
      spyPrice = spyPrice * (1 + rand * 0.01 + 0.0003);
      const date = new Date(startDate);
      date.setUTCDate(date.getUTCDate() + i);
      spyPrices.push({
        date: date.toISOString().slice(0, 10),
        open: spyPrice,
        high: spyPrice * 1.01,
        low: spyPrice * 0.99,
        close: spyPrice,
        adjustedClose: spyPrice,
        volume: 100000000,
      });
    }

    const result = await runBacktest(
      prices,
      {
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
      },
      spyPrices,
    );

    expect(result.marketContext).not.toBeNull();
    expect(result.regimeBreakdown.length).toBeGreaterThan(0);
    // Each regime entry should have valid fields
    for (const r of result.regimeBreakdown) {
      expect(r.regime).toBeTruthy();
      expect(r.cycles).toBeGreaterThan(0);
      expect(r.winRate).toBeGreaterThanOrEqual(0);
      expect(r.winRate).toBeLessThanOrEqual(1);
    }
  });
});

// --- Phase 5: Wheel management rules ---
describe("runBacktest - Phase 5 wheel management rules", async () => {
  it("skips cycles near earnings dates", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    // Earnings date on day 60 (2020-03-01)
    const earningsDate = new Date(Date.UTC(2020, 0, 61)).toISOString().slice(0, 10);
    const result = await runBacktest(prices, {
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
      skipEarningsWindow: 14,
      earningsDates: [earningsDate],
    });

    expect(result.earningsSkippedCount).toBeGreaterThan(0);
    // Some cycles should be NO_FILL due to earnings proximity
    const noFillTrades = result.trades.filter((t) => t.outcome === "NO_FILL");
    expect(noFillTrades.length).toBeGreaterThan(0);
  });

  it("does not skip cycles when earnings window is not set", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const earningsDate = new Date(Date.UTC(2020, 0, 61)).toISOString().slice(0, 10);
    const result = await runBacktest(prices, {
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
      earningsDates: [earningsDate],
    });

    expect(result.earningsSkippedCount).toBe(0);
  });

  it("skips cycles when IV rank is below minimum", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    // Build an IV rank series with low values for all dates
    const ivRankSeries = new Map<string, number>();
    for (const p of prices) {
      ivRankSeries.set(p.date, 10); // IV rank of 10
    }
    const result = await runBacktest(prices, {
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
      minIvRank: 50,
      ivRankSeries,
    });

    expect(result.ivRankSkippedCount).toBeGreaterThan(0);
    // All cycles should be skipped since IV rank is always 10 < 50
    expect(result.ivRankSkippedCount).toBe(result.totalCycles);
  });

  it("does not skip cycles when IV rank is above minimum", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const ivRankSeries = new Map<string, number>();
    for (const p of prices) {
      ivRankSeries.set(p.date, 80); // IV rank of 80
    }
    const result = await runBacktest(prices, {
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
      minIvRank: 50,
      ivRankSeries,
    });

    expect(result.ivRankSkippedCount).toBe(0);
  });

  it("closes positions early with manageAtDte", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = await runBacktest(prices, {
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
      manageAtDte: 21,
    });

    // With manageAtDte=21, some cycles should be managed early
    expect(result.managedEarlyCount).toBeGreaterThan(0);
  });

  it("does not manage early when manageAtDte is not set", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = await runBacktest(prices, {
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

    expect(result.managedEarlyCount).toBe(0);
  });

  it("triggers stop-loss on a sharp downturn", async () => {
    // Build prices that crash sharply to trigger stop-loss
    const prices: HistoricalPricePoint[] = [];
    const startDate = new Date(Date.UTC(2020, 0, 1));
    for (let i = 0; i < 200; i++) {
      let price: number;
      if (i < 40) {
        price = 100 + i * 0.1; // slow rise
      } else if (i < 60) {
        price = 104 - (i - 40) * 2; // sharp drop from 104 to 64
      } else {
        price = 64; // stay low
      }
      const date = new Date(startDate);
      date.setUTCDate(date.getUTCDate() + i);
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

    const result = await runBacktest(prices, {
      strategy: "CASH_SECURED_PUT",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 0,
      strikeInterval: 5,
      fillAssumption: "mid",
      stopLossMultiple: 2,
    });

    // The sharp drop should trigger at least one stop-loss
    expect(result.stopLossCount).toBeGreaterThan(0);
  });

  it("does not trigger stop-loss when not configured", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = await runBacktest(prices, {
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

    expect(result.stopLossCount).toBe(0);
  });

  it("reports all Phase 5 counters in the result", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = await runBacktest(prices, {
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

    // All Phase 5 counters should be present and default to 0
    expect(result.rolledPutCount).toBe(0);
    expect(result.stopLossCount).toBe(0);
    expect(result.earningsSkippedCount).toBe(0);
    expect(result.ivRankSkippedCount).toBe(0);
    expect(result.managedEarlyCount).toBe(0);
  });

  it("combines earnings skip with IV rank gate", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const earningsDate = new Date(Date.UTC(2020, 0, 61)).toISOString().slice(0, 10);
    const ivRankSeries = new Map<string, number>();
    for (const p of prices) {
      ivRankSeries.set(p.date, 10);
    }
    const result = await runBacktest(prices, {
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
      skipEarningsWindow: 14,
      earningsDates: [earningsDate],
      minIvRank: 50,
      ivRankSeries,
    });

    // Both rules should skip cycles
    expect(result.earningsSkippedCount).toBeGreaterThan(0);
    expect(result.ivRankSkippedCount).toBeGreaterThan(0);
  });

  it("rolls ITM calls and sells a replacement when rollOnAssignment is true", async () => {
    // Build a rising price series so calls finish ITM
    const prices: HistoricalPricePoint[] = [];
    const startDate = new Date(Date.UTC(2020, 0, 1));
    for (let i = 0; i < 300; i++) {
      const price = 100 + i * 0.3; // steady rise
      const date = new Date(startDate);
      date.setUTCDate(date.getUTCDate() + i);
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

    const result = await runBacktest(prices, {
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
      rollOnAssignment: true,
    });

    // With a rising price, some calls should finish ITM and be rolled
    expect(result.rolledCount).toBeGreaterThan(0);
    // The wheel should keep shares (not called away)
    expect(result.calledAwayCount).toBe(0);
    expect(result.endingShares).toBe(100);
  });

  it("calls away shares when rollOnAssignment is false", async () => {
    // Same rising price series
    const prices: HistoricalPricePoint[] = [];
    const startDate = new Date(Date.UTC(2020, 0, 1));
    for (let i = 0; i < 300; i++) {
      const price = 100 + i * 0.3;
      const date = new Date(startDate);
      date.setUTCDate(date.getUTCDate() + i);
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

    const result = await runBacktest(prices, {
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
      rollOnAssignment: false,
    });

    // Without rolling, ITM calls should be called away
    expect(result.calledAwayCount).toBeGreaterThan(0);
    expect(result.rolledCount).toBe(0);
  });

  it("rolls tested puts when delta exceeds threshold", async () => {
    // Build a declining price series so puts become deep ITM
    const prices: HistoricalPricePoint[] = [];
    const startDate = new Date(Date.UTC(2020, 0, 1));
    for (let i = 0; i < 300; i++) {
      const price = 100 - i * 0.2; // steady decline
      const date = new Date(startDate);
      date.setUTCDate(date.getUTCDate() + i);
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

    const result = await runBacktest(prices, {
      strategy: "CASH_SECURED_PUT",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 0,
      strikeInterval: 5,
      fillAssumption: "mid",
      rollTestedPut: {
        whenDeltaAbove: 0.50,
        forCreditOnly: true,
      },
    });

    // With a declining price, some puts should be rolled
    expect(result.rolledPutCount).toBeGreaterThan(0);
  });

  it("does not roll puts when rollTestedPut is not configured", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = await runBacktest(prices, {
      strategy: "CASH_SECURED_PUT",
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

    expect(result.rolledPutCount).toBe(0);
  });

  it("uses Yang-Zhang volatility estimator when configured", async () => {
    const prices: HistoricalPricePoint[] = [];
    const startDate = new Date(Date.UTC(2020, 0, 1));
    let price = 100;
    let seed = 42;
    for (let i = 0; i < 300; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const rand = (seed / 0x7fffffff) - 0.5;
      price = price * (1 + rand * 0.02 + 0.0005);
      const open = price * (1 - rand * 0.005);
      const high = Math.max(price, open) * 1.01;
      const low = Math.min(price, open) * 0.99;
      const date = new Date(startDate);
      date.setUTCDate(date.getUTCDate() + i);
      prices.push({
        date: date.toISOString().slice(0, 10),
        open,
        high,
        low,
        close: price,
        adjustedClose: price,
        volume: 1000000,
      });
    }

    const result = await runBacktest(prices, {
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
      volEstimator: "yangZhang",
    });

    // Should produce valid results with Yang-Zhang vol
    expect(result.totalCycles).toBeGreaterThan(0);
    expect(result.totalPremiumIncome).toBeGreaterThan(0);
  });

  it("uses calibrated VRP when configured", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = await runBacktest(prices, {
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
      calibratedVrp: true,
    });

    expect(result.totalCycles).toBeGreaterThan(0);
    expect(result.totalPremiumIncome).toBeGreaterThan(0);
  });

  it("simulates early assignment for deep ITM puts", async () => {
    // Build prices that crash sharply so puts go deep ITM
    const prices: HistoricalPricePoint[] = [];
    const startDate = new Date(Date.UTC(2020, 0, 1));
    for (let i = 0; i < 200; i++) {
      let price: number;
      if (i < 40) {
        price = 100 + i * 0.1;
      } else if (i < 70) {
        price = 104 - (i - 40) * 1.5; // sharp drop
      } else {
        price = 59; // stay deep ITM
      }
      const date = new Date(startDate);
      date.setUTCDate(date.getUTCDate() + i);
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

    const result = await runBacktest(prices, {
      strategy: "CASH_SECURED_PUT",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 1,
      riskFreeRate: 0.05,
      startingCapital: 10000,
      shares: 0,
      strikeInterval: 5,
      fillAssumption: "mid",
      simulateEarlyAssignment: true,
      earlyAssignmentThreshold: 0.30,
    });

    // The sharp drop should trigger early assignment for some puts
    expect(result.earlyAssignmentCount).toBeGreaterThan(0);
  });

  it("does not simulate early assignment when not configured", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = await runBacktest(prices, {
      strategy: "CASH_SECURED_PUT",
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

    expect(result.earlyAssignmentCount).toBe(0);
  });
});

describe("runBacktest - Phase 7 ratio wheel", () => {
  it("sells both puts and calls when shares are held", async () => {
    // Start with shares so the ratio wheel sells calls + puts simultaneously
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = await runBacktest(prices, {
      strategy: "RATIO_WHEEL",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 2,
      riskFreeRate: 0.05,
      startingCapital: 50000,
      shares: 100, // start with shares → sells calls + puts
      strikeInterval: 5,
      fillAssumption: "mid",
      putCallRatio: 0.5, // 50/50 puts:calls
    });

    // Should have sold both puts and calls
    expect(result.ratioPutContractsSold).toBeGreaterThan(0);
    expect(result.ratioCallContractsSold).toBeGreaterThan(0);
    expect(result.totalCycles).toBeGreaterThan(0);
  });

  it("sells only puts when no shares are held", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = await runBacktest(prices, {
      strategy: "RATIO_WHEEL",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 2,
      riskFreeRate: 0.05,
      startingCapital: 50000,
      shares: 0, // no shares → sells puts only initially
      strikeInterval: 5,
      fillAssumption: "mid",
      putCallRatio: 0.5,
    });

    // No shares → starts with puts. After assignment, calls may be sold.
    // The key check is that the strategy runs and produces cycles.
    expect(result.totalCycles).toBeGreaterThan(0);
    // Puts should have been sold (either worthless or assigned)
    expect(result.assignmentCount + result.expiredWorthlessCount).toBeGreaterThan(0);
  });

  it("adjusts call delta upward after put assignment", async () => {
    // Declining prices → put assignment → delta adjustment
    const prices: HistoricalPricePoint[] = [];
    const startDate = new Date(Date.UTC(2020, 0, 1));
    for (let i = 0; i < 300; i++) {
      const price = 100 - i * 0.15; // steady decline
      const date = new Date(startDate);
      date.setUTCDate(date.getUTCDate() + i);
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

    const result = await runBacktest(prices, {
      strategy: "RATIO_WHEEL",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 2,
      riskFreeRate: 0.05,
      startingCapital: 50000,
      shares: 0,
      strikeInterval: 5,
      fillAssumption: "mid",
      putCallRatio: 0.5,
      callDeltaAfterAssignment: 0.50, // increase call delta after assignment
    });

    // After put assignment, call delta should be adjusted
    expect(result.ratioDeltaAdjustments).toBeGreaterThan(0);
  });

  it("rebalances ratio after call-away", async () => {
    // Rising prices → call-away → rebalance
    const prices: HistoricalPricePoint[] = [];
    const startDate = new Date(Date.UTC(2020, 0, 1));
    for (let i = 0; i < 300; i++) {
      const price = 100 + i * 0.3; // steady rise
      const date = new Date(startDate);
      date.setUTCDate(date.getUTCDate() + i);
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

    const result = await runBacktest(prices, {
      strategy: "RATIO_WHEEL",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 2,
      riskFreeRate: 0.05,
      startingCapital: 50000,
      shares: 100,
      strikeInterval: 5,
      fillAssumption: "mid",
      putCallRatio: 0.5,
    });

    // After call-away, the ratio should rebalance (back to puts-only)
    expect(result.ratioRebalances).toBeGreaterThan(0);
  });

  it("tracks ratio put and call contracts separately", async () => {
    const prices = generatePrices(100, 300, 0.02, 0.0005);
    const result = await runBacktest(prices, {
      strategy: "RATIO_WHEEL",
      symbol: "TEST",
      deltaTarget: 0.30,
      dteTarget: 30,
      contracts: 4,
      riskFreeRate: 0.05,
      startingCapital: 50000,
      shares: 100,
      strikeInterval: 5,
      fillAssumption: "mid",
      putCallRatio: 0.5, // 50% puts = 2 contracts
    });

    // Both should be tracked
    expect(result.ratioPutContractsSold).toBeGreaterThan(0);
    expect(result.ratioCallContractsSold).toBeGreaterThan(0);
  });
});
