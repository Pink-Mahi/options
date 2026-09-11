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
import {
  yangZhangVolatility,
  garmanKlassVolatility,
  calibratedImpliedVol,
  classifyVolRegime,
  shouldSimulateEarlyAssignment,
} from "@/lib/quant/volatility";
import { compoundAnnualizedRate } from "./core";
import type { MarketContext } from "./market-context";
import { analyzeMarketContext } from "./market-context";
import type { ThetaDataEODQuote } from "@/features/market-data/thetadata";
import { findContractByDelta } from "@/features/market-data/thetadata";
import { maxDrawdown as quantMaxDrawdown, sharpe as quantSharpe, sortino as quantSortino } from "@/lib/quant/statistics";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BacktestStrategy = "COVERED_CALL" | "CASH_SECURED_PUT" | "WHEEL" | "RATIO_WHEEL" | "BUY_AND_HOLD";

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
  /**
   * Optional async provider of daily EOD rows (bid/ask/high/low/close) for a
   * specific contract from cycle open through expiration. When provided and
   * rows exist, GTC orders use intraday-touch semantics: the buy-back fills
   * the first day the option trades through the trigger (ask or traded low
   * at/below it), and a resting min-yield sell order fills the first day the
   * bid (or traded high) reaches the target. Days without rows fall back to
   * the modeled checks. Only invoked for cycles with real chain data.
   */
  getDailyRows?: (contract: {
    optionType: "CALL" | "PUT";
    strike: number;
    expiration: string;
    from: string;
    to: string;
  }) => Promise<Map<string, ThetaDataEODQuote>>;
  /**
   * Per-contract commission charged on every option open, buy-back, and roll.
   * Default 0.65 (typical US retail). Set to 0 to disable.
   */
  commissionPerContract?: number;
  /** Flat fee charged on assignment or exercise/called-away events. Default 0. */
  assignmentFee?: number;
  /** Slippage per share on top of the bid fill assumption (default 0.01). */
  slippagePerShare?: number;
  /** When true (default), idle cash accrues interest at riskFreeRate. */
  cashInterestEnabled?: boolean;
  /** When true (default), the BS path snaps cycle close to the nearest Friday
   *  expiration instead of using idx + tradingDaysPerCycle. Set false for
   *  names that only have monthly expirations (3rd Friday). */
  hasWeeklies?: boolean;
  /** When true, the BS path snaps cycle close to the nearest Friday expiration
   *  instead of using idx + tradingDaysPerCycle. Default false for backward
   *  compatibility. The real-data path always uses the real expiration
   *  regardless of this setting. */
  snapExpiration?: boolean;
  // --- Phase 5: Real wheel management rules ---
  /** Roll a tested put (delta exceeds threshold) to a later expiration and
   *  lower strike, deferring assignment. Only rolls for a credit. */
  rollTestedPut?: {
    /** Roll when the short put's delta exceeds this value (e.g. 0.50). */
    whenDeltaAbove: number;
    /** Only roll if the new put can be sold for a net credit. */
    forCreditOnly: boolean;
  };
  /** Close the open option early when DTE drops to this level (e.g. 21 days).
   *  Frees capital for the next cycle sooner. 0/undefined = hold to expiry. */
  manageAtDte?: number;
  /** Close the open option when its loss reaches this multiple of the premium
   *  collected (e.g. 2 = close when the option costs 2× the credit received).
   *  0/undefined = no stop loss. */
  stopLossMultiple?: number;
  /** Skip opening new positions within this many days of an earnings date.
   *  Requires `earningsDates` to be provided. */
  skipEarningsWindow?: number;
  /** Earnings dates (YYYY-MM-DD) to avoid when `skipEarningsWindow` is set. */
  earningsDates?: string[];
  /** Minimum IV rank (0–100) required to open a new short option position.
   *  When the current IV rank is below this, the cycle is skipped (NO_FILL).
   *  Requires `ivRankSeries` to be provided. */
  minIvRank?: number;
  /** Map of date (YYYY-MM-DD) → IV rank (0–100) for the symbol. */
  ivRankSeries?: Map<string, number>;
  /** Strike selection mode. "delta" (default) uses the delta target.
   *  "pctOtm" picks the strike that is `pctOtm` above (calls) or below (puts)
   *  the spot. "premiumTarget" picks the strike whose premium is closest to
   *  `premiumTargetPct` of the spot. */
  strikeMode?: "delta" | "pctOtm" | "premiumTarget";
  /** Percentage OTM for the "pctOtm" strike mode (e.g. 0.05 = 5% OTM). */
  pctOtm?: number;
  /** Target premium as a percentage of spot for "premiumTarget" mode. */
  premiumTargetPct?: number;
  // --- Phase 6: Advanced volatility + early assignment ---
  /** Volatility estimator to use for the BS fallback path.
   *  "closeToClose" (default) uses log returns of adjustedClose.
   *  "yangZhang" uses OHLC overnight + intraday (more efficient).
   *  "garmanKlass" uses OHLC intraday only. */
  volEstimator?: "closeToClose" | "yangZhang" | "garmanKlass";
  /** When true, the IV multiplier is calibrated by volatility regime
   *  (low/normal/high/crisis) instead of using a fixed `ivRiskPremium`. */
  calibratedVrp?: boolean;
  /** When true, simulate early assignment of deep-ITM puts when the
   *  extrinsic value drops below a threshold. Default false. */
  simulateEarlyAssignment?: boolean;
  /** Probability threshold for triggering early assignment (0–1, default 0.50). */
  earlyAssignmentThreshold?: number;
  // --- Phase 7: Ratio wheel ---
  /** Target ratio of puts to total contracts (0–1). E.g. 0.5 = 50/50 puts:calls.
   *  Only used with RATIO_WHEEL strategy. The wheel sells both puts and calls
   *  simultaneously each cycle, sized to maintain this ratio. */
  putCallRatio?: number;
  /** Call delta target to use after a put assignment (higher = more aggressive
   *  about being called away). Only used with RATIO_WHEEL. Default: same as
   *  deltaTarget. */
  callDeltaAfterAssignment?: number;
  /** Put delta target for the ratio wheel (default: same as deltaTarget). */
  putDeltaTarget?: number;
}

export interface BacktestTrade {
  openDate: string;
  /** Targeted expiration date for this cycle (open date + DTE window) */
  expirationDate: string;
  /** Actual close date: expiration day, or the early buy-back / roll day */
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
  /** True when the early buy-back filled on an intraday touch (ask/low through the trigger) */
  exitByTouch?: boolean;
  /** True when the entry GTC order filled on an intraday touch (bid/high at the target) */
  entryByTouch?: boolean;
  /** Actual DTE of the contract that was traded (may differ from dteTarget when
   *  snapped to a real Friday expiration). */
  actualDte?: number;
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
  /** Downside-deviation Sharpe, computed from daily returns. */
  sortinoRatio: number | null;
  /** Annualized return / max drawdown. */
  calmarRatio: number | null;
  // Equity curve
  equityCurve: { date: string; strategyEquity: number; buyHoldEquity: number }[];
  /** Daily mark-to-market equity curve (one point per trading day). Used for
   *  accurate drawdown and risk metrics. The per-cycle `equityCurve` is kept
   *  for backward compatibility with existing UI components. */
  dailyEquityCurve: { date: string; strategyEquity: number; buyHoldEquity: number }[];
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
  /** Buy-backs filled by an intraday touch of the trigger (needs daily rows) */
  touchExitCount: number;
  /** Entry GTC orders filled by an intraday touch of the target price */
  touchEntryCount: number;
  /** Cycles that had daily contract rows available for GTC touch simulation */
  touchCycles: number;
  /** Monthly cash flow breakdown: net premium income grouped by close month */
  monthlyCashFlow: { month: string; netPremium: number; grossPremium: number; trades: number }[];
  /** Interest earned on idle cash at the risk-free rate. */
  interestIncome: number;
  /** Total commissions + assignment fees + slippage paid. */
  totalCommissions: number;
  // --- Phase 2: Wheel-grade metrics ---
  /** Return on capital actually deployed (P/L ÷ time-weighted average capital
   *  at risk: collateral for puts, share value for calls). Annualized. */
  returnOnCapitalDeployed: number | null;
  /** Fraction of trading days with an open option position (0–1). */
  capitalUtilization: number;
  /** Standard deviation of monthly net premium income. Lower = more consistent. */
  monthlyIncomeStdDev: number;
  /** Number of months with zero premium income. */
  zeroIncomeMonths: number;
  /** Worst single-cycle P/L (can be negative). */
  worstCyclePnl: number;
  /** Worst single-month net premium income (can be negative). */
  worstMonthPnl: number;
  /** History of cost basis changes over time (date + basis after each change). */
  costBasisHistory: { date: string; costBasis: number }[];
  /** Total premium collected per share while holding, reducing the net cost basis. */
  netCostBasisReduction: number;
  /** Trading days where shares were held and spot was below the cost basis. */
  daysUnderwater: number;
  /** Cycle P/L bucketed by market regime (bull/bear/crisis/recovery). */
  regimeBreakdown: { regime: string; cycles: number; pnl: number; winRate: number }[];
  // --- Phase 5: Wheel management rule counters ---
  /** Puts rolled to defer assignment (rollTestedPut rule). */
  rolledPutCount: number;
  /** Cycles closed early by the stop-loss rule. */
  stopLossCount: number;
  /** Cycles skipped due to earnings proximity (skipEarningsWindow rule). */
  earningsSkippedCount: number;
  /** Cycles skipped due to low IV rank (minIvRank rule). */
  ivRankSkippedCount: number;
  /** Cycles closed early by the manageAtDte rule. */
  managedEarlyCount: number;
  /** Phase 6: puts assigned early (before expiration) due to deep ITM. */
  earlyAssignmentCount: number;
  // --- Phase 7: Ratio wheel stats ---
  /** Phase 7: total put contracts sold (RATIO_WHEEL only). */
  ratioPutContractsSold: number;
  /** Phase 7: total call contracts sold (RATIO_WHEEL only). */
  ratioCallContractsSold: number;
  /** Phase 7: number of times the call delta was increased after put assignment. */
  ratioDeltaAdjustments: number;
  /** Phase 7: number of times the ratio was rebalanced after call-away. */
  ratioRebalances: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Group trades by close month and sum net premium income. */
function computeMonthlyCashFlow(trades: BacktestTrade[]): { month: string; netPremium: number; grossPremium: number; trades: number }[] {
  const map = new Map<string, { netPremium: number; grossPremium: number; trades: number }>();
  for (const t of trades) {
    if (t.outcome === "NO_FILL") continue;
    const month = t.closeDate.slice(0, 7); // YYYY-MM
    const entry = map.get(month) ?? { netPremium: 0, grossPremium: 0, trades: 0 };
    const buybackCost = t.exitPremium != null ? t.exitPremium * t.contracts * 100 : 0;
    entry.netPremium += t.premiumIncome - buybackCost;
    entry.grossPremium += t.premiumIncome;
    entry.trades += 1;
    map.set(month, entry);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({ month, ...v }));
}

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
 * Phase 6: Configurable realized vol estimator.
 * Uses the configured estimator (closeToClose, yangZhang, or garmanKlass).
 */
function computeRealizedVol(
  prices: HistoricalPricePoint[],
  endIdx: number,
  window: number,
  estimator: "closeToClose" | "yangZhang" | "garmanKlass" = "closeToClose",
): number {
  if (estimator === "yangZhang") return yangZhangVolatility(prices, endIdx, window);
  if (estimator === "garmanKlass") return garmanKlassVolatility(prices, endIdx, window);
  return realizedVol(prices, endIdx, window);
}

/**
 * Phase 6: Configurable IV application with calibrated VRP.
 */
function applyIv(
  rv: number,
  prices: HistoricalPricePoint[],
  endIdx: number,
  config: BacktestConfig,
): number {
  if (config.calibratedVrp) {
    const longVol = computeRealizedVol(prices, endIdx, 252, config.volEstimator ?? "closeToClose");
    return calibratedImpliedVol(rv, longVol, config.ivRiskPremium ?? 1.15);
  }
  return applyRiskPremium(rv, config.ivRiskPremium ?? 1.15);
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

/** Compute max drawdown from an equity curve. Delegates to the quant library. */
function maxDrawdown(equity: number[]): number {
  return quantMaxDrawdown(equity);
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
  return quantSharpe(returns, periodsPerYear, riskFreeRate);
}

/**
 * Snap a cycle close index to the nearest Friday expiration on or after the
 * target DTE. This mirrors real option expiration calendars: weekly options
 * expire on Fridays, monthly options on the 3rd Friday.
 *
 * @param idx - cycle open index in the prices array
 * @param dteTarget - target days to expiration
 * @param prices - historical price series (oldest first)
 * @param weeklies - when true, snap to the nearest Friday; when false, snap to
 *                   the 3rd Friday of the month (monthly expirations only)
 * @returns { closeIdx, actualDte } — the index of the snapped expiration and
 *          the actual DTE in calendar days.
 */
function snapToExpiration(
  idx: number,
  dteTarget: number,
  prices: HistoricalPricePoint[],
  weeklies: boolean,
): { closeIdx: number; actualDte: number } {
  const openDate = new Date(prices[idx]!.date);
  const targetMs = openDate.getTime() + dteTarget * 24 * 60 * 60 * 1000;
  const targetDate = new Date(targetMs);

  // Find the first Friday on or after the target date (using UTC to match
  // the ISO date strings in the prices array).
  const findNextFriday = (d: Date): Date => {
    const day = d.getUTCDay(); // 0=Sun ... 5=Fri ... 6=Sat
    const daysUntilFriday = (5 - day + 7) % 7;
    const result = new Date(d);
    result.setUTCDate(result.getUTCDate() + daysUntilFriday);
    return result;
  };

  let expDate: Date;
  if (weeklies) {
    expDate = findNextFriday(targetDate);
  } else {
    // 3rd Friday of the target month (or next month if past it)
    const findThirdFriday = (year: number, month: number): Date => {
      const firstOfMonth = new Date(Date.UTC(year, month, 1));
      const firstDay = firstOfMonth.getUTCDay();
      const firstFridayDate = 1 + ((5 - firstDay + 7) % 7);
      const thirdFridayDate = firstFridayDate + 14;
      return new Date(Date.UTC(year, month, thirdFridayDate));
    };
    expDate = findThirdFriday(targetDate.getUTCFullYear(), targetDate.getUTCMonth());
    // If the 3rd Friday is before the target date, use next month's
    if (expDate.getTime() < targetMs) {
      const nextMonth = targetDate.getUTCMonth() + 1;
      const nextYear = targetDate.getUTCFullYear() + (nextMonth > 11 ? 1 : 0);
      expDate = findThirdFriday(nextYear, nextMonth % 12);
    }
  }

  // Find the price index closest to (on or before) the expiration date
  const expStr = expDate.toISOString().slice(0, 10);
  let closeIdx = Math.min(idx + Math.round(dteTarget * 252 / 365), prices.length - 1);
  // Walk forward to find the closest trading day on or before expDate
  for (let i = idx + 1; i < prices.length; i++) {
    const p = prices[i];
    if (!p) continue;
    if (p.date <= expStr) {
      closeIdx = i;
    } else {
      break;
    }
  }

  const actualDte = Math.round(
    (new Date(prices[closeIdx]!.date).getTime() - openDate.getTime()) / (1000 * 60 * 60 * 24),
  );
  return { closeIdx, actualDte: Math.max(1, actualDte) };
}

/**
 * Re-price an open option position on a given day for mark-to-market.
 * Uses real daily rows when available, otherwise Black-Scholes.
 */
function priceOpenOption(
  prices: HistoricalPricePoint[],
  d: number,
  strike: number,
  optionType: "CALL" | "PUT",
  closeDate: string,
  config: BacktestConfig,
  dailyRows?: Map<string, ThetaDataEODQuote>,
): number {
  const p = prices[d];
  if (!p) return 0;
  const dSpot = p.adjustedClose;

  // Real data path: use the actual mid from daily rows
  if (dailyRows) {
    const row = dailyRows.get(p.date);
    if (row && row.mid > 0) return row.mid;
  }

  // BS fallback: re-price with current spot and remaining DTE
  const remainingDays =
    (new Date(closeDate).getTime() - new Date(p.date).getTime()) /
    (1000 * 60 * 60 * 24);
  const dRv = realizedVol(prices, d, 30);
  const dIv = applyRiskPremium(dRv, config.ivRiskPremium ?? 1.15);
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
  return bs.price;
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
export async function runBacktest(
  prices: HistoricalPricePoint[],
  config: BacktestConfig,
  benchmarkPrices?: HistoricalPricePoint[],
): Promise<BacktestResult> {
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
  let touchExitCount = 0;
  let touchEntryCount = 0;
  let touchCycles = 0;

  // --- Phase 1 additions: daily MTM, cash interest, transaction costs ---
  /** Daily mark-to-market equity curve (one point per trading day). */
  const dailyEquityCurve: { date: string; strategyEquity: number; buyHoldEquity: number }[] = [];
  /** Cash balance = starting capital + premium income + called-away proceeds
   *  - buy-backs - assignment costs - share purchases + interest. */
  let cashBalance = config.startingCapital;
  /** Total interest earned on idle cash. */
  let interestIncome = 0;
  /** Total commissions + fees paid. */
  let totalCommissions = 0;
  /** Date → index lookup for snapping to real expiration dates. */
  const dateIndex = new Map<string, number>();
  for (let i = 0; i < prices.length; i++) {
    const p = prices[i];
    if (p) dateIndex.set(p.date, i);
  }
  /** Previous day's date for computing Δdays in interest accrual. */
  let prevDailyDate: string | null = null;
  /** Daily strategy equity for computing daily returns. */
  let prevDailyEquity = config.startingCapital;
  const dailyReturns: number[] = [];
  // --- Phase 2: Wheel-grade metric tracking ---
  /** Days with an open option position (for capitalUtilization). */
  let daysWithOpenOption = 0;
  /** Sum of daily capital at risk (for returnOnCapitalDeployed). */
  let capitalDeployedSum = 0;
  /** Days with capital deployed (for RoC denominator). */
  let capitalDeployedDays = 0;
  /** History of cost basis changes. */
  const costBasisHistory: { date: string; costBasis: number }[] = [];
  /** Total premium collected per share while holding (for netCostBasisReduction). */
  let premiumPerShareHeld = 0;
  /** Days where shares held and spot < cost basis. */
  let daysUnderwater = 0;
  /** Config-driven cost settings. Defaults to 0/false for backward compat;
   *  the optimizer route explicitly enables them. */
  const commissionPerContract = config.commissionPerContract ?? 0;
  const assignmentFee = config.assignmentFee ?? 0;
  const slippagePerShare = config.slippagePerShare ?? 0;
  const cashInterestEnabled = config.cashInterestEnabled ?? false;
  const hasWeeklies = config.hasWeeklies !== false;
  // --- Phase 5: Wheel management rule counters ---
  let rolledPutCount = 0;
  let stopLossCount = 0;
  let earningsSkippedCount = 0;
  let ivRankSkippedCount = 0;
  let managedEarlyCount = 0;
  let earlyAssignmentCount = 0;
  // --- Phase 7: Ratio wheel tracking ---
  let ratioPutContractsSold = 0;
  let ratioCallContractsSold = 0;
  let ratioDeltaAdjustments = 0;
  let ratioRebalances = 0;
  /** Dynamic call delta — increases after put assignment, resets after call-away. */
  let dynamicCallDelta = config.deltaTarget;
  /** Whether the next cycle should use the assignment-adjusted call delta. */
  let useAdjustedCallDelta = false;

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
      sortinoRatio: null,
      calmarRatio: null,
      equityCurve: [],
      dailyEquityCurve: [],
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
      touchExitCount: 0,
      touchEntryCount: 0,
      touchCycles: 0,
      monthlyCashFlow: [],
      interestIncome: 0,
      totalCommissions: 0,
      returnOnCapitalDeployed: null,
      capitalUtilization: 0,
      monthlyIncomeStdDev: 0,
      zeroIncomeMonths: 0,
      worstCyclePnl: 0,
      worstMonthPnl: 0,
      costBasisHistory: [],
      netCostBasisReduction: 0,
      daysUnderwater: 0,
      regimeBreakdown: [],
      rolledPutCount: 0,
      stopLossCount: 0,
      earningsSkippedCount: 0,
      ivRankSkippedCount: 0,
      managedEarlyCount: 0,
      earlyAssignmentCount: 0,
      ratioPutContractsSold: 0,
      ratioCallContractsSold: 0,
      ratioDeltaAdjustments: 0,
      ratioRebalances: 0,
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
    const rv = computeRealizedVol(prices, idx, 30, config.volEstimator ?? "closeToClose");
    const iv = applyIv(rv, prices, idx, config);

    // Determine option type based on strategy
    let optionType: "CALL" | "PUT";
    if (config.strategy === "COVERED_CALL") {
      optionType = "CALL";
    } else if (config.strategy === "CASH_SECURED_PUT") {
      optionType = "PUT";
    } else if (config.strategy === "WHEEL") {
      optionType = sharesHeld > 0 ? "CALL" : "PUT";
    } else if (config.strategy === "RATIO_WHEEL") {
      // Ratio wheel: sell both puts and calls simultaneously.
      // Primary option is CALL if shares held, PUT if not.
      // Secondary option (the other side) is handled below.
      optionType = sharesHeld > 0 ? "CALL" : "PUT";
    } else {
      // BUY_AND_HOLD — no trades
      break;
    }

    // Phase 7: For RATIO_WHEEL, use the dynamic call delta after assignment.
    // This sells higher-delta calls (more aggressive about being called away)
    // to recover shares after a put assignment lowered the cost basis.
    let effectiveDeltaTarget = config.deltaTarget;
    if (config.strategy === "RATIO_WHEEL" && useAdjustedCallDelta && optionType === "CALL") {
      effectiveDeltaTarget = dynamicCallDelta;
    }

    // --- Phase 7: Ratio wheel — compute secondary put position ---
    // For RATIO_WHEEL, sell a put alongside the call when shares are held.
    // The ratio means "fraction of total option volume that are puts":
    //   putCallRatio = puts / (puts + calls)
    // With 400 shares → 4 calls; at 50/50 → 4 puts too.
    let ratioPutStrike = 0;
    let ratioPutPremium = 0;
    let ratioPutContracts = 0;
    let ratioPutActive = false;
    if (config.strategy === "RATIO_WHEEL" && sharesHeld > 0) {
      const ratio = config.putCallRatio ?? 0.5;
      const putDelta = config.putDeltaTarget ?? config.deltaTarget;
      // Call side covers all shares: 1 contract per 100 shares
      const callContracts = Math.floor(sharesHeld / 100);
      // Put side sized by ratio: puts = calls * ratio / (1 - ratio)
      ratioPutContracts = Math.max(0, Math.round(callContracts * ratio / Math.max(1 - ratio, 0.01)));
      // Need cash collateral for the put
      const putCollateral = spot * 100 * ratioPutContracts;
      if (ratioPutContracts > 0 && cashBalance >= putCollateral) {
        const res = findStrikeByDelta(
          spot, iv, config.dteTarget, config.riskFreeRate,
          "PUT", putDelta, config.strikeInterval,
          undefined, config.dividendYield,
          config.ivSkewEnabled, config.termStructureEnabled,
        );
        ratioPutStrike = res.strike;
        ratioPutPremium = res.premium;
        ratioPutActive = true;
        const putIncome = ratioPutPremium * 100 * ratioPutContracts;
        const putCommission = commissionPerContract * ratioPutContracts;
        cashFromPremium += putIncome;
        premiumCash += putIncome;
        cashBalance += putIncome - putCommission;
        totalCommissions += putCommission;
        ratioPutContractsSold += ratioPutContracts;
      }
    }

    // --- Phase 5: Earnings avoidance ---
    // Skip opening new positions within `skipEarningsWindow` days of an
    // earnings date. The cycle is recorded as NO_FILL so the equity curve
    // still tracks the shares.
    if (config.skipEarningsWindow && config.earningsDates && config.earningsDates.length > 0) {
      const openDateMs = new Date(openPrice.date + "T00:00:00Z").getTime();
      const windowMs = config.skipEarningsWindow * 24 * 60 * 60 * 1000;
      const tooClose = config.earningsDates.some((ed) => {
        const edMs = new Date(ed + "T00:00:00Z").getTime();
        return Math.abs(edMs - openDateMs) <= windowMs;
      });
      if (tooClose) {
        earningsSkippedCount++;
        const closeIdx = Math.min(idx + tradingDaysPerCycle, prices.length - 1);
        const closePrice = prices[closeIdx]!;
        trades.push({
          openDate: openPrice.date,
          expirationDate: closePrice.date,
          closeDate: closePrice.date,
          optionType,
          strike: 0,
          premiumPerShare: 0,
          contracts: 0,
          premiumIncome: 0,
          outcome: "NO_FILL",
          stockPriceAtOpen: spot,
          stockPriceAtClose: closePrice.adjustedClose,
          cyclePnl: (closePrice.adjustedClose - spot) * sharesHeld,
          daysHeld: closeIdx - idx,
          flooredByCostBasis: false,
          premiumYield: 0,
          exitPremium: null,
          dataSource: "BS_MODEL",
        });
        idx = closeIdx + 1;
        continue;
      }
    }

    // --- Phase 5: IV rank gate ---
    // Skip opening new positions when IV rank is below the minimum.
    if (config.minIvRank != null && config.ivRankSeries) {
      const ivRank = config.ivRankSeries.get(openPrice.date);
      if (ivRank != null && ivRank < config.minIvRank) {
        ivRankSkippedCount++;
        const closeIdx = Math.min(idx + tradingDaysPerCycle, prices.length - 1);
        const closePrice = prices[closeIdx]!;
        trades.push({
          openDate: openPrice.date,
          expirationDate: closePrice.date,
          closeDate: closePrice.date,
          optionType,
          strike: 0,
          premiumPerShare: 0,
          contracts: 0,
          premiumIncome: 0,
          outcome: "NO_FILL",
          stockPriceAtOpen: spot,
          stockPriceAtClose: closePrice.adjustedClose,
          cyclePnl: (closePrice.adjustedClose - spot) * sharesHeld,
          daysHeld: closeIdx - idx,
          flooredByCostBasis: false,
          premiumYield: 0,
          exitPremium: null,
          dataSource: "BS_MODEL",
        });
        idx = closeIdx + 1;
        continue;
      }
    }

    // Establish cost basis the first time a covered call is sold
    // (shares are treated as bought at the first cycle's open price).
    if (optionType === "CALL" && shareCostBasis == null) {
      shareCostBasis = spot;
      costBasisHistory.push({ date: openPrice.date, costBasis: spot });
    }

    // --- Average down via CSP (sell put to acquire shares at lower strike) ---
    // When enabled and stock is below cost basis, sell a cash-secured put at
    // the configured delta. If assigned at cycle close, buy shares at the put
    // strike (below current spot). If expired worthless, keep the premium.
    // Only one average-down put per cycle, sized to 1 contract (100 shares).
    let avgDownPutStrike = 0;
    let avgDownPutPremium = 0;
    let avgDownPutActive = false;
    if (
      config.averageDownWithPremium &&
      sharesHeld > 0 &&
      shareCostBasis != null &&
      spot < shareCostBasis &&
      premiumCash >= spot * 100 // need collateral for 100 shares
    ) {
      const avgDelta = 0.20; // target 20-delta put for averaging down
      const res = findStrikeByDelta(
        spot, iv, config.dteTarget, config.riskFreeRate,
        "PUT", avgDelta, config.strikeInterval,
        undefined, config.dividendYield,
        config.ivSkewEnabled, config.termStructureEnabled,
      );
      avgDownPutStrike = res.strike;
      avgDownPutPremium = res.premium;
      avgDownPutActive = true;
      const avgDownIncome = avgDownPutPremium * 100; // 1 contract
      cashFromPremium += avgDownIncome;
      premiumCash += avgDownIncome;
      cashBalance += avgDownIncome;
    }

    // Calls are sold one contract per 100 shares held, but never more than
    // the configured contract count. Average-down adds shares to lower the
    // cost basis — it should NOT inflate the position size exponentially.
    // For RATIO_WHEEL, calls cover ALL shares (contracts is not the cap).
    const activeContracts =
      config.strategy === "RATIO_WHEEL" && optionType === "CALL"
        ? Math.max(1, Math.floor(sharesHeld / 100))
        : optionType === "CALL"
          ? Math.max(1, Math.min(config.contracts, Math.floor(sharesHeld / 100)))
          : config.contracts;

    // Phase 7: Track ratio wheel call contracts
    if (config.strategy === "RATIO_WHEEL" && optionType === "CALL") {
      ratioCallContractsSold += activeContracts;
    }

    // Cost-basis floor: never sell a call below what we paid for the shares.
    const minCallStrike =
      optionType === "CALL" && config.neverSellCallBelowCostBasis && shareCostBasis != null
        ? shareCostBasis
        : undefined;

    // Cycle window: snap to the nearest Friday expiration (BS path, opt-in)
    // or use the real contract's expiration (real-data path, always).
    const snapEnabled = config.snapExpiration ?? false;
    let closeIdx: number;
    let cycleActualDte: number;
    if (snapEnabled) {
      const snapped = snapToExpiration(idx, config.dteTarget, prices, hasWeeklies);
      closeIdx = snapped.closeIdx;
      cycleActualDte = snapped.actualDte;
    } else {
      closeIdx = Math.min(idx + tradingDaysPerCycle, prices.length - 1);
      cycleActualDte = config.dteTarget;
    }
    let closePrice = prices[closeIdx];
    if (!closePrice) { idx++; continue; }
    let closeSpot = closePrice.adjustedClose;

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
    let entryByTouch = false;
    /** Real expiration of the contract picked on the real-data path */
    let realExpiration: string | null = null;
    /** Whether this cycle already counted toward touchCycles */
    let countedTouchCycle = false;

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
          effectiveDeltaTarget,
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
      realExpiration = realContract.expiration;
      // Override closeIdx to the real expiration date — the outcome must be
      // judged on the actual expiration, not idx + tradingDaysPerCycle.
      const realExpIdx = dateIndex.get(realExpiration);
      if (realExpIdx != null && realExpIdx > idx) {
        closeIdx = Math.min(realExpIdx, prices.length - 1);
        closePrice = prices[closeIdx]!;
        closeSpot = closePrice.adjustedClose;
        cycleActualDte = Math.round(
          (new Date(closePrice.date).getTime() - new Date(openPrice.date).getTime()) /
            (1000 * 60 * 60 * 24),
        );
      }
      if (yieldFloor > 0 && openSpot > 0 && fillPrice / openSpot < yieldFloor) {
        // The GTC sell order rests at the floor price (floor × spot at open).
        // With daily rows for the candidate contract we can simulate an
        // intraday touch fill — the bid (or traded high) reaching the target
        // mid-day fills the order even when the close was below it.
        let touchedEntry = false;
        if (config.getDailyRows) {
          const entryRows = await config.getDailyRows({
            optionType,
            strike: realContract.strike,
            expiration: realContract.expiration,
            from: openPrice.date,
            to: closePrice.date,
          });
          if (entryRows.size > 0) {
            countedTouchCycle = true;
            touchCycles++;
            const target = yieldFloor * spot;
            for (let d = idx; d <= closeIdx; d++) {
              const p = prices[d];
              if (!p) continue;
              const row = entryRows.get(p.date);
              if (!row) continue;
              if (
                (row.bid > 0 && row.bid >= target) ||
                (row.high > 0 && row.high >= target)
              ) {
                filled = true;
                touchedEntry = true;
                fillPrice = target;
                premium = target;
                openSpot = p.adjustedClose;
                openDate = p.date;
                openIdx = d;
                break;
              }
            }
          }
        }
        if (touchedEntry) {
          touchEntryCount++;
          entryByTouch = true;
        } else {
          filled = false;
          fillPrice = 0;
        }
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
            effectiveDeltaTarget,
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
          effectiveDeltaTarget,
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

    // Apply slippage: the effective fill is reduced by slippage per share.
    if (filled && slippagePerShare > 0) {
      fillPrice = Math.max(0, fillPrice - slippagePerShare);
    }

    // Commission on opening the short position.
    const openCommission = filled ? commissionPerContract * activeContracts : 0;
    totalCommissions += openCommission;

    const premiumIncome = fillPrice * 100 * activeContracts;
    cashFromPremium += premiumIncome;
    premiumCash += premiumIncome;
    // Track premium collected per share held (for net cost basis reduction).
    // Only counts call premium collected while holding shares.
    if (filled && optionType === "CALL" && sharesHeld > 0) {
      premiumPerShareHeld += fillPrice * 100 * activeContracts / sharesHeld;
    }
    // Save cash state before premium for daily MTM reconstruction
    const preOpenCash = cashBalance;
    const preOpenShares = sharesHeld;
    cashBalance += premiumIncome - openCommission;
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
    // With daily rows for the sold contract, the order is simulated with
    // intraday-touch semantics: it fills the first day the option trades
    // through the trigger — the ask dropping to it (marketable), or the
    // traded low touching it. Days with rows suppress the BS estimate (the
    // real close already showed no fill); days without rows fall back to
    // the modeled re-pricing.
    const buyBackPct = config.buyBackPct ?? 0;
    let exitPremium: number | null = null;
    let exitByTouch = false;
    let effCloseIdx = closeIdx;
    let effCloseDate = closePrice.date;
    let effCloseSpot = closeSpot;
    /** Daily option rows for this cycle (used by buy-back and daily MTM). */
    let dailyRowsForMtm: Map<string, ThetaDataEODQuote> | undefined;

    if (filled && buyBackPct > 0 && buyBackPct < 1) {
      // buyBackPct is the profit fraction to keep (e.g. 0.80 = keep 80% profit,
      // buy back when option is worth 20% of sale price). 0.50 = 50% profit.
      const trigger = fillPrice * (1 - buyBackPct);
      if (config.getDailyRows && dataSource === "REAL" && realExpiration) {
        try {
          const fetched = await config.getDailyRows({
            optionType,
            strike,
            expiration: realExpiration,
            from: openDate,
            to: closePrice.date,
          });
          if (fetched.size > 0) {
            dailyRowsForMtm = fetched;
            if (!countedTouchCycle) {
              countedTouchCycle = true;
              touchCycles++;
            }
          }
        } catch {
          dailyRowsForMtm = undefined;
        }
      }
      for (let d = openIdx + 1; d <= closeIdx; d++) {
        const p = prices[d];
        if (!p) continue;
        const dSpot = p.adjustedClose;
        const row = dailyRowsForMtm?.get(p.date);
        if (row) {
          if (row.ask > 0 && row.ask <= trigger) {
            // Ask dropped to the trigger — buy at the ask.
            exitPremium = row.ask;
            exitByTouch = true;
            effCloseIdx = d;
            effCloseDate = p.date;
            effCloseSpot = dSpot;
            break;
          }
          if (row.low > 0 && row.low <= trigger) {
            // Traded through the trigger intraday — fill at the limit price.
            exitPremium = trigger;
            exitByTouch = true;
            effCloseIdx = d;
            effCloseDate = p.date;
            effCloseSpot = dSpot;
            break;
          }
          // Real quotes show no touch today — skip the modeled check.
          continue;
        }
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

    // --- Phase 5: Manage at DTE ---
    // Close the open option early when DTE drops to `manageAtDte`, regardless
    // of the buy-back target. Frees capital for the next cycle sooner.
    if (filled && exitPremium == null && config.manageAtDte && config.manageAtDte > 0) {
      const daysToExpiry =
        (new Date(closePrice.date).getTime() - new Date(openPrice.date).getTime()) /
        (1000 * 60 * 60 * 24);
      const elapsedDays = effCloseIdx - idx;
      const remainingDays = daysToExpiry - elapsedDays;
      if (remainingDays <= config.manageAtDte) {
        // Re-price the option at the manage-at-DTE point
        const dSpot = effCloseSpot;
        const dRv = realizedVol(prices, effCloseIdx, 30);
        const dIv = applyRiskPremium(dRv, config.ivRiskPremium ?? 1.15);
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
        exitPremium = bs.price;
        managedEarlyCount++;
      }
    }

    // --- Phase 5: Stop-loss ---
    // Close the open option when its cost reaches `stopLossMultiple` × the
    // premium collected. Checked daily alongside the buy-back target.
    if (filled && exitPremium == null && config.stopLossMultiple && config.stopLossMultiple > 0) {
      const stopTrigger = fillPrice * config.stopLossMultiple;
      for (let d = idx + 1; d <= closeIdx; d++) {
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
        if (bs.price >= stopTrigger) {
          exitPremium = bs.price;
          effCloseIdx = d;
          effCloseDate = p.date;
          effCloseSpot = dSpot;
          stopLossCount++;
          break;
        }
      }
    }

    // --- Phase 5: Tested-put rolling ---
    // Roll a tested put (delta exceeds threshold) to a later expiration,
    // deferring assignment. Only rolls for a net credit.
    if (filled && exitPremium == null && config.rollTestedPut && optionType === "PUT") {
      const { whenDeltaAbove, forCreditOnly } = config.rollTestedPut;
      for (let d = idx + 1; d <= closeIdx; d++) {
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
        // Check if the put's delta exceeds the threshold (put delta is negative,
        // so we check the absolute value)
        const putDelta = bs.greeks.delta;
        if (putDelta != null && Math.abs(putDelta) > whenDeltaAbove) {
          // Price the buyback
          const buybackPrice = bs.price;
          // Find a replacement put at the same delta target for a new cycle
          const replacementRes = findStrikeByDelta(
            dSpot, dIv, config.dteTarget, config.riskFreeRate,
            "PUT", config.deltaTarget, config.strikeInterval,
            undefined, config.dividendYield,
            config.ivSkewEnabled, config.termStructureEnabled,
          );
          // Check if the roll is for a credit
          const rollCredit = replacementRes.premium - buybackPrice;
          if (!forCreditOnly || rollCredit > 0) {
            exitPremium = buybackPrice;
            effCloseIdx = d;
            effCloseDate = p.date;
            effCloseSpot = dSpot;
            rolledPutCount++;
            // Collect the replacement put premium
            const replacementIncome = replacementRes.premium * 100 * activeContracts;
            const rollCommission = commissionPerContract * activeContracts;
            const replacementCommission = commissionPerContract * activeContracts;
            totalCommissions += rollCommission + replacementCommission;
            cashFromPremium += replacementIncome;
            premiumCash += replacementIncome;
            cashBalance += replacementIncome - rollCommission - replacementCommission;
            break;
          }
        }
      }
    }

    // --- Phase 6: Early assignment simulation ---
    // Simulate early assignment of deep-ITM puts when extrinsic value is
    // negligible. The put is bought back at intrinsic and shares are
    // assigned early, before expiration.
    if (filled && exitPremium == null && config.simulateEarlyAssignment && optionType === "PUT") {
      const threshold = config.earlyAssignmentThreshold ?? 0.50;
      for (let d = idx + 1; d <= closeIdx; d++) {
        const p = prices[d];
        if (!p) continue;
        const dSpot = p.adjustedClose;
        if (dSpot >= strike) continue; // OTM, no assignment
        const dRv = computeRealizedVol(prices, d, 30, config.volEstimator ?? "closeToClose");
        const dIv = applyIv(dRv, prices, d, config);
        const remainingDays =
          (new Date(closePrice.date).getTime() - new Date(p.date).getTime()) /
          (1000 * 60 * 60 * 24);
        if (shouldSimulateEarlyAssignment(dSpot, strike, remainingDays, dIv, config.riskFreeRate, threshold)) {
          // Simulate early assignment: buy back the put at intrinsic, assign shares
          const buybackCost = (strike - dSpot) * 100 * activeContracts;
          const buybackCommission = commissionPerContract * activeContracts;
          totalCommissions += buybackCommission + assignmentFee;
          cashBalance -= buybackCost + buybackCommission + assignmentFee;
          exitPremium = (strike - dSpot); // intrinsic value per share
          effCloseIdx = d;
          effCloseDate = p.date;
          effCloseSpot = dSpot;
          earlyAssignmentCount++;
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
      if (exitByTouch) touchExitCount++;
      const buybackCommission = commissionPerContract * activeContracts;
      totalCommissions += buybackCommission;
      const buybackCost = exitPremium * 100 * activeContracts;
      cashBalance -= buybackCost + buybackCommission;
      if (optionType === "CALL") {
        // Shares still held; mark stock move open -> buyback date.
        cyclePnl = premiumIncome - buybackCost - openCommission - buybackCommission + (effCloseSpot - openSpot) * sharesHeld;
      } else {
        cyclePnl = premiumIncome - buybackCost - openCommission - buybackCommission;
      }
    } else if (optionType === "CALL") {
      // Short call against shares. Stock P/L is marked cycle-open -> cycle-close
      // for EVERY cycle so the equity curve tracks the shares continuously.
      // Upside is capped at the strike when the call finishes ITM.
      const stockExit = effCloseSpot > strike ? strike : effCloseSpot;
      const stockPnl = (stockExit - openSpot) * sharesHeld;
      if (effCloseSpot > strike) {
        if (config.rollOnAssignment) {
          // Roll: buy back ITM call at intrinsic, keep shares, then sell a
          // replacement call at the same delta target for a new cycle.
          outcome = "ROLLED";
          rolledCount++;
          const rollCommission = commissionPerContract * activeContracts;
          totalCommissions += rollCommission;
          const buybackCost = (effCloseSpot - strike) * 100 * activeContracts;
          cashBalance -= buybackCost + rollCommission;
          cyclePnl = premiumIncome - buybackCost - openCommission - rollCommission + (effCloseSpot - openSpot) * sharesHeld;

          // --- Sell replacement call at the same delta target ---
          // The roll buys back the ITM call and immediately sells a new call
          // at the configured delta, collecting additional premium. This
          // keeps the wheel in the call phase and defers the call-away.
          const rollIv = applyRiskPremium(
            realizedVol(prices, effCloseIdx, 30),
            config.ivRiskPremium ?? 1.15,
          );
          const replacementRes = findStrikeByDelta(
            effCloseSpot, rollIv, config.dteTarget, config.riskFreeRate,
            "CALL", config.deltaTarget, config.strikeInterval,
            undefined, config.dividendYield,
            config.ivSkewEnabled, config.termStructureEnabled,
          );
          // Apply cost-basis floor if enabled
          let replacementStrike = replacementRes.strike;
          let replacementPremium = replacementRes.premium;
          if (config.neverSellCallBelowCostBasis && shareCostBasis != null) {
            const minStrike = Math.ceil(shareCostBasis / config.strikeInterval) * config.strikeInterval;
            const minRounded = minStrike > 0 ? minStrike : null;
            if (minRounded != null && replacementStrike < minRounded) {
              const constrained = findStrikeByDelta(
                effCloseSpot, rollIv, config.dteTarget, config.riskFreeRate,
                "CALL", 0.50, config.strikeInterval,
                minRounded, config.dividendYield,
                config.ivSkewEnabled, config.termStructureEnabled,
              );
              replacementStrike = constrained.strike;
              replacementPremium = constrained.premium;
            }
          }
          const replacementIncome = replacementPremium * 100 * activeContracts;
          const replacementCommission = commissionPerContract * activeContracts;
          totalCommissions += replacementCommission;
          cashFromPremium += replacementIncome;
          premiumCash += replacementIncome;
          cashBalance += replacementIncome - replacementCommission;
          cyclePnl += replacementIncome - replacementCommission;
        } else {
          outcome = "CALLED_AWAY";
          calledAwayCount++;
          totalCommissions += assignmentFee;
          // Shares sold at strike; cash receives strike × shares
          cashBalance += strike * sharesHeld - assignmentFee;
          cyclePnl = premiumIncome + stockPnl - openCommission - assignmentFee;
          if (config.strategy === "WHEEL" || config.strategy === "RATIO_WHEEL") {
            sharesHeld = 0;
            shareCostBasis = null;
            costBasisHistory.push({ date: effCloseDate, costBasis: 0 });
            // Phase 7: Reset dynamic call delta after call-away
            if (config.strategy === "RATIO_WHEEL") {
              dynamicCallDelta = config.deltaTarget;
              useAdjustedCallDelta = false;
              ratioRebalances++;
            }
          }
        }
      } else {
        outcome = "EXPIRED_WORTHLESS";
        expiredWorthlessCount++;
        cyclePnl = premiumIncome + stockPnl - openCommission;
      }
    } else {
      // Short put
      if (effCloseSpot < strike) {
        // Assigned — buy shares at strike
        outcome = "ASSIGNED";
        assignmentCount++;
        totalCommissions += assignmentFee;
        // P/L = premium - (strike - currentStockValue) * contracts * 100
        cyclePnl = premiumIncome - (strike - effCloseSpot) * activeContracts * 100 - openCommission - assignmentFee;
        // Cash pays for the assigned shares
        cashBalance -= strike * activeContracts * 100 + assignmentFee;
        if (config.strategy === "WHEEL" || config.strategy === "RATIO_WHEEL") {
          sharesHeld = activeContracts * 100; // shares assigned
          shareCostBasis = strike; // we "bought" the shares at the put strike
          costBasisHistory.push({ date: effCloseDate, costBasis: strike });
          // Phase 7: After put assignment, increase call delta to be more
          // aggressive about being called away (recover shares at higher strike).
          if (config.strategy === "RATIO_WHEEL") {
            const adjustedDelta = config.callDeltaAfterAssignment ?? Math.min(0.70, config.deltaTarget + 0.15);
            if (adjustedDelta > dynamicCallDelta) {
              dynamicCallDelta = adjustedDelta;
              ratioDeltaAdjustments++;
            }
            useAdjustedCallDelta = true;
          }
        }
      } else {
        outcome = "EXPIRED_WORTHLESS";
        expiredWorthlessCount++;
        cyclePnl = premiumIncome - openCommission;
      }
    }

    // --- Resolve average-down CSP put at cycle close ---------------------
    if (avgDownPutActive) {
      const avgDownIncome = avgDownPutPremium * 100;
      if (effCloseSpot < avgDownPutStrike) {
        // Assigned — buy 100 shares at the put strike
        const buyCost = avgDownPutStrike * 100;
        if (shareCostBasis != null) {
          shareCostBasis = (shareCostBasis * sharesHeld + avgDownPutStrike * 100) / (sharesHeld + 100);
        } else {
          shareCostBasis = avgDownPutStrike;
        }
        costBasisHistory.push({ date: effCloseDate, costBasis: shareCostBasis });
        sharesHeld += 100;
        premiumCash -= buyCost;
        cashBalance -= buyCost;
        reinvestedPremium += buyCost;
        averagedDownLots++;
        cyclePnl += avgDownIncome - (avgDownPutStrike - effCloseSpot) * 100;
      } else {
        // Expired worthless — keep premium, no shares acquired
        cyclePnl += avgDownIncome;
      }
    }

    // --- Phase 7: Resolve ratio wheel secondary put at cycle close --------
    // The ratio wheel sells a put alongside the call when shares are held.
    // At cycle close, the put either expires worthless (keep premium) or
    // is assigned (buy shares at the put strike, lowering cost basis).
    if (ratioPutActive) {
      const ratioPutIncome = ratioPutPremium * 100 * ratioPutContracts;
      if (effCloseSpot < ratioPutStrike) {
        // Assigned — buy shares at the put strike (averages down)
        const buyCost = ratioPutStrike * 100 * ratioPutContracts;
        if (shareCostBasis != null) {
          shareCostBasis = (shareCostBasis * sharesHeld + ratioPutStrike * 100 * ratioPutContracts) / (sharesHeld + 100 * ratioPutContracts);
        } else {
          shareCostBasis = ratioPutStrike;
        }
        costBasisHistory.push({ date: effCloseDate, costBasis: shareCostBasis });
        sharesHeld += 100 * ratioPutContracts;
        premiumCash -= buyCost;
        cashBalance -= buyCost;
        reinvestedPremium += buyCost;
        assignmentCount++;
        totalCommissions += assignmentFee;
        cashBalance -= assignmentFee;
        cyclePnl += ratioPutIncome - (ratioPutStrike - effCloseSpot) * 100 * ratioPutContracts - assignmentFee;
        // Phase 7: After put assignment, increase call delta
        const adjustedDelta = config.callDeltaAfterAssignment ?? Math.min(0.70, config.deltaTarget + 0.15);
        if (adjustedDelta > dynamicCallDelta) {
          dynamicCallDelta = adjustedDelta;
          ratioDeltaAdjustments++;
        }
        useAdjustedCallDelta = true;
      } else {
        // Expired worthless — keep premium
        cyclePnl += ratioPutIncome;
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
      expirationDate: closePrice.date,
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
      exitByTouch,
      entryByTouch,
      actualDte: cycleActualDte,
    });

    // --- Daily mark-to-market for this cycle -------------------------------
    // Walk each trading day from cycle start to effective close, accruing
    // interest on idle cash and marking the open option to market. This
    // produces the daily equity curve used for drawdown and risk metrics.
    let runningCash = preOpenCash;
    for (let d = idx; d <= effCloseIdx; d++) {
      const dp = prices[d];
      if (!dp) continue;

      // Accrue interest on idle cash at the risk-free rate.
      if (cashInterestEnabled && prevDailyDate) {
        const deltaDays =
          (new Date(dp.date).getTime() - new Date(prevDailyDate).getTime()) /
          (1000 * 60 * 60 * 24);
        if (deltaDays > 0) {
          const interest = runningCash * config.riskFreeRate * deltaDays / 365;
          interestIncome += interest;
          runningCash += interest;
        }
      }
      prevDailyDate = dp.date;

      // At option open, add premium to cash.
      if (d === openIdx && filled) {
        runningCash += premiumIncome - openCommission;
      }

      // Determine shares held on this day (pre-cycle shares during cycle,
      // post-cycle shares at close).
      let dailyShares = preOpenShares;
      if (d === effCloseIdx) {
        dailyShares = sharesHeld;
      }

      // Mark the open option to market (zero before open or at/after close).
      let optionMtm = 0;
      const hasOpenOption = filled && d >= openIdx && d < effCloseIdx;
      if (hasOpenOption) {
        optionMtm = priceOpenOption(
          prices, d, strike, optionType, closePrice.date, config,
          dataSource === "REAL" ? dailyRowsForMtm : undefined,
        );
        daysWithOpenOption++;
      }

      // Track capital deployed (collateral for puts, share value for calls).
      if (hasOpenOption) {
        const capitalAtRisk = optionType === "PUT"
          ? strike * activeContracts * 100
          : dailyShares * dp.adjustedClose;
        capitalDeployedSum += capitalAtRisk;
        capitalDeployedDays++;
      }

      // Track days underwater (shares held below cost basis).
      if (dailyShares > 0 && shareCostBasis != null && dp.adjustedClose < shareCostBasis) {
        daysUnderwater++;
      }

      // At cycle close, reconcile running cash with the final cashBalance
      // (which includes close costs but not interest). The difference is
      // the interest accrued during this cycle.
      if (d === effCloseIdx) {
        const cycleInterest = runningCash - (preOpenCash + (filled ? premiumIncome - openCommission : 0));
        runningCash = cashBalance + cycleInterest;
      }

      const dailyEquity =
        runningCash + dailyShares * dp.adjustedClose - optionMtm * 100 * activeContracts;
      const dailyBH = config.startingCapital * (dp.adjustedClose / buyHoldStartPrice);
      dailyEquityCurve.push({
        date: dp.date,
        strategyEquity: dailyEquity,
        buyHoldEquity: dailyBH,
      });

      if (prevDailyEquity > 0) {
        const ret = (dailyEquity - prevDailyEquity) / prevDailyEquity;
        if (Number.isFinite(ret)) dailyReturns.push(ret);
      }
      prevDailyEquity = dailyEquity;
    }

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

  const strategyAnnualized = compoundAnnualizedRate(strategyReturn, years * 365);
  const buyHoldAnnualized = compoundAnnualizedRate(buyHoldReturn, years * 365);

  const strategyEquityValues = equityCurve.map((e) => e.strategyEquity);
  const dd = maxDrawdown(strategyEquityValues.length > 0 ? strategyEquityValues : [config.startingCapital]);
  const cyclesPerYear = years > 0 ? trades.length / years : 0;
  const sr = sharpeRatio(cycleReturns, cyclesPerYear, config.riskFreeRate);

  // --- Daily-based risk metrics (Phase 1.1) ---
  // Drawdown, Sharpe, and Sortino from the daily mark-to-market curve, not
  // the per-cycle curve. This captures intra-cycle drawdowns that the per-cycle
  // equity completely misses (e.g. a 90-DTE put that sits underwater for 60 days
  // but recovers by expiry).
  const dailyEquityValues = dailyEquityCurve.map((e) => e.strategyEquity);
  const dailyDd = dailyEquityValues.length > 1
    ? maxDrawdown(dailyEquityValues)
    : dd;
  const dailySr = dailyReturns.length > 1
    ? sharpeRatio(dailyReturns, 252, config.riskFreeRate)
    : sr;
  const dailySortino = dailyReturns.length > 1
    ? quantSortino(dailyReturns, 252, 0)
    : null;
  const calmar = dailyDd > 0 && Number.isFinite(strategyAnnualized)
    ? strategyAnnualized / dailyDd
    : null;

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

  // --- Phase 2: Wheel-grade metrics ---
  const totalTradingDays = prices.length - 30; // days actually in the backtest
  const capitalUtilization = totalTradingDays > 0 ? daysWithOpenOption / totalTradingDays : 0;
  const avgCapitalDeployed = capitalDeployedDays > 0 ? capitalDeployedSum / capitalDeployedDays : 0;
  const totalPnl = strategyEquity - config.startingCapital;
  const returnOnCapitalDeployed = avgCapitalDeployed > 0 && years > 0
    ? compoundAnnualizedRate(totalPnl / avgCapitalDeployed, years * 365)
    : null;

  // Monthly income consistency
  const monthlyFlow = computeMonthlyCashFlow(trades);
  const monthlyNetPremiums = monthlyFlow.map((m) => m.netPremium);
  const monthlyMean = monthlyNetPremiums.length > 0
    ? monthlyNetPremiums.reduce((s, v) => s + v, 0) / monthlyNetPremiums.length
    : 0;
  const monthlyVariance = monthlyNetPremiums.length > 1
    ? monthlyNetPremiums.reduce((s, v) => s + (v - monthlyMean) ** 2, 0) / (monthlyNetPremiums.length - 1)
    : 0;
  const monthlyIncomeStd = Math.sqrt(monthlyVariance);
  const zeroIncomeMonths = monthlyNetPremiums.filter((v) => v === 0).length;
  const worstMonthPnl = monthlyNetPremiums.length > 0 ? Math.min(...monthlyNetPremiums) : 0;
  const worstCyclePnl = trades.length > 0 ? Math.min(...trades.map((t) => t.cyclePnl)) : 0;

  // Regime breakdown: bucket trades by market regime
  const regimeBreakdown: { regime: string; cycles: number; pnl: number; winRate: number }[] = [];
  if (marketContext && marketContext.regimes.length > 0) {
    const regimeMap = new Map<string, { cycles: number; pnl: number; wins: number }>();
    for (const trade of trades) {
      // Find the regime that contains this trade's open date
      let tradeRegime = "UNKNOWN";
      for (const r of marketContext.regimes) {
        if (trade.openDate >= r.startDate && trade.openDate <= r.endDate) {
          tradeRegime = r.type;
          break;
        }
      }
      const entry = regimeMap.get(tradeRegime) ?? { cycles: 0, pnl: 0, wins: 0 };
      entry.cycles++;
      entry.pnl += trade.cyclePnl;
      if (trade.outcome === "EXPIRED_WORTHLESS" || trade.outcome === "BOUGHT_BACK") entry.wins++;
      regimeMap.set(tradeRegime, entry);
    }
    for (const [regime, v] of regimeMap) {
      regimeBreakdown.push({
        regime,
        cycles: v.cycles,
        pnl: v.pnl,
        winRate: v.cycles > 0 ? v.wins / v.cycles : 0,
      });
    }
  }

  return {
    strategy: config.strategy,
    symbol: config.symbol,
    startDate: firstPrice.date,
    endDate: lastPrice.date,
    trades,
    totalPremiumIncome: cashFromPremium,
    totalCycles: trades.length,
    winRate: trades.length > 0
      ? (expiredWorthlessCount + earlyCloseCount) / trades.length
      : 0,
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
    maxDrawdown: dailyDd,
    sharpeRatio: dailySr,
    sortinoRatio: dailySortino,
    calmarRatio: calmar,
    equityCurve,
    dailyEquityCurve,
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
    touchExitCount,
    touchEntryCount,
    touchCycles,
    monthlyCashFlow: monthlyFlow,
    interestIncome,
    totalCommissions,
    returnOnCapitalDeployed,
    capitalUtilization,
    monthlyIncomeStdDev: monthlyIncomeStd,
    zeroIncomeMonths,
    worstCyclePnl,
    worstMonthPnl,
    costBasisHistory,
    netCostBasisReduction: premiumPerShareHeld,
    daysUnderwater,
    regimeBreakdown,
    rolledPutCount,
    stopLossCount,
    earningsSkippedCount,
    ivRankSkippedCount,
    managedEarlyCount,
    earlyAssignmentCount,
    ratioPutContractsSold,
    ratioCallContractsSold,
    ratioDeltaAdjustments,
    ratioRebalances,
    warnings,
  };
}
