/**
 * Cost-aware entry/exit levels and volatility-targeted position sizing.
 *
 * This module answers two questions:
 *
 * 1. **Entry/exit levels**: Given a signal score, current price, volatility,
 *    and transaction costs, what are the exact entry, stop-loss, and
 *    take-profit levels that maximize risk-adjusted return after costs?
 *    The levels are derived from expected move bands and cost-adjusted
 *    breakevens — NOT from AI-generated price targets.
 *
 * 2. **Vol-targeted sizing**: How many shares/contracts should you hold
 *    to target a specific annualized volatility contribution? This is the
 *    Kelly-capped, vol-targeted approach used by risk-parity funds:
 *      target_vol (e.g. 15% annual) / asset_vol → position weight
 *      capped at a max leverage and a Kelly fraction.
 *
 * All functions are PURE and DETERMINISTIC. Unit-tested in ./position-sizing.test.ts.
 */

/** Annualized volatility of 252 trading days. */
const TRADING_DAYS = 252;

export interface CostAwareLevelsInput {
  /** Current underlying price. */
  spot: number;
  /** Annualized volatility (decimal, e.g. 0.30 for 30%). */
  volatility: number;
  /** Holding period in days. */
  holdingDays: number;
  /** Signal score in [-1, 1]. Positive = bullish, negative = bearish. */
  signalScore: number;
  /** Round-trip transaction cost as a fraction of position value (e.g. 0.001 = 10bps). */
  costBps: number;
  /** Risk-free rate for forward pricing (decimal, e.g. 0.05). */
  riskFreeRate?: number;
  /** Stop-loss as a multiple of the expected move (default 1.5x). */
  stopMultiplier?: number;
  /** Take-profit as a multiple of the expected move (default 2.0x). */
  targetMultiplier?: number;
}

export interface CostAwareLevels {
  /** Direction: long or short based on signal sign. */
  direction: "LONG" | "SHORT";
  /** Suggested entry price (spot adjusted for cost). */
  entryPrice: number;
  /** Stop-loss price. */
  stopLoss: number;
  /** Take-profit price. */
  takeProfit: number;
  /** Expected 1-sigma move over the holding period. */
  expectedMove: number;
  /** Expected move as a percentage of spot. */
  expectedMovePct: number;
  /** Risk per share (entry - stop). */
  riskPerShare: number;
  /** Reward per share (target - entry). */
  rewardPerShare: number;
  /** Risk-reward ratio (reward / risk). */
  riskRewardRatio: number;
  /** Breakeven move required after costs. */
  breakevenMove: number;
  /** Cost as a fraction of the expected move. */
  costDragPct: number;
}

/**
 * Compute cost-aware entry, stop, and target levels from volatility and signal.
 *
 * The expected move is sigma_annual * sqrt(T/252) * spot.
 * Stop is placed at `stopMultiplier` × expected move against the position.
 * Target is placed at `targetMultiplier` × expected move in favor.
 * Entry is adjusted by half the round-trip cost (the entry half).
 */
export function computeCostAwareLevels(input: CostAwareLevelsInput): CostAwareLevels {
  const {
    spot,
    volatility,
    holdingDays,
    signalScore,
    costBps,
    riskFreeRate = 0.05,
    stopMultiplier = 1.5,
    targetMultiplier = 2.0,
  } = input;

  const direction: "LONG" | "SHORT" = signalScore >= 0 ? "LONG" : "SHORT";

  // Expected 1-sigma move over holding period.
  const timeFraction = Math.sqrt(holdingDays / TRADING_DAYS);
  const expectedMove = spot * volatility * timeFraction;
  const expectedMovePct = volatility * timeFraction;

  // Cost adjustment: entry is worsened by half the round-trip cost.
  const costPerShare = spot * costBps;
  const halfCost = costPerShare / 2;

  const entryPrice = direction === "LONG"
    ? spot + halfCost   // Buying: pay slightly more
    : spot - halfCost;  // Selling short: receive slightly less

  const stopLoss = direction === "LONG"
    ? entryPrice - stopMultiplier * expectedMove
    : entryPrice + stopMultiplier * expectedMove;

  const takeProfit = direction === "LONG"
    ? entryPrice + targetMultiplier * expectedMove
    : entryPrice - targetMultiplier * expectedMove;

  const riskPerShare = Math.abs(entryPrice - stopLoss);
  const rewardPerShare = Math.abs(takeProfit - entryPrice);
  const riskRewardRatio = riskPerShare > 0 ? rewardPerShare / riskPerShare : 0;

  // Breakeven: must overcome full round-trip cost.
  const breakevenMove = costPerShare;
  const costDragPct = expectedMove > 0 ? costPerShare / expectedMove : 0;

  // Forward price for reference (not used in levels but useful for context).
  const _forward = spot * Math.exp(riskFreeRate * holdingDays / TRADING_DAYS);
  void _forward;

  return {
    direction,
    entryPrice: round(entryPrice),
    stopLoss: round(stopLoss),
    takeProfit: round(takeProfit),
    expectedMove: round(expectedMove),
    expectedMovePct,
    riskPerShare: round(riskPerShare),
    rewardPerShare: round(rewardPerShare),
    riskRewardRatio: round(riskRewardRatio),
    breakevenMove: round(breakevenMove),
    costDragPct,
  };
}

export interface VolTargetSizingInput {
  /** Portfolio capital in dollars. */
  capital: number;
  /** Annualized volatility of the asset (decimal, e.g. 0.30). */
  assetVol: number;
  /** Target annualized volatility contribution (decimal, e.g. 0.15 for 15%). */
  targetVol: number;
  /** Current price of the asset. */
  price: number;
  /** Maximum leverage allowed (e.g. 2.0 = 200% of capital). */
  maxLeverage?: number;
  /** Kelly fraction cap (0 = no Kelly cap, 0.25 = quarter-Kelly). */
  kellyFraction?: number;
  /** Expected annual return of the asset (for Kelly calculation). */
  expectedReturn?: number;
  /** Risk-free rate (for Kelly excess return). */
  riskFreeRate?: number;
}

export interface VolTargetSizing {
  /** Target weight (fraction of capital). */
  weight: number;
  /** Number of shares/units to hold. */
  units: number;
  /** Dollar position size. */
  positionValue: number;
  /** Leverage (weight / 1.0). >1 means leveraged. */
  leverage: number;
  /** Actual volatility contribution at this weight. */
  actualVolContribution: number;
  /** Kelly-optimal weight (before caps). */
  kellyWeight: number;
  /** Whether the Kelly cap was binding. */
  kellyCapped: boolean;
  /** Whether the leverage cap was binding. */
  leverageCapped: boolean;
  /** Warnings. */
  warnings: string[];
}

/**
 * Volatility-targeted position sizing with Kelly cap and leverage limit.
 *
 * Base weight = targetVol / assetVol.
 * Kelly weight = (expectedReturn - riskFreeRate) / assetVol^2  (continuous-time).
 * Final weight = min(base, kellyCap, leverageCap).
 */
export function computeVolTargetSizing(input: VolTargetSizingInput): VolTargetSizing {
  const {
    capital,
    assetVol,
    targetVol,
    price,
    maxLeverage = 2.0,
    kellyFraction = 0.25,
    expectedReturn,
    riskFreeRate = 0.05,
  } = input;

  const warnings: string[] = [];

  if (assetVol <= 0) {
    warnings.push("Asset volatility is zero or negative — cannot compute vol-targeted size.");
    return {
      weight: 0,
      units: 0,
      positionValue: 0,
      leverage: 0,
      actualVolContribution: 0,
      kellyWeight: 0,
      kellyCapped: false,
      leverageCapped: false,
      warnings,
    };
  }

  // Base vol-targeted weight.
  const baseWeight = targetVol / assetVol;

  // Kelly criterion (continuous-time): f* = (mu - r) / sigma^2
  let kellyWeight = Infinity;
  let kellyCapped = false;
  if (expectedReturn != null) {
    const excessReturn = expectedReturn - riskFreeRate;
    kellyWeight = excessReturn / (assetVol * assetVol);
    if (kellyWeight < 0) {
      warnings.push("Kelly weight is negative — expected return is below risk-free rate. Position size set to zero.");
      return {
        weight: 0,
        units: 0,
        positionValue: 0,
        leverage: 0,
        actualVolContribution: 0,
        kellyWeight,
        kellyCapped: true,
        leverageCapped: false,
        warnings,
      };
    }
  }

  // Apply Kelly fraction cap.
  const kellyCap = kellyFraction > 0 && Number.isFinite(kellyWeight)
    ? kellyWeight * kellyFraction
    : Infinity;

  if (kellyCap < baseWeight) {
    kellyCapped = true;
    warnings.push(`Kelly cap (${kellyFraction}x) reduced position from vol-target weight ${baseWeight.toFixed(3)} to ${kellyCap.toFixed(3)}.`);
  }

  // Apply leverage cap.
  const leverageCap = maxLeverage;
  let weight = Math.min(baseWeight, kellyCap, leverageCap);

  const leverageCapped = weight === leverageCap && weight < baseWeight && weight < kellyCap;
  if (leverageCapped) {
    warnings.push(`Leverage cap (${maxLeverage}x) reduced position from ${Math.min(baseWeight, kellyCap).toFixed(3)} to ${leverageCap.toFixed(3)}.`);
  }

  const positionValue = capital * weight;
  const units = price > 0 ? Math.floor(positionValue / price) : 0;
  const actualVolContribution = weight * assetVol;

  return {
    weight: round(weight),
    units,
    positionValue: round(positionValue),
    leverage: round(weight),
    actualVolContribution: round(actualVolContribution),
    kellyWeight: Number.isFinite(kellyWeight) ? round(kellyWeight) : Infinity,
    kellyCapped,
    leverageCapped,
    warnings,
  };
}

function round(x: number): number {
  return Math.round(x * 10000) / 10000;
}
