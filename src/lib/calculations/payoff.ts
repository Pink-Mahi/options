/**
 * Payoff graph generation at expiration.
 * Pure & deterministic. Unit-tested.
 */

import type { PayoffPoint, PayoffSeries } from "@/lib/types";

export interface CoveredCallPayoffInput {
  currentPrice: number;
  strike: number;
  premiumPerShare: number;
  costBasisPerShare?: number | null;
  contracts: number;
  multiplier?: number;
  /** Number of price points to sample. */
  points?: number;
  /** Optional explicit price range [min, max]. Otherwise auto from current price. */
  priceRange?: [number, number];
}

/**
 * Generate the expiration payoff for a covered call vs stock-only.
 *
 * Covered call P/L per share at expiration:
 *   if S <= K: premiumPerShare              (call expires worthless, keep premium)
 *   if S >  K: premiumPerShare + (K - S)    (called away at K)
 * Stock-only P/L per share: S - referencePrice (cost basis if known, else current).
 *
 * Combined P/L is scaled by contracts * multiplier for the option leg and
 * coveredShares for the stock leg (they match by construction).
 */
export function coveredCallPayoff(input: CoveredCallPayoffInput): PayoffSeries {
  const {
    currentPrice,
    strike,
    premiumPerShare,
    costBasisPerShare = null,
    contracts,
    multiplier = 100,
    points = 81,
  } = input;

  const referencePrice = costBasisPerShare ?? currentPrice;
  const coveredShares = contracts * multiplier;

  const [min, max] =
    input.priceRange ??
    autoRange(currentPrice, strike, premiumPerShare, costBasisPerShare);

  const step = (max - min) / (points - 1);
  const pts: PayoffPoint[] = [];

  for (let i = 0; i < points; i++) {
    const s = min + step * i;
    // Stock-only P/L (for the covered share block)
    const stockOnlyPnl = (s - referencePrice) * coveredShares;
    // Short call P/L: received premium, pay out (S - K) if ITM
    const callPnl =
      s > strike
        ? (premiumPerShare - (s - strike)) * coveredShares
        : premiumPerShare * coveredShares;
    const combinedPnl = stockOnlyPnl + callPnl;
    const combinedReturnPercent =
      referencePrice !== 0 ? combinedPnl / (referencePrice * coveredShares) : 0;

    pts.push({
      stockPrice: round2(s),
      stockOnlyPnl: round2(stockOnlyPnl),
      optionPnl: round2(callPnl),
      combinedPnl: round2(combinedPnl),
      combinedReturnPercent: combinedReturnPercent,
    });
  }

  const maxProfit =
    (premiumPerShare + Math.max(0, strike - referencePrice)) * coveredShares;

  return {
    points: pts,
    breakEven: round2(referencePrice - premiumPerShare),
    strike,
    currentPrice,
    maxProfit: round2(maxProfit),
    costBasis: costBasisPerShare,
  };
}

export interface CashSecuredPutPayoffInput {
  currentPrice: number;
  strike: number;
  premiumPerShare: number;
  contracts: number;
  multiplier?: number;
  points?: number;
  priceRange?: [number, number];
}

/**
 * Cash-secured put payoff at expiration.
 * P/L per share: premiumPerShare - max(0, K - S).
 * Scaled by contracts * multiplier.
 */
export function cashSecuredPutPayoff(input: CashSecuredPutPayoffInput): PayoffSeries {
  const {
    currentPrice,
    strike,
    premiumPerShare,
    contracts,
    multiplier = 100,
    points = 81,
  } = input;

  const contractsShares = contracts * multiplier;
  const [min, max] =
    input.priceRange ?? autoRange(currentPrice, strike, premiumPerShare, null);
  const step = (max - min) / (points - 1);
  const pts: PayoffPoint[] = [];

  for (let i = 0; i < points; i++) {
    const s = min + step * i;
    const putPnl =
      s < strike
        ? (premiumPerShare - (strike - s)) * contractsShares
        : premiumPerShare * contractsShares;
    // For CSP, "stockOnlyPnl" is 0 (no stock position) and combined = option P/L.
    pts.push({
      stockPrice: round2(s),
      stockOnlyPnl: 0,
      optionPnl: round2(putPnl),
      combinedPnl: round2(putPnl),
      combinedReturnPercent:
        strike !== 0 ? putPnl / (strike * contractsShares) : 0,
    });
  }

  return {
    points: pts,
    breakEven: round2(strike - premiumPerShare),
    strike,
    currentPrice,
    maxProfit: round2(premiumPerShare * contractsShares),
    costBasis: null,
  };
}

function autoRange(
  currentPrice: number,
  strike: number,
  premiumPerShare: number,
  costBasis: number | null,
): [number, number] {
  const ref = costBasis ?? currentPrice;
  const upper = Math.max(strike, currentPrice) * 1.3;
  const lower = Math.min(ref - premiumPerShare, currentPrice * 0.7, strike * 0.7);
  return [Math.max(0, lower), upper];
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Build an expiration profit table at a fixed set of underlying prices.
 * Price increments auto-adjust to the stock price.
 */
export function expirationProfitTable(
  currentPrice: number,
  stepPercent: number = 0.1,
  count: number = 9,
): number[] {
  const step = Math.max(0.5, currentPrice * stepPercent);
  const half = Math.floor(count / 2);
  const prices: number[] = [];
  for (let i = -half; i <= half; i++) {
    prices.push(round2(currentPrice * (1 + stepPercent * i)));
  }
  return prices;
}
