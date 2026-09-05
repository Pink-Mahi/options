/**
 * Core option math: intrinsic/extrinsic value, pricing assumptions, annualization.
 *
 * All functions here are PURE and DETERMINISTIC: same inputs => same outputs.
 * No market data, no IO, no randomness. Unit-tested in `./core.test.ts`.
 */

import type {
  OptionContract,
  OptionPriceAssumption,
  PriceAssumption,
} from "@/lib/types";

/** Standard U.S. equity option contract multiplier unless provider says otherwise. */
export const DEFAULT_CONTRACT_MULTIPLIER = 100;

/**
 * Intrinsic value per share.
 * Call: max(0, stock - strike). Put: max(0, strike - stock).
 */
export function intrinsicValue(
  optionType: "CALL" | "PUT",
  stockPrice: number,
  strike: number,
): number {
  if (optionType === "CALL") return Math.max(0, stockPrice - strike);
  return Math.max(0, strike - stockPrice);
}

/**
 * Extrinsic (time) value per share = optionPrice - intrinsicValue.
 * Never negative in a healthy market; clamp to 0 if data noise produces negatives.
 */
export function extrinsicValue(
  optionType: "CALL" | "PUT",
  stockPrice: number,
  strike: number,
  optionPrice: number,
): number {
  const iv = intrinsicValue(optionType, stockPrice, strike);
  return Math.max(0, optionPrice - iv);
}

/** Resolve the price-per-share to use for calculations given an assumption. */
export function resolveOptionPrice(
  contract: Pick<
    OptionContract,
    "bid" | "ask" | "midpoint" | "last"
  >,
  assumption: PriceAssumption,
  customPrice?: number,
): OptionPriceAssumption {
  const { bid, ask, midpoint, last } = contract;
  const mid =
    midpoint ??
    (bid != null && ask != null ? (bid + ask) / 2 : null);

  let pricePerShare: number;
  switch (assumption) {
    case "bid":
      pricePerShare = bid ?? mid ?? last ?? 0;
      break;
    case "ask":
      pricePerShare = ask ?? mid ?? last ?? 0;
      break;
    case "midpoint":
      pricePerShare = mid ?? last ?? bid ?? ask ?? 0;
      break;
    case "last":
      pricePerShare = last ?? mid ?? bid ?? ask ?? 0;
      break;
    case "custom":
      pricePerShare = customPrice ?? mid ?? 0;
      break;
    default:
      pricePerShare = mid ?? 0;
  }

  return {
    type: assumption,
    pricePerShare,
    bid,
    ask,
    midpoint: mid,
    last,
  };
}

/** Premium income for N contracts. premiumPerShare * multiplier * contracts. */
export function premiumIncome(
  premiumPerShare: number,
  contracts: number,
  multiplier: number = DEFAULT_CONTRACT_MULTIPLIER,
): number {
  return premiumPerShare * multiplier * contracts;
}

/** Premium per contract (per-share premium * multiplier). */
export function premiumPerContract(
  premiumPerShare: number,
  multiplier: number = DEFAULT_CONTRACT_MULTIPLIER,
): number {
  return premiumPerShare * multiplier;
}

// ---------------------------------------------------------------------------
// Annualization
// ---------------------------------------------------------------------------

/**
 * Simple annualized rate: periodReturn * (365 / DTE).
 * A comparison tool only — does NOT imply the trade can be repeated.
 */
export function simpleAnnualizedRate(periodReturn: number, dte: number): number {
  if (dte <= 0) return 0;
  return periodReturn * (365 / dte);
}

/**
 * Compounded equivalent annual rate: (1 + periodReturn)^(365/DTE) - 1.
 * A comparison tool only.
 */
export function compoundAnnualizedRate(
  periodReturn: number,
  dte: number,
): number {
  if (dte <= 0) return 0;
  return Math.pow(1 + periodReturn, 365 / dte) - 1;
}

// ---------------------------------------------------------------------------
// Strike distance
// ---------------------------------------------------------------------------

/** OTM % for a covered call: (strike - current) / current. */
export function strikeOtmPercent(strike: number, currentPrice: number): number {
  if (currentPrice === 0) return 0;
  return (strike - currentPrice) / currentPrice;
}

/** Discount % for a put strike: (current - strike) / current. */
export function strikeDiscountPercent(
  strike: number,
  currentPrice: number,
): number {
  if (currentPrice === 0) return 0;
  return (currentPrice - strike) / currentPrice;
}

/** Potential stock appreciation to strike: (strike - current) / current. */
export function potentialStockAppreciation(
  strike: number,
  currentPrice: number,
): number {
  return strikeOtmPercent(strike, currentPrice);
}

// ---------------------------------------------------------------------------
// Liquidity
// ---------------------------------------------------------------------------

export function bidAskSpread(
  bid: number | null,
  ask: number | null,
): number | null {
  if (bid == null || ask == null) return null;
  return ask - bid;
}

export function bidAskSpreadPercent(
  bid: number | null,
  ask: number | null,
): number | null {
  if (bid == null || ask == null) return null;
  const mid = (bid + ask) / 2;
  if (mid === 0) return null;
  return (ask - bid) / mid;
}

/**
 * Liquidity score 0-100. Combines open interest, volume, and bid/ask spread.
 * Deterministic. Wider spread and lower OI/volume reduce the score.
 */
export function liquidityScore(input: {
  openInterest: number | null;
  volume: number | null;
  bidAskSpreadPercent: number | null;
}): number {
  const { openInterest, volume, bidAskSpreadPercent: spread } = input;

  // OI component: 0 OI -> 0, >=500 OI -> full
  const oiScore = openInterest == null ? 0 : Math.min(1, openInterest / 500);

  // Volume component: 0 vol -> 0, >=200 vol -> full
  const volScore = volume == null ? 0 : Math.min(1, volume / 200);

  // Spread component: <=1% -> full, >=20% -> 0
  let spreadScore = 0.5; // unknown spread gets neutral
  if (spread != null) {
    if (spread <= 0.01) spreadScore = 1;
    else if (spread >= 0.2) spreadScore = 0;
    else spreadScore = 1 - (spread - 0.01) / (0.2 - 0.01);
  }

  const combined = oiScore * 0.4 + volScore * 0.3 + spreadScore * 0.3;
  return Math.round(combined * 100);
}

// ---------------------------------------------------------------------------
// Greeks helpers
// ---------------------------------------------------------------------------

/**
 * Estimated probability of finishing ITM. For a short option this is the
 * assignment probability estimate. Uses |delta| when available (delta ≈
 * risk-neutral probability of finishing ITM for ATM-ish options), otherwise
 * returns null — we never fabricate a probability.
 */
export function estimatedAssignmentProbability(
  delta: number | null,
  optionType: "CALL" | "PUT",
): number | null {
  if (delta == null) return null;
  // For a short CALL, assignment prob ≈ delta of the call.
  // For a short PUT, assignment prob ≈ |delta| of the put (put delta is negative).
  const prob = optionType === "CALL" ? delta : Math.abs(delta);
  return clamp(prob, 0, 1);
}

export function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

/** Days between two dates (calendar days, floor). */
export function daysBetween(start: Date | string, end: Date | string): number {
  const s = typeof start === "string" ? new Date(start) : start;
  const e = typeof end === "string" ? new Date(end) : end;
  const ms = e.getTime() - s.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/** True if a calendar event date lies strictly before the option expiration. */
export function eventBeforeExpiration(
  eventDate: string | null | undefined,
  expiration: string,
): boolean {
  if (!eventDate) return false;
  return new Date(eventDate) < new Date(expiration);
}
