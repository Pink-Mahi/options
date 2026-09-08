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
import { blackScholes } from "./pricing-model";
import { simpleAnnualizedRate } from "./core";
import type { MarketContext } from "./market-context";
import { analyzeMarketContext } from "./market-context";
import type { ThetaDataEODQuote } from "@/features/market-data/thetadata";
import { findContractByDelta } from "@/features/market-data/thetadata";

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
  /** Annual dividend yield (e.g. 0.015 for 1.5%). Used in BS pricing. */
  dividendYield?: number;
  /** IV risk premium multiplier applied to realized vol (e.g. 1.15 = 15% premium). Default 1.15. */
  ivRiskPremium?: number;
  /** When true, applies equity IV skew (OTM puts trade at higher IV). Default true. */
  ivSkewEnabled?: boolean;
  /** When true, adjusts IV for DTE term structure. Default true. */
  termStructureEnabled?: boolean;
  /**
   * When true, covered calls are only sold at strikes >= the share cost basis
   * (the price paid for the shares — e.g. the put strike at assignment).
   * Prevents locking in a loss by selling a call below what you paid.
   */
  neverSellCallBelowCostBasis?: boolean;
  /**
   * Minimum call premium yield as a decimal (e.g. 0.025 = 2.5% of spot).
   * Simulates a resting GTC limit order: the backtester re-checks the modeled
   * premium every 5 trading days within the cycle and only "fills" when the
   * yield meets this floor. Unfilled cycles are recorded as NO_FILL.
   */
  minCallPremiumYieldPct?: number;
  /**
   * Minimum put premium yield as a decimal (e.g. 0.015 = 1.5% of spot).
   * Same GTC limit-order simulation as calls, but for put entries.
   */
  minPutPremiumYieldPct?: number;
  /**
   * When true, accumulated premium is reinvested into 100-share lots whenever
   * the stock trades below the current cost basis — averaging the basis down so
   * future calls can be sold at lower strikes without violating the floor.
   */
  averageDownWithPremium?: boolean;
  /**
   * GTC buy-back target as a fraction of max profit (e.g. 0.5 = buy back when
   * the option is worth half what it was sold for). The backtester re-prices
   * the open option daily and closes early when the target is reached, freeing
   * capital for the next cycle sooner. 0/undefined = hold to expiration.
   */
  buyBackPct?: number;
  /**
   * When true, ITM calls at expiration are rolled (bought back at intrinsic)
   * instead of being called away. Shares stay held and the wheel stays in
   * the call phase.
   */
  rollOnAssignment?: boolean;
  /**
   * Optional map of date (YYYY-MM-DD) → real EOD option quotes from ThetaData.
   * When available for a cycle date, the backtester uses real bid/ask and
   * backs out IV from market prices instead of using the BS model.
   */
  realData?: Map<string, ThetaDataEODQuote[]>;
}

export interface BacktestTrade {
  openDate: string;
  closeDate: string;
  optionType: "CALL" | "PUT";
  strike: number;
  premiumPerShare: number;
  contracts: number;
  premiumIncome: number;
  outcome: "EXPIRED_WORTHLESS" | "ASSIGNED" | "CALLED_AWAY" | "ROLLED" | "NO_FILL" | "BOUGHT_BACK";
  stockPriceAtOpen: number;
  stockPriceAtClose: number;
  /** P/L from this cycle including stock movement if assigned/called */
  cyclePnl: number;
  /** Days held */
  daysHeld: number;
  /** True when the cost-basis floor forced a higher strike than the delta target picked */
  flooredByCostBasis: boolean;
  /** Premium as a fraction of the stock price at open (e.g. 0.025 = 2.5%) */
  premiumYield: number;
  /** Price per share paid to buy the option back early (null if held to expiry) */
  exitPremium: number | null;
  /** Whether this cycle used real ThetaData quotes or BS-modeled premiums */
  dataSource: "REAL" | "BS_MODEL";
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
  /** Call cycles where the GTC limit order never filled (min yield not reached) */
  noFillCount: number;
  /** Fraction of call cycles that filled (1 when no yield floor is set) */
  callFillRate: number;
  /** Average premium yield across filled call trades */
  avgCallPremiumYield: number;
  /** Extra 100-share lots bought by reinvesting premium below cost basis */
  averagedDownLots: number;
  /** Total premium dollars reinvested into share purchases */
  reinvestedPremium: number;
  /** Shares held at the end of the backtest */
  endingShares: number;
  /** Cost basis of held shares at the end (null if no shares held) */
  endingCostBasis: number | null;
  /** Cycles closed early by the GTC buy-back order */
  earlyCloseCount: number;
  /** Put cycles where the GTC limit never filled */
  putNoFillCount: number;
  /** Fraction of put cycles that filled */
  putFillRate: number;
  /** Average premium yield across filled put trades */
  avgPutPremiumYield: number;
  /** Calls rolled (bought back ITM) instead of called away */
  rolledCount: number;
  /** Market context analysis (benchmark comparison, regime, drawdown attribution). Null when no benchmark data provided. */
  marketContext: MarketContext | null;
  /** Number of cycles that used real ThetaData bid/ask instead of BS model */
  realDataCycles: number;
  /** Number of cycles that fell back to BS model (no real data available) */
  bsModelCycles: number;
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
 * Apply IV risk premium to realized vol.
 * Real-world IV is typically 10-25% higher than realized vol (the volatility risk premium).
 * Default multiplier: 1.15 (15% premium).
 */
function applyRiskPremium(rv: number, multiplier: number): number {
  return Math.min(rv * multiplier, 5.0); // cap at 500% to avoid extreme values
}

/**
 * Apply equity IV skew model.
 * Real options markets show a "smile/smirk" where OTM puts trade at higher IV
 * than ATM, and OTM calls trade at slightly lower IV.
 *
 * Model: IV(strike) = baseIV * (1 + skewSlope * moneyness)
 * where moneyness = (spot - strike) / spot for puts (positive when OTM)
 * and moneyness = (strike - spot) / spot for calls (positive when OTM).
 *
 * For puts: OTM puts (strike < spot) get +IV premium (skewSlope positive)
 * For calls: OTM calls (strike > spot) get slight -IV discount
 */
function applySkew(
  baseIV: number,
  spot: number,
  strike: number,
  optionType: "CALL" | "PUT",
): number {
  const moneyness = optionType === "PUT"
    ? (spot - strike) / spot  // positive when OTM put (strike below spot)
    : (strike - spot) / spot; // positive when OTM call (strike above spot)

  // Equity skew: puts get ~2 IV points per 10% OTM, calls get ~0.5 IV points discount
  const skewSlope = optionType === "PUT" ? 0.20 : 0.05;
  const skewAdjustment = skewSlope * moneyness;

  return Math.max(baseIV * (1 + skewAdjustment), 0.05);
}

/**
 * Apply term structure adjustment.
 * Short-dated options tend to have slightly higher IV (near-term uncertainty)
 * while longer-dated options have lower IV (mean-reversion).
 *
 * Model: IV(dte) = baseIV * (1 + termFactor * (30/dte - 1))
 * At dte=30: no adjustment. At dte=7: ~4% higher. At dte=180: ~8% lower.
 */
function applyTermStructure(baseIV: number, dte: number): number {
  if (dte <= 0) return baseIV;
  const termFactor = 0.15; // 15% adjustment factor
  const adjustment = termFactor * (30 / dte - 1);
  return Math.max(baseIV * (1 + adjustment), 0.05);
}

/**
 * Estimate bid/ask spread as a fraction of option mid price.
 * Real spreads vary by liquidity, stock price, and option moneyness.
 *
 * Model: spread% = baseSpread + liquidityFactor + moneynessFactor
 * - Liquid stocks (high volume, low price): tighter spreads
 * - Illiquid or low-priced options: wider spreads
 * - Deep OTM options: wider spreads
 */
function estimateBidAskSpread(
  midPrice: number,
  spot: number,
  strike: number,
  optionType: "CALL" | "PUT",
): number {
  // Base spread: wider for cheaper options (percentage-wise)
  let spreadPct = 0.05; // 5% default

  if (midPrice < 0.50) spreadPct = 0.15;       // very cheap option: 15%
  else if (midPrice < 1.0) spreadPct = 0.10;    // cheap: 10%
  else if (midPrice < 5.0) spreadPct = 0.05;    // moderate: 5%
  else if (midPrice < 25.0) spreadPct = 0.03;   // liquid: 3%
  else spreadPct = 0.02;                         // very liquid: 2%

  // Wider spreads for deep OTM
  const moneyness = optionType === "PUT"
    ? Math.abs((spot - strike) / spot)
    : Math.abs((strike - spot) / spot);
  if (moneyness > 0.15) spreadPct += 0.03; // deep OTM: +3%

  return Math.min(spreadPct, 0.25); // cap at 25%
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
  dividendYield?: number,
  ivSkewEnabled?: boolean,
  termStructureEnabled?: boolean,
): { strike: number; delta: number; premium: number; flooredByMin: boolean } {
  const T = dte / 365;

  // Apply term structure to base IV
  const baseIV = termStructureEnabled !== false
    ? applyTermStructure(iv, dte)
    : iv;

  const scan = (from: number, to: number) => {
    let best = { strike: from, delta: 0, premium: 0, diff: Infinity };
    for (let strike = from; strike <= to + 1e-9; strike += strikeInterval) {
      // Apply skew per-strike
      const strikeIV = ivSkewEnabled !== false
        ? applySkew(baseIV, spot, strike, optionType)
        : baseIV;
      const bs = blackScholes({ spot, strike, timeToExpiry: T, riskFreeRate, volatility: strikeIV, dividendYield, optionType });
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
  benchmarkPrices?: HistoricalPricePoint[],
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
  let noFillCount = 0;
  let callCycleCount = 0;
  let callPremiumYieldSum = 0;
  /** Spendable premium cash (gross collected minus reinvested) */
  let premiumCash = 0;
  let averagedDownLots = 0;
  let reinvestedPremium = 0;
  let earlyCloseCount = 0;
  let putNoFillCount = 0;
  let putCycleCount = 0;
  let putPremiumYieldSum = 0;
  let rolledCount = 0;
  let realDataCycles = 0;
  let bsModelCycles = 0;

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
      noFillCount: 0,
      callFillRate: 1,
      avgCallPremiumYield: 0,
      averagedDownLots: 0,
      reinvestedPremium: 0,
      endingShares: 0,
      endingCostBasis: null,
      earlyCloseCount: 0,
      putNoFillCount: 0,
      putFillRate: 1,
      avgPutPremiumYield: 0,
      rolledCount: 0,
      marketContext: null,
      realDataCycles: 0,
      bsModelCycles: 0,
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
    const rv = realizedVol(prices, idx, 30);
    const iv = applyRiskPremium(rv, config.ivRiskPremium ?? 1.15);

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

    // --- Reinvest premium to average down ---------------------------------
    // When the stock trades below our cost basis, spend accumulated premium on
    // 100-share lots. Each lot lowers the weighted-average basis, which lowers
    // the floor for future call sales and adds another sellable contract.
    if (
      config.averageDownWithPremium &&
      sharesHeld > 0 &&
      shareCostBasis != null &&
      spot < shareCostBasis
    ) {
      while (premiumCash >= spot * 100) {
        shareCostBasis =
          (shareCostBasis * sharesHeld + spot * 100) / (sharesHeld + 100);
        sharesHeld += 100;
        premiumCash -= spot * 100;
        reinvestedPremium += spot * 100;
        averagedDownLots++;
      }
    }

    // Calls are sold one contract per 100 shares held; puts stay at the
    // configured contract count.
    const activeContracts =
      optionType === "CALL" ? Math.max(1, Math.floor(sharesHeld / 100)) : config.contracts;

    // Cost-basis floor: never sell a call below what we paid for the shares.
    const minCallStrike =
      optionType === "CALL" && config.neverSellCallBelowCostBasis && shareCostBasis != null
        ? shareCostBasis
        : undefined;

    // Cycle window: the option always expires tradingDaysPerCycle after the
    // cycle starts, even if the GTC limit fills partway through.
    const closeIdx = Math.min(idx + tradingDaysPerCycle, prices.length - 1);
    const closePrice = prices[closeIdx];
    if (!closePrice) { idx++; continue; }
    const closeSpot = closePrice.adjustedClose;

    // --- Fill logic: real data (ThetaData) or BS model -------------------
    let dataSource: "REAL" | "BS_MODEL" = "BS_MODEL";
    let openSpot = spot;
    let openDate = openPrice.date;
    let openIdx = idx;
    let strike = 0;
    let premium = 0;
    let flooredByMin = false;
    let filled = true;
    let fillPrice = 0;

    const yieldFloor =
      optionType === "CALL"
        ? (config.minCallPremiumYieldPct ?? 0)
        : (config.minPutPremiumYieldPct ?? 0);

    // Check for real ThetaData quotes for this cycle date
    const realQuotes = config.realData?.get(openPrice.date);
    const realContract = realQuotes && realQuotes.length > 0
      ? findContractByDelta(
          realQuotes,
          spot,
          config.deltaTarget,
          optionType,
          config.dteTarget,
          config.riskFreeRate,
          config.dividendYield,
          minCallStrike,
        )
      : null;

    if (realContract) {
      // --- Real data path: use actual market bid/ask ---
      dataSource = "REAL";
      realDataCycles++;
      strike = realContract.strike;
      premium = realContract.mid;
      fillPrice = config.fillAssumption === "bid"
        ? realContract.bid
        : realContract.mid;
      if (yieldFloor > 0 && openSpot > 0 && fillPrice / openSpot < yieldFloor) {
        filled = false;
        fillPrice = 0;
      }
    } else {
      // --- BS model path (existing logic) ---
      bsModelCycles++;
      if (yieldFloor > 0) {
        filled = false;
        for (let tryIdx = idx; tryIdx <= closeIdx; tryIdx += 5) {
          const tryPoint = prices[tryIdx];
          if (!tryPoint) continue;
          const trySpot = tryPoint.adjustedClose;
          const tryRv = realizedVol(prices, tryIdx, 30);
          const tryIv = applyRiskPremium(tryRv, config.ivRiskPremium ?? 1.15);
          const elapsedDays =
            (new Date(tryPoint.date).getTime() - new Date(openPrice.date).getTime()) /
            (1000 * 60 * 60 * 24);
          const remainingDte = Math.max(1, config.dteTarget - elapsedDays);
          const res = findStrikeByDelta(
            trySpot,
            tryIv,
            remainingDte,
            config.riskFreeRate,
            optionType,
            config.deltaTarget,
            config.strikeInterval,
            minCallStrike,
            config.dividendYield,
            config.ivSkewEnabled,
            config.termStructureEnabled,
          );
          const trySpread = estimateBidAskSpread(res.premium, trySpot, res.strike, optionType);
          const tryFill = config.fillAssumption === "bid"
            ? res.premium * (1 - trySpread / 2)
            : res.premium;
          if (trySpot > 0 && tryFill / trySpot >= yieldFloor) {
            filled = true;
            openSpot = trySpot;
            openDate = tryPoint.date;
            openIdx = tryIdx;
            strike = res.strike;
            premium = res.premium;
            flooredByMin = res.flooredByMin;
            break;
          }
          strike = res.strike;
        }
      } else {
        const res = findStrikeByDelta(
          spot,
          iv,
          config.dteTarget,
          config.riskFreeRate,
          optionType,
          config.deltaTarget,
          config.strikeInterval,
          minCallStrike,
          config.dividendYield,
          config.ivSkewEnabled,
          config.termStructureEnabled,
        );
        strike = res.strike;
        premium = res.premium;
        flooredByMin = res.flooredByMin;
      }
      if (flooredByMin) costBasisFlooredCount++;
      // Apply fill assumption with variable bid/ask spread
      const spreadPct = filled ? estimateBidAskSpread(premium, openSpot, strike, optionType) : 0;
      fillPrice = filled
        ? config.fillAssumption === "bid"
          ? premium * (1 - spreadPct / 2)
          : premium
        : 0;
    }

    const premiumIncome = fillPrice * 100 * activeContracts;
    cashFromPremium += premiumIncome;
    premiumCash += premiumIncome;
    const premiumYield = filled && openSpot > 0 ? fillPrice / openSpot : 0;
    if (optionType === "CALL") {
      callCycleCount++;
      if (filled) callPremiumYieldSum += premiumYield;
    } else {
      putCycleCount++;
      if (filled) putPremiumYieldSum += premiumYield;
    }

    // --- GTC buy-back simulation ------------------------------------------
    // A resting limit order to close the position once the option decays to
    // (1 - buyBackPct) of the sale price. Checked daily from fill to expiry.
    const buyBackPct = config.buyBackPct ?? 0;
    let exitPremium: number | null = null;
    let effCloseIdx = closeIdx;
    let effCloseDate = closePrice.date;
    let effCloseSpot = closeSpot;

    if (filled && buyBackPct > 0 && buyBackPct < 1) {
      const trigger = fillPrice * (1 - buyBackPct);
      for (let d = openIdx + 1; d <= closeIdx; d++) {
        const p = prices[d];
        if (!p) continue;
        const dSpot = p.adjustedClose;
        const dRv = realizedVol(prices, d, 30);
        const dIv = applyRiskPremium(dRv, config.ivRiskPremium ?? 1.15);
        const remainingDays =
          (new Date(closePrice.date).getTime() - new Date(p.date).getTime()) /
          (1000 * 60 * 60 * 24);
        const dBaseIv = config.termStructureEnabled !== false
          ? applyTermStructure(dIv, Math.max(remainingDays, 0.5))
          : dIv;
        const dStrikeIv = config.ivSkewEnabled !== false
          ? applySkew(dBaseIv, dSpot, strike, optionType)
          : dBaseIv;
        const bs = blackScholes({
          spot: dSpot,
          strike,
          timeToExpiry: Math.max(remainingDays, 0.5) / 365,
          riskFreeRate: config.riskFreeRate,
          volatility: dStrikeIv,
          dividendYield: config.dividendYield,
          optionType,
        });
        if (bs.price <= trigger) {
          exitPremium = bs.price;
          effCloseIdx = d;
          effCloseDate = p.date;
          effCloseSpot = dSpot;
          break;
        }
      }
    }

    let outcome: BacktestTrade["outcome"];
    let cyclePnl = premiumIncome; // start with premium

    if (!filled) {
      // GTC limit never reached — no position opened this cycle.
      outcome = "NO_FILL";
      noFillCount++;
      if (optionType === "CALL") {
        cyclePnl = (effCloseSpot - openSpot) * sharesHeld;
      } else {
        putNoFillCount++;
        cyclePnl = 0;
      }
    } else if (exitPremium != null) {
      // Bought back early at the GTC target — keep the difference as profit.
      outcome = "BOUGHT_BACK";
      earlyCloseCount++;
      const buybackCost = exitPremium * 100 * activeContracts;
      if (optionType === "CALL") {
        // Shares still held; mark stock move open -> buyback date.
        cyclePnl = premiumIncome - buybackCost + (effCloseSpot - openSpot) * sharesHeld;
      } else {
        cyclePnl = premiumIncome - buybackCost;
      }
    } else if (optionType === "CALL") {
      // Short call against shares. Stock P/L is marked cycle-open -> cycle-close
      // for EVERY cycle so the equity curve tracks the shares continuously.
      // Upside is capped at the strike when the call finishes ITM.
      const stockExit = effCloseSpot > strike ? strike : effCloseSpot;
      const stockPnl = (stockExit - openSpot) * sharesHeld;
      if (effCloseSpot > strike) {
        if (config.rollOnAssignment) {
          // Roll: buy back ITM call at intrinsic, keep shares
          outcome = "ROLLED";
          rolledCount++;
          const buybackCost = (effCloseSpot - strike) * 100 * activeContracts;
          cyclePnl = premiumIncome - buybackCost + (effCloseSpot - openSpot) * sharesHeld;
        } else {
          outcome = "CALLED_AWAY";
          calledAwayCount++;
          cyclePnl = premiumIncome + stockPnl;
          if (config.strategy === "WHEEL") {
            sharesHeld = 0;
            shareCostBasis = null;
          }
        }
      } else {
        outcome = "EXPIRED_WORTHLESS";
        expiredWorthlessCount++;
        cyclePnl = premiumIncome + stockPnl;
      }
    } else {
      // Short put
      if (effCloseSpot < strike) {
        // Assigned — buy shares at strike
        outcome = "ASSIGNED";
        assignmentCount++;
        // P/L = premium - (strike - currentStockValue) * contracts * 100
        cyclePnl = premiumIncome - (strike - effCloseSpot) * config.contracts * 100;
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

    const daysHeld = Math.max(
      1,
      Math.round(
        (new Date(effCloseDate).getTime() - new Date(openDate).getTime()) /
          (1000 * 60 * 60 * 24),
      ),
    );

    trades.push({
      openDate,
      closeDate: effCloseDate,
      optionType,
      strike,
      premiumPerShare: fillPrice,
      contracts: activeContracts,
      premiumIncome,
      outcome,
      stockPriceAtOpen: openSpot,
      stockPriceAtClose: effCloseSpot,
      cyclePnl,
      daysHeld,
      flooredByCostBasis: flooredByMin,
      premiumYield,
      exitPremium,
      dataSource,
    });

    // Update equity
    strategyEquity += cyclePnl;
    const cycleReturn = (strategyEquity - prevStrategyEquity) / prevStrategyEquity;
    if (Number.isFinite(cycleReturn)) cycleReturns.push(cycleReturn);
    prevStrategyEquity = strategyEquity;

    // Update buy-and-hold
    buyHoldEquity = config.startingCapital * (effCloseSpot / buyHoldStartPrice);

    equityCurve.push({
      date: effCloseDate,
      strategyEquity,
      buyHoldEquity,
    });

    idx = effCloseIdx;
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

  // Compute market context if benchmark data was provided
  let marketContext: MarketContext | null = null;
  if (benchmarkPrices && benchmarkPrices.length > 30) {
    marketContext = analyzeMarketContext(
      prices,
      benchmarkPrices,
      "SPY",
      config.startingCapital,
    );
  }

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
    avgDaysPerCycle:
      trades.length > 0
        ? trades.reduce((s, t) => s + t.daysHeld, 0) / trades.length
        : 0,
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
    noFillCount,
    callFillRate: callCycleCount > 0 ? (callCycleCount - noFillCount) / callCycleCount : 1,
    avgCallPremiumYield:
      callCycleCount - noFillCount > 0 ? callPremiumYieldSum / (callCycleCount - noFillCount) : 0,
    averagedDownLots,
    reinvestedPremium,
    endingShares: sharesHeld,
    endingCostBasis: shareCostBasis,
    earlyCloseCount,
    putNoFillCount,
    putFillRate: putCycleCount > 0 ? (putCycleCount - putNoFillCount) / putCycleCount : 1,
    avgPutPremiumYield:
      putCycleCount - putNoFillCount > 0 ? putPremiumYieldSum / (putCycleCount - putNoFillCount) : 0,
    rolledCount,
    marketContext,
    realDataCycles,
    bsModelCycles,
    warnings,
  };
}
