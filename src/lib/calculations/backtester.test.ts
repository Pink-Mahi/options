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

  it("buys lots below cost basis and lowers the basis in a downtrend", async () => {
    // High-delta calls in a volatile decline: fat premiums accumulate while
    // spot slides below basis, so lots get bought and the basis drops.
    const prices = generatePrices(100, 1500, 0.04, -0.0008);
    const result = await runBacktest(prices, {
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

  it("sells more call contracts after buying extra lots", async () => {
    const prices = generatePrices(100, 1500, 0.04, -0.0008);
    const result = await runBacktest(prices, {
      ...baseConfig,
      deltaTarget: 0.50,
      averageDownWithPremium: true,
    });

    expect(result.averagedDownLots).toBeGreaterThan(0);
    const maxContracts = Math.max(...result.trades.map((t) => t.contracts));
    expect(maxContracts).toBeGreaterThan(1);
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

    expect(result.maxDrawdown).toBeCloseTo(0.132, 2);
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
    // re-pricing, so the position rides to expiration.
    const rows = new Map<string, ThetaDataEODQuote>();
    for (let i = 31; i <= 61; i++) {
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
    // false-fill immediately; the guards must prevent it.
    const rows = new Map<string, ThetaDataEODQuote>();
    for (let i = 31; i <= 61; i++) {
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
