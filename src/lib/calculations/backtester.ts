/**
 * Strategy backtester — walks historical price data forward, simulating
 * a repeating options strategy and comparing results to buy-and-hold.
 *
 * The backtester uses historical prices + a pricing model (Black-Scholes)
 * to estimate option premiums at each historical date, since we don't have
 * historical option chain data. IV is approximated from realized volatility.
 *
 * Supported strategies:
 * - Covered call (sell calls against held shares)
 * - Cash secured put (sell puts, assignment = buy shares)
 * - Wheel (CSP → assignment → CC → called away → CSP)
 *
 * All functions are PURE and DETERMINISTIC. Unit-tested in ./backtester.test.ts.
 */

import type { HistoricalPricePoint } from "@/lib/types";
import { blackScholes, impliedVolatility } from "./pricing-model";
import { simpleAnnualizedRate } from "./core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BacktestStrategy = "COVERED_CALL" | "CASH_SECURED_PUT" | "WHEEL" | "BUY_AND_HOLD";

export interface BacktestConfig {
  strategy: BacktestStrategy;
  symbol: string;
  /** Delta target for short options (e.g. 0.30 for 30-delta) */
  deltaTarget: number;
  /** DTE target for each cycle in days */
  dteTarget: number;
  /** Number of contracts per cycle */
  contracts: number;
  /** Risk-free rate for pricing model */
  riskFreeRate: number;
  /** Starting capital for buy-and-hold comparison */
  startingCapital: number;
  /** Shares held (for covered call / wheel) */
  shares: number;
  /** Strike rounding interval (e.g. 5 for $5 strikes) */
  strikeInterval: number;
  /** Premium assumption: "bid" (conservative) or "mid" */
  fillAssumption: "bid" | "mid";
  /**
   * When true, covered calls are only sold at strikes >= the share cost basis
   * (the price paid for the shares — e.g. the put strike at assignment).
   * Prevents locking in a loss by selling a call below what you paid.
   */
  neverSellCallBelowCostBasis?: boolean;
}

export interface BacktestTrade {
  openDate: string;
  closeDate: string;
  optionType: "CALL" | "PUT";
  strike: number;
  premiumPerShare: number;
  contracts: number;
  premiumIncome: number;
  outcome: "EXPIRED_WORTHLESS" | "ASSIGNED" | "CALLED_AWAY" | "ROLLED";
  stockPriceAtOpen: number;
  stockPriceAtClose: number;
  /** P/L from this cycle including stock movement if assigned/called */
  cyclePnl: number;
  /** Days held */
  daysHeld: number;
  /** True when the cost-basis floor forced a higher strike than the delta target picked */
  flooredByCostBasis: boolean;
}

export interface BacktestResult {
  strategy: BacktestStrategy;
  symbol: string;
  startDate: string;
  endDate: string;
  trades: BacktestTrade[];
  totalPremiumIncome: number;
  totalCycles: number;
  winRate: number; // fraction of cycles that expired worthless
  avgPremiumPerCycle: number;
  avgDaysPerCycle: number;
  assignmentCount: number;
  calledAwayCount: number;
  expiredWorthlessCount: number;
  // Returns
  strategyReturn: number; // total return as decimal
  strategyAnnualizedReturn: number;
  buyHoldReturn: number;
  buyHoldAnnualizedReturn: number;
  outperformance: number; // strategy - buyHold
  // Risk
  maxDrawdown: number;
  sharpeRatio: number | null;
  // Equity curve
  equityCurve: { date: string; strategyEquity: number; buyHoldEquity: number }[];
  /** Cycles where the cost-basis floor raised the call strike above the delta-target pick */
  costBasisFlooredCount: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Rolling realized volatility over N trading days. */
function realizedVol(prices: HistoricalPricePoint[], endIdx: number, window: number): number {
  if (endIdx < window) return 0.3; // default fallback
  const slice = prices.slice(endIdx - window, endIdx);
  if (slice.length < 2) return 0.3;
  const logReturns: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    const prev = slice[i - 1];
    const curr = slice[i];
    if (!prev || !curr) continue;
    const r = Math.log(curr.adjustedClose / prev.adjustedClose);
    if (Number.isFinite(r)) logReturns.push(r);
  }
  if (logReturns.length < 2) return 0.3;
  const mean = logReturns.reduce((s, r) => s + r, 0) / logReturns.length;
  const variance = logReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (logReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

/**
 * Find the strike whose delta is closest to the target.
 *
 * When `minStrike` is provided (cost-basis floor for covered calls), strikes
 * below it are excluded. If the floor sits above the normal search range, the
 * floored strike itself is used — a deep-OTM call with near-zero premium,
 * which mirrors what a real account would see.
 */
function findStrikeByDelta(
  spot: number,
  iv: number,
  dte: number,
  riskFreeRate: number,
  optionType: "CALL" | "PUT",
  deltaTarget: number,
  strikeInterval: number,
  minStrike?: number,
): { strike: number; delta: number; premium: number; flooredByMin: boolean } {
  const T = dte / 365;

  const scan = (from: number, to: number) => {
    let best = { strike: from, delta: 0, premium: 0, diff: Infinity };
    for (let strike = from; strike <= to + 1e-9; strike += strikeInterval) {
      const bs = blackScholes({ spot, strike, timeToExpiry: T, riskFreeRate, volatility: iv, optionType });
      const delta = Math.abs(bs.greeks.delta ?? 0);
      const diff = Math.abs(delta - deltaTarget);
      if (diff < best.diff) {
        best = { strike, delta, premium: bs.price, diff };
      }
    }
    return best;
  };

  // Search strikes from 70% to 130% of spot
  const lowStrike = Math.floor(spot * 0.7 / strikeInterval) * strikeInterval;
  const highStrike = Math.ceil(spot * 1.3 / strikeInterval) * strikeInterval;

  const unconstrained = scan(lowStrike, highStrike);

  const minRounded =
    minStrike != null ? Math.ceil(minStrike / strikeInterval) * strikeInterval : null;

  if (minRounded != null && unconstrained.strike < minRounded) {
    const constrained = scan(minRounded, Math.max(highStrike, minRounded));
    return {
      strike: constrained.strike,
      delta: constrained.delta,
      premium: constrained.premium,
      flooredByMin: true,
    };
  }

  // Return the ACHIEVED delta, not the requested target.
  return {
    strike: unconstrained.strike,
    delta: unconstrained.delta,
    premium: unconstrained.premium,
    flooredByMin: false,
  };
}

/** Compute max drawdown from an equity curve. */
function maxDrawdown(equity: number[]): number {
  let peak = equity[0] ?? 0;
  let maxDd = 0;
  for (const value of equity) {
    if (value > peak) peak = value;
    const dd = (peak - value) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

/**
 * Compute Sharpe ratio from a series of PERIOD returns.
 *
 * `periodsPerYear` must match the sampling frequency of `returns`. The
 * backtester samples once per option cycle (not daily), so passing 252 here
 * would overstate Sharpe by sqrt(252 / cyclesPerYear).
 */
function sharpeRatio(
  returns: number[],
  periodsPerYear: number,
  riskFreeRate: number = 0.04,
): number | null {
  if (returns.length < 2 || periodsPerYear <= 0) return null;
  const periodRf = riskFreeRate / periodsPerYear;
  const excessReturns = returns.map((r) => r - periodRf);
  const mean = excessReturns.reduce((s, r) => s + r, 0) / excessReturns.length;
  const variance = excessReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (excessReturns.length - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return null;
  return (mean / stdDev) * Math.sqrt(periodsPerYear);
}

// ---------------------------------------------------------------------------
// Backtester
// ---------------------------------------------------------------------------

/**
 * Run a backtest of a repeating options strategy over historical price data.
 *
 * The simulation:
 * 1. Walks forward through historical prices at the DTE cadence
 * 2. At each cycle open: estimates IV from 30-day realized vol, finds the strike
 *    closest to the delta target, prices the option with Black-Scholes
 * 3. At cycle close (expiration): determines outcome (worthless, assigned, called away)
 * 4. Tracks premium income, assignment/call events, and equity curve
 * 5. Compares to buy-and-hold over the same period
 *
 * @param prices - Historical daily prices (oldest first)
 * @param config - Backtest configuration
 */
export function runBacktest(
  prices: HistoricalPricePoint[],
  config: BacktestConfig,
): BacktestResult {
  const warnings: string[] = [];

  if (prices.length < 60) {
    warnings.push("Insufficient historical data for backtesting (need 60+ trading days).");
  }

  const trades: BacktestTrade[] = [];
  const equityCurve: { date: string; strategyEquity: number; buyHoldEquity: number }[] = [];

  let strategyEquity = config.startingCapital;
  let buyHoldEquity = config.startingCapital;
  let sharesHeld = config.shares;
  /** Price paid for the currently held shares (put strike at assignment, or
   *  the spot price when a covered-call position was opened). */
  let shareCostBasis: number | null = null;
  let cashFromPremium = 0;
  let assignmentCount = 0;
  let calledAwayCount = 0;
  let expiredWorthlessCount = 0;
  let costBasisFlooredCount = 0;

  const firstPrice = prices[0];
  const lastPrice = prices[prices.length - 1];
  if (!firstPrice || !lastPrice) {
    return {
      strategy: config.strategy,
      symbol: config.symbol,
      startDate: "",
      endDate: "",
      trades: [],
      totalPremiumIncome: 0,
      totalCycles: 0,
      winRate: 0,
      avgPremiumPerCycle: 0,
      avgDaysPerCycle: 0,
      assignmentCount: 0,
      calledAwayCount: 0,
      expiredWorthlessCount: 0,
      strategyReturn: 0,
      strategyAnnualizedReturn: 0,
      buyHoldReturn: 0,
      buyHoldAnnualizedReturn: 0,
      outperformance: 0,
      maxDrawdown: 0,
      sharpeRatio: null,
      equityCurve: [],
      costBasisFlooredCount: 0,
      warnings: ["No price data available."],
    };
  }

  const buyHoldStartPrice = firstPrice.adjustedClose;
  const tradingDaysPerCycle = Math.round(config.dteTarget * 252 / 365);

  // Track per-cycle returns for Sharpe (one sample per option cycle, NOT daily).
  const cycleReturns: number[] = [];
  let prevStrategyEquity = strategyEquity;

  // Walk forward through prices
  let idx = 30; // start after 30 days for IV estimation
  while (idx < prices.length - 1) {
    const openPrice = prices[idx];
    if (!openPrice) { idx++; continue; }

    const spot = openPrice.adjustedClose;
    const iv = realizedVol(prices, idx, 30);

    // Determine option type based on strategy
    let optionType: "CALL" | "PUT";
    if (config.strategy === "COVERED_CALL") {
      optionType = "CALL";
    } else if (config.strategy === "CASH_SECURED_PUT") {
      optionType = "PUT";
    } else if (config.strategy === "WHEEL") {
      optionType = sharesHeld > 0 ? "CALL" : "PUT";
    } else {
      // BUY_AND_HOLD — no trades
      break;
    }

    // Establish cost basis the first time a covered call is sold
    // (shares are treated as bought at the first cycle's open price).
    if (optionType === "CALL" && shareCostBasis == null) {
      shareCostBasis = spot;
    }

    // Cost-basis floor: never sell a call below what we paid for the shares.
    const minCallStrike =
      optionType === "CALL" && config.neverSellCallBelowCostBasis && shareCostBasis != null
        ? shareCostBasis
        : undefined;

    // Find strike and price the option
    const { strike, premium, flooredByMin } = findStrikeByDelta(
      spot,
      iv,
      config.dteTarget,
      config.riskFreeRate,
      optionType,
      config.deltaTarget,
      config.strikeInterval,
      minCallStrike,
    );
    if (flooredByMin) costBasisFlooredCount++;

    // Apply fill assumption
    const fillPrice = config.fillAssumption === "bid" ? premium * 0.95 : premium;
    const premiumIncome = fillPrice * 100 * config.contracts;
    cashFromPremium += premiumIncome;

    // Find close date (DTE days later)
    const closeIdx = Math.min(idx + tradingDaysPerCycle, prices.length - 1);
    const closePrice = prices[closeIdx];
    if (!closePrice) { idx++; continue; }

    const closeSpot = closePrice.adjustedClose;
    let outcome: BacktestTrade["outcome"];
    let cyclePnl = premiumIncome; // start with premium

    if (optionType === "CALL") {
      // Short call against shares. Stock P/L is marked cycle-open -> cycle-close
      // for EVERY cycle so the equity curve tracks the shares continuously.
      // Upside is capped at the strike when the call finishes ITM.
      const stockExit = closeSpot > strike ? strike : closeSpot;
      const stockPnl = (stockExit - spot) * sharesHeld;
      if (closeSpot > strike) {
        outcome = "CALLED_AWAY";
        calledAwayCount++;
        cyclePnl = premiumIncome + stockPnl;
        if (config.strategy === "WHEEL") {
          sharesHeld = 0; // shares called away
          shareCostBasis = null;
        }
      } else {
        outcome = "EXPIRED_WORTHLESS";
        expiredWorthlessCount++;
        cyclePnl = premiumIncome + stockPnl;
      }
    } else {
      // Short put
      if (closeSpot < strike) {
        // Assigned — buy shares at strike
        outcome = "ASSIGNED";
        assignmentCount++;
        // P/L = premium - (strike - currentStockValue) * contracts * 100
        cyclePnl = premiumIncome - (strike - closeSpot) * config.contracts * 100;
        if (config.strategy === "WHEEL") {
          sharesHeld = config.contracts * 100; // shares assigned
          shareCostBasis = strike; // we "bought" the shares at the put strike
        }
      } else {
        outcome = "EXPIRED_WORTHLESS";
        expiredWorthlessCount++;
        cyclePnl = premiumIncome;
      }
    }

    trades.push({
      openDate: openPrice.date,
      closeDate: closePrice.date,
      optionType,
      strike,
      premiumPerShare: fillPrice,
      contracts: config.contracts,
      premiumIncome,
      outcome,
      stockPriceAtOpen: spot,
      stockPriceAtClose: closeSpot,
      cyclePnl,
      daysHeld: config.dteTarget,
      flooredByCostBasis: flooredByMin,
    });

    // Update equity
    strategyEquity += cyclePnl;
    const cycleReturn = (strategyEquity - prevStrategyEquity) / prevStrategyEquity;
    if (Number.isFinite(cycleReturn)) cycleReturns.push(cycleReturn);
    prevStrategyEquity = strategyEquity;

    // Update buy-and-hold
    buyHoldEquity = config.startingCapital * (closeSpot / buyHoldStartPrice);

    equityCurve.push({
      date: closePrice.date,
      strategyEquity,
      buyHoldEquity,
    });

    idx = closeIdx;
  }

  // NOTE: stock P/L is already marked into each cycle above (cycle-open ->
  // cycle-close, capped at the strike when called away). Do NOT add
  // full-period appreciation here or the stock move is counted twice.

  const totalDays = prices.length;
  const years = totalDays / 252;

  const strategyReturn = (strategyEquity - config.startingCapital) / config.startingCapital;
  const buyHoldReturn = (lastPrice.adjustedClose - buyHoldStartPrice) / buyHoldStartPrice;

  const strategyAnnualized = simpleAnnualizedRate(strategyReturn, years * 365);
  const buyHoldAnnualized = simpleAnnualizedRate(buyHoldReturn, years * 365);

  const strategyEquityValues = equityCurve.map((e) => e.strategyEquity);
  const dd = maxDrawdown(strategyEquityValues.length > 0 ? strategyEquityValues : [config.startingCapital]);
  const cyclesPerYear = config.dteTarget > 0 ? 365 / config.dteTarget : 0;
  const sr = sharpeRatio(cycleReturns, cyclesPerYear, config.riskFreeRate);

  return {
    strategy: config.strategy,
    symbol: config.symbol,
    startDate: firstPrice.date,
    endDate: lastPrice.date,
    trades,
    totalPremiumIncome: cashFromPremium,
    totalCycles: trades.length,
    winRate: trades.length > 0 ? expiredWorthlessCount / trades.length : 0,
    avgPremiumPerCycle: trades.length > 0 ? cashFromPremium / trades.length : 0,
    avgDaysPerCycle: config.dteTarget,
    assignmentCount,
    calledAwayCount,
    expiredWorthlessCount,
    strategyReturn,
    strategyAnnualizedReturn: strategyAnnualized,
    buyHoldReturn,
    buyHoldAnnualizedReturn: buyHoldAnnualized,
    outperformance: strategyReturn - buyHoldReturn,
    maxDrawdown: dd,
    sharpeRatio: sr,
    equityCurve,
    costBasisFlooredCount,
    warnings,
  };
}
