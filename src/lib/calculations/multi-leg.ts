/**
 * Multi-leg options strategies: credit spreads, collars, iron condors, diagonals.
 *
 * Each strategy is defined as a collection of legs (long/short, call/put, strike, expiry).
 * The engine computes:
 * - Net premium (credit or debit)
 * - Max profit / max loss
 * - Breakeven points
 * - Risk/reward ratios
 * - Payoff at expiration across a range of prices
 * - Combined Greeks (if available)
 *
 * All functions are PURE and DETERMINISTIC. Unit-tested in ./multi-leg.test.ts.
 */

import type { OptionType, Greeks, PayoffPoint } from "@/lib/types";
import { blackScholes } from "./pricing-model";

// ---------------------------------------------------------------------------
// Leg definition
// ---------------------------------------------------------------------------

export type LegAction = "BUY" | "SELL";

export interface StrategyLeg {
  action: LegAction;
  optionType: OptionType;
  strike: number;
  expiration: string; // ISO date
  daysToExpiration: number;
  pricePerShare: number; // premium paid (BUY) or received (SELL)
  contracts: number;
  greeks?: Greeks | null;
  impliedVolatility?: number | null;
}

export type StrategyKind =
  | "BULL_PUT_SPREAD"
  | "BEAR_CALL_SPREAD"
  | "BULL_CALL_SPREAD"
  | "BEAR_PUT_SPREAD"
  | "COLLAR"
  | "IRON_CONDOR"
  | "IRON_FLY"
  | "SHORT_STRANGLE"
  | "LONG_STRADDLE"
  | "POOR_MANS_COVERED_CALL"
  | "CUSTOM";

// ---------------------------------------------------------------------------
// Strategy result
// ---------------------------------------------------------------------------

export interface MultiLegResult {
  kind: StrategyKind;
  legs: StrategyLeg[];
  netPremiumPerShare: number; // positive = credit, negative = debit
  netPremiumTotal: number; // per # contracts
  maxProfit: number | null; // null for undefined risk strategies
  maxLoss: number | null; // null for undefined risk strategies
  breakevens: number[];
  riskRewardRatio: number | null; // maxProfit / maxLoss
  combinedGreeks: Greeks;
  payoffPoints: PayoffPoint[];
  marginRequirement: number | null; // estimate for defined-risk spreads
  notes: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MULTIPLIER = 100;

function legSign(action: LegAction): number {
  return action === "BUY" ? -1 : 1;
}

/** Payoff sign: BUY = +1 (profit = intrinsic - premium), SELL = -1 (profit = premium - intrinsic) */
function payoffSign(action: LegAction): number {
  return action === "BUY" ? 1 : -1;
}

function payoffAtExpiration(leg: StrategyLeg, spot: number): number {
  const intrinsic = leg.optionType === "CALL"
    ? Math.max(0, spot - leg.strike)
    : Math.max(0, leg.strike - spot);
  // BUY: profit = intrinsic - premium. SELL: profit = premium - intrinsic.
  return payoffSign(leg.action) * (intrinsic - leg.pricePerShare) * leg.contracts * MULTIPLIER;
}

function combineGreeks(legs: StrategyLeg[]): Greeks {
  const combined: Greeks = { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  for (const leg of legs) {
    if (!leg.greeks) continue;
    if (leg.greeks.delta != null) combined.delta = (combined.delta ?? 0) + leg.greeks.delta * payoffSign(leg.action) * leg.contracts * MULTIPLIER;
    if (leg.greeks.gamma != null) combined.gamma = (combined.gamma ?? 0) + leg.greeks.gamma * payoffSign(leg.action) * leg.contracts * MULTIPLIER;
    if (leg.greeks.theta != null) combined.theta = (combined.theta ?? 0) + leg.greeks.theta * payoffSign(leg.action) * leg.contracts * MULTIPLIER;
    if (leg.greeks.vega != null) combined.vega = (combined.vega ?? 0) + leg.greeks.vega * payoffSign(leg.action) * leg.contracts * MULTIPLIER;
    if (leg.greeks.rho != null) combined.rho = (combined.rho ?? 0) + leg.greeks.rho * payoffSign(leg.action) * leg.contracts * MULTIPLIER;
  }
  return combined;
}

function generatePayoff(legs: StrategyLeg[], currentPrice: number): PayoffPoint[] {
  const points: PayoffPoint[] = [];
  const allStrikes = legs.map((l) => l.strike);
  const minStrike = Math.min(...allStrikes, currentPrice);
  const maxStrike = Math.max(...allStrikes, currentPrice);
  const range = Math.max(maxStrike - minStrike, currentPrice * 0.2);
  const low = Math.max(0, minStrike - range * 0.3);
  const high = maxStrike + range * 0.3;
  const steps = 80;

  for (let i = 0; i <= steps; i++) {
    const stockPrice = low + ((high - low) * i) / steps;
    let optionPnl = 0;
    for (const leg of legs) {
      optionPnl += payoffAtExpiration(leg, stockPrice);
    }
    points.push({
      stockPrice,
      stockOnlyPnl: 0,
      optionPnl,
      combinedPnl: optionPnl,
      combinedReturnPercent: 0,
    });
  }
  return points;
}

function findBreakevens(legs: StrategyLeg[], currentPrice: number): number[] {
  const points = generatePayoff(legs, currentPrice);
  const breakevens: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev && curr && prev.optionPnl <= 0 && curr.optionPnl > 0) {
      // Linear interpolation
      const ratio = Math.abs(prev.optionPnl) / (Math.abs(prev.optionPnl) + curr.optionPnl);
      breakevens.push(prev.stockPrice + (curr.stockPrice - prev.stockPrice) * ratio);
    } else if (prev && curr && prev.optionPnl > 0 && curr.optionPnl <= 0) {
      const ratio = prev.optionPnl / (prev.optionPnl + Math.abs(curr.optionPnl));
      breakevens.push(prev.stockPrice + (curr.stockPrice - prev.stockPrice) * ratio);
    }
  }
  return breakevens;
}

// ---------------------------------------------------------------------------
// Strategy analyzers
// ---------------------------------------------------------------------------

/**
 * Analyze any multi-leg strategy from its legs.
 * Automatically classifies the strategy kind and computes all metrics.
 */
export function analyzeMultiLegStrategy(
  legs: StrategyLeg[],
  currentPrice: number,
): MultiLegResult {
  const kind = classifyStrategy(legs);
  const netPremiumPerShare = legs.reduce(
    (sum, leg) => sum + legSign(leg.action) * leg.pricePerShare * leg.contracts,
    0,
  );
  const netPremiumTotal = netPremiumPerShare * MULTIPLIER;

  const payoffPoints = generatePayoff(legs, currentPrice);
  const breakevens = findBreakevens(legs, currentPrice);
  const combinedGreeks = combineGreeks(legs);

  // Determine max profit / loss from payoff curve
  const payoffs = payoffPoints.map((p) => p.optionPnl);
  const maxProfit = Math.max(...payoffs);
  const maxLoss = Math.min(...payoffs);

  // For defined-risk strategies, these are the true max values.
  // For undefined risk (short strangle, naked), maxLoss is technically infinite.
  const hasUndefinedRisk = kind === "SHORT_STRANGLE";
  const hasUndefinedProfit = kind === "LONG_STRADDLE";

  const notes: string[] = [];

  let marginRequirement: number | null = null;

  switch (kind) {
    case "BULL_PUT_SPREAD":
    case "BEAR_PUT_SPREAD": {
      const strikes = legs.filter((l) => l.optionType === "PUT").map((l) => l.strike);
      const width = Math.abs(Math.max(...strikes) - Math.min(...strikes));
      marginRequirement = width * MULTIPLIER * (legs[0]?.contracts ?? 1);
      notes.push(`Defined risk: max loss = strike width - credit = $${(width * MULTIPLIER - Math.abs(netPremiumTotal)).toFixed(0)}`);
      break;
    }
    case "BEAR_CALL_SPREAD":
    case "BULL_CALL_SPREAD": {
      const strikes = legs.filter((l) => l.optionType === "CALL").map((l) => l.strike);
      const width = Math.abs(Math.max(...strikes) - Math.min(...strikes));
      marginRequirement = width * MULTIPLIER * (legs[0]?.contracts ?? 1);
      notes.push(`Defined risk: max loss = strike width - credit = $${(width * MULTIPLIER - Math.abs(netPremiumTotal)).toFixed(0)}`);
      break;
    }
    case "COLLAR": {
      notes.push("Collar: long stock + protective put + short call. Defined risk and capped upside.");
      break;
    }
    case "IRON_CONDOR": {
      const callStrikes = legs.filter((l) => l.optionType === "CALL").map((l) => l.strike);
      const putStrikes = legs.filter((l) => l.optionType === "PUT").map((l) => l.strike);
      const callWidth = Math.abs(Math.max(...callStrikes) - Math.min(...callStrikes));
      const putWidth = Math.abs(Math.max(...putStrikes) - Math.min(...putStrikes));
      const maxWidth = Math.max(callWidth, putWidth);
      marginRequirement = maxWidth * MULTIPLIER * (legs[0]?.contracts ?? 1);
      notes.push(`Iron condor: max loss = widest wing - credit = $${(maxWidth * MULTIPLIER - Math.abs(netPremiumTotal)).toFixed(0)}`);
      break;
    }
    case "SHORT_STRANGLE": {
      notes.push("UNDEFINED RISK: max loss is theoretically unlimited if stock moves beyond either strike.");
      break;
    }
    case "LONG_STRADDLE": {
      notes.push("Long straddle: max loss = total premium paid. Profit if stock moves significantly in either direction.");
      break;
    }
    case "POOR_MANS_COVERED_CALL": {
      notes.push("Poor man's covered call: long LEAPS call (stock substitute) + short near-term call. Capital-efficient covered call alternative.");
      break;
    }
    default:
      break;
  }

  const riskRewardRatio = maxLoss !== 0 && !hasUndefinedRisk
    ? Math.abs(maxProfit / maxLoss)
    : null;

  return {
    kind,
    legs,
    netPremiumPerShare,
    netPremiumTotal,
    maxProfit: hasUndefinedProfit ? null : maxProfit,
    maxLoss: hasUndefinedRisk ? null : maxLoss,
    breakevens,
    riskRewardRatio,
    combinedGreeks,
    payoffPoints,
    marginRequirement,
    notes,
  };
}

/**
 * Classify a strategy based on its legs.
 */
export function classifyStrategy(legs: StrategyLeg[]): StrategyKind {
  if (legs.length === 2) {
    const [l1, l2] = legs;
    if (!l1 || !l2) return "CUSTOM";

    // Both puts
    if (l1.optionType === "PUT" && l2.optionType === "PUT") {
      if (l1.action === "SELL" && l2.action === "BUY") {
        // Short put at higher strike, long put at lower strike = bull put spread
        if (l1.strike > l2.strike) return "BULL_PUT_SPREAD";
        return "BEAR_PUT_SPREAD";
      }
      if (l1.action === "BUY" && l2.action === "SELL") {
        if (l1.strike > l2.strike) return "BEAR_PUT_SPREAD";
        return "BULL_PUT_SPREAD";
      }
    }

    // Both calls
    if (l1.optionType === "CALL" && l2.optionType === "CALL") {
      // Poor man's covered call: buy long-dated call + sell short-dated call
      const longDte = l1.action === "BUY" ? l1.daysToExpiration : l2.daysToExpiration;
      const shortDte = l1.action === "SELL" ? l1.daysToExpiration : l2.daysToExpiration;
      if (l1.action === "BUY" && l2.action === "SELL" && longDte > shortDte * 2) {
        return "POOR_MANS_COVERED_CALL";
      }
      if (l1.action === "SELL" && l2.action === "BUY" && longDte > shortDte * 2) {
        return "POOR_MANS_COVERED_CALL";
      }
      if (l1.action === "SELL" && l2.action === "BUY") {
        // Short call at lower strike, long call at higher strike = bear call spread
        if (l1.strike < l2.strike) return "BEAR_CALL_SPREAD";
        return "BULL_CALL_SPREAD";
      }
      if (l1.action === "BUY" && l2.action === "SELL") {
        if (l1.strike < l2.strike) return "BULL_CALL_SPREAD";
        return "BEAR_CALL_SPREAD";
      }
    }

    // Short strangle: sell put + sell call
    if (l1.action === "SELL" && l2.action === "SELL" && l1.optionType !== l2.optionType) {
      return "SHORT_STRANGLE";
    }

    // Long straddle: buy put + buy call (same strike)
    if (l1.action === "BUY" && l2.action === "BUY" && l1.optionType !== l2.optionType) {
      if (l1.strike === l2.strike) return "LONG_STRADDLE";
      return "LONG_STRADDLE"; // strangle variant, still same category
    }

    // Collar: buy put + sell call (different strikes)
    if (l1.optionType !== l2.optionType && l1.action !== l2.action) {
      return "COLLAR";
    }

    // Poor man's covered call: buy long-dated call + sell short-dated call
    if (l1.optionType === "CALL" && l2.optionType === "CALL" && l1.action === "BUY" && l2.action === "SELL") {
      if (l1.daysToExpiration > l2.daysToExpiration * 2) return "POOR_MANS_COVERED_CALL";
    }
    // (Already handled above in the both-calls section)
  }

  if (legs.length === 4) {
    const calls = legs.filter((l) => l.optionType === "CALL");
    const puts = legs.filter((l) => l.optionType === "PUT");
    const sells = legs.filter((l) => l.action === "SELL");
    const buys = legs.filter((l) => l.action === "BUY");

    if (calls.length === 2 && puts.length === 2 && sells.length === 2 && buys.length === 2) {
      // Check if all strikes are the same (iron fly) or different (iron condor)
      const allStrikes = legs.map((l) => l.strike);
      const uniqueStrikes = new Set(allStrikes);
      if (uniqueStrikes.size === 4) return "IRON_CONDOR";
      if (uniqueStrikes.size === 3) return "IRON_FLY";
    }
  }

  return "CUSTOM";
}

// ---------------------------------------------------------------------------
// Convenience builders
// ---------------------------------------------------------------------------

export interface SpreadInput {
  shortStrike: number;
  longStrike: number;
  shortPremium: number;
  longPremium: number;
  contracts: number;
  daysToExpiration: number;
  expiration: string;
  greeks?: { short: Greeks | null; long: Greeks | null };
}

/**
 * Build a bull put spread (sell higher strike put, buy lower strike put).
 */
export function bullPutSpread(input: SpreadInput): StrategyLeg[] {
  return [
    {
      action: "SELL",
      optionType: "PUT",
      strike: input.shortStrike,
      expiration: input.expiration,
      daysToExpiration: input.daysToExpiration,
      pricePerShare: input.shortPremium,
      contracts: input.contracts,
      greeks: input.greeks?.short ?? null,
    },
    {
      action: "BUY",
      optionType: "PUT",
      strike: input.longStrike,
      expiration: input.expiration,
      daysToExpiration: input.daysToExpiration,
      pricePerShare: input.longPremium,
      contracts: input.contracts,
      greeks: input.greeks?.long ?? null,
    },
  ];
}

/**
 * Build a bear call spread (sell lower strike call, buy higher strike call).
 */
export function bearCallSpread(input: SpreadInput): StrategyLeg[] {
  return [
    {
      action: "SELL",
      optionType: "CALL",
      strike: input.shortStrike,
      expiration: input.expiration,
      daysToExpiration: input.daysToExpiration,
      pricePerShare: input.shortPremium,
      contracts: input.contracts,
      greeks: input.greeks?.short ?? null,
    },
    {
      action: "BUY",
      optionType: "CALL",
      strike: input.longStrike,
      expiration: input.expiration,
      daysToExpiration: input.daysToExpiration,
      pricePerShare: input.longPremium,
      contracts: input.contracts,
      greeks: input.greeks?.long ?? null,
    },
  ];
}

export interface IronCondorInput {
  putShortStrike: number;
  putLongStrike: number;
  callShortStrike: number;
  callLongStrike: number;
  putShortPremium: number;
  putLongPremium: number;
  callShortPremium: number;
  callLongPremium: number;
  contracts: number;
  daysToExpiration: number;
  expiration: string;
}

/**
 * Build an iron condor (sell put spread + sell call spread).
 */
export function ironCondor(input: IronCondorInput): StrategyLeg[] {
  return [
    { action: "BUY", optionType: "PUT", strike: input.putLongStrike, expiration: input.expiration, daysToExpiration: input.daysToExpiration, pricePerShare: input.putLongPremium, contracts: input.contracts },
    { action: "SELL", optionType: "PUT", strike: input.putShortStrike, expiration: input.expiration, daysToExpiration: input.daysToExpiration, pricePerShare: input.putShortPremium, contracts: input.contracts },
    { action: "SELL", optionType: "CALL", strike: input.callShortStrike, expiration: input.expiration, daysToExpiration: input.daysToExpiration, pricePerShare: input.callShortPremium, contracts: input.contracts },
    { action: "BUY", optionType: "CALL", strike: input.callLongStrike, expiration: input.expiration, daysToExpiration: input.daysToExpiration, pricePerShare: input.callLongPremium, contracts: input.contracts },
  ];
}

export interface CollarInput {
  shares: number;
  stockPrice: number;
  putStrike: number;
  putPremium: number;
  callStrike: number;
  callPremium: number;
  contracts: number;
  daysToExpiration: number;
  expiration: string;
}

/**
 * Build a collar (long stock + long put + short call).
 * Returns only the option legs — stock is tracked separately.
 */
export function collar(input: CollarInput): StrategyLeg[] {
  return [
    { action: "BUY", optionType: "PUT", strike: input.putStrike, expiration: input.expiration, daysToExpiration: input.daysToExpiration, pricePerShare: input.putPremium, contracts: input.contracts },
    { action: "SELL", optionType: "CALL", strike: input.callStrike, expiration: input.expiration, daysToExpiration: input.daysToExpiration, pricePerShare: input.callPremium, contracts: input.contracts },
  ];
}

export interface DiagonalInput {
  longStrike: number;
  longPremium: number;
  longDte: number;
  longExpiration: string;
  shortStrike: number;
  shortPremium: number;
  shortDte: number;
  shortExpiration: string;
  contracts: number;
}

/**
 * Build a poor man's covered call (long LEAPS call + short near-term call).
 */
export function poorMansCoveredCall(input: DiagonalInput): StrategyLeg[] {
  return [
    { action: "BUY", optionType: "CALL", strike: input.longStrike, expiration: input.longExpiration, daysToExpiration: input.longDte, pricePerShare: input.longPremium, contracts: input.contracts },
    { action: "SELL", optionType: "CALL", strike: input.shortStrike, expiration: input.shortExpiration, daysToExpiration: input.shortDte, pricePerShare: input.shortPremium, contracts: input.contracts },
  ];
}
