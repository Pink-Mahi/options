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

/** Round strike to the nearest interval. */
function roundStrike(price: number, interval: number): number {
  return Math.round(price / interval) * interval;
}

/** Find the strike whose delta is closest to the target. */
function findStrikeByDelta(
  spot: number,
  iv: number,
  dte: number,
  riskFreeRate: number,
  optionType: "CALL" | "PUT",
  deltaTarget: number,
  strikeInterval: number,
): { strike: number; delta: number; premium: number } {
  let bestStrike = roundStrike(spot, strikeInterval);
  let bestDeltaDiff = Infinity;
  let bestPremium = 0;

  // Search strikes from 70% to 130% of spot
  const lowStrike = Math.floor(spot * 0.7 / strikeInterval) * strikeInterval;
  const highStrike = Math.ceil(spot * 1.3 / strikeInterval) * strikeInterval;

  for (let strike = lowStrike; strike <= highStrike; strike += strikeInterval) {
    const T = dte / 365;
    const bs = blackScholes({ spot, strike, timeToExpiry: T, riskFreeRate, volatility: iv, optionType });
    const delta = Math.abs(bs.greeks.delta ?? 0);
    const diff = Math.abs(delta - deltaTarget);
    if (diff < bestDeltaDiff) {
      bestDeltaDiff = diff;
      bestStrike = strike;
      bestPremium = bs.price;
    }
  }

  return { strike: bestStrike, delta: deltaTarget, premium: bestPremium };
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

/** Compute Sharpe ratio from a return series (annualized, assuming 252 trading days). */
function sharpeRatio(returns: number[], riskFreeRate: number = 0.04): number | null {
  if (returns.length < 2) return null;
  const dailyRf = riskFreeRate / 252;
  const excessReturns = returns.map((r) => r - dailyRf);
  const mean = excessReturns.reduce((s, r) => s + r, 0) / excessReturns.length;
  const variance = excessReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (excessReturns.length - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return null;
  return (mean / stdDev) * Math.sqrt(252);
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
  let cashFromPremium = 0;
  let assignmentCount = 0;
  let calledAwayCount = 0;
  let expiredWorthlessCount = 0;

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
      warnings: ["No price data available."],
    };
  }

  const buyHoldStartPrice = firstPrice.adjustedClose;
  const tradingDaysPerCycle = Math.round(config.dteTarget * 252 / 365);

  // Track daily returns for Sharpe
  const dailyReturns: number[] = [];
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

    // Find strike and price the option
    const { strike, premium } = findStrikeByDelta(
      spot,
      iv,
      config.dteTarget,
      config.riskFreeRate,
      optionType,
      config.deltaTarget,
      config.strikeInterval,
    );

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
      // Short call
      if (closeSpot > strike) {
        // Called away — stock sold at strike
        outcome = "CALLED_AWAY";
        calledAwayCount++;
        // P/L = premium + (strike - currentStockValue) * shares
        cyclePnl = premiumIncome + (strike - spot) * sharesHeld;
        if (config.strategy === "WHEEL") {
          sharesHeld = 0; // shares called away
        }
      } else {
        outcome = "EXPIRED_WORTHLESS";
        expiredWorthlessCount++;
        cyclePnl = premiumIncome;
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
    });

    // Update equity
    strategyEquity += cyclePnl;
    const dailyReturn = (strategyEquity - prevStrategyEquity) / prevStrategyEquity;
    if (Number.isFinite(dailyReturn)) dailyReturns.push(dailyReturn);
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

  // For covered call / wheel, add stock value to strategy equity
  if (sharesHeld > 0 && lastPrice) {
    strategyEquity += (lastPrice.adjustedClose - firstPrice.adjustedClose) * sharesHeld;
  }

  const totalDays = prices.length;
  const years = totalDays / 252;

  const strategyReturn = (strategyEquity - config.startingCapital) / config.startingCapital;
  const buyHoldReturn = (lastPrice.adjustedClose - buyHoldStartPrice) / buyHoldStartPrice;

  const strategyAnnualized = simpleAnnualizedRate(strategyReturn, years * 365);
  const buyHoldAnnualized = simpleAnnualizedRate(buyHoldReturn, years * 365);

  const strategyEquityValues = equityCurve.map((e) => e.strategyEquity);
  const dd = maxDrawdown(strategyEquityValues.length > 0 ? strategyEquityValues : [config.startingCapital]);
  const sr = sharpeRatio(dailyReturns, config.riskFreeRate);

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
    warnings,
  };
}
