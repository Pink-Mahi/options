/**
 * Return calculations shared by covered-call and CSP analyzers.
 * Pure & deterministic. Unit-tested.
 */

import { compoundAnnualizedRate, simpleAnnualizedRate } from "./core";

// ---------------------------------------------------------------------------
// Premium yields
// ---------------------------------------------------------------------------

/** Premium return on current stock market value. */
export function premiumYield(
  premiumIncomeValue: number,
  currentMarketValue: number,
): number {
  if (currentMarketValue === 0) return 0;
  return premiumIncomeValue / currentMarketValue;
}

/** Premium return on cost basis. */
export function premiumYieldOnCost(
  premiumIncomeValue: number,
  costBasisValue: number,
): number {
  if (costBasisValue === 0) return 0;
  return premiumIncomeValue / costBasisValue;
}

// ---------------------------------------------------------------------------
// Covered call returns
// ---------------------------------------------------------------------------

/**
 * Max profit per share if assigned = premium + (strike - current).
 * For a covered call written against shares already owned, the appreciation
 * component is measured from CURRENT price (economic max profit from today).
 */
export function maxProfitPerShareForCall(
  premiumPerShare: number,
  strike: number,
  currentPrice: number,
): number {
  return premiumPerShare + Math.max(0, strike - currentPrice);
}

/** Max total return on current market value. */
export function maxTotalReturnForCall(
  maxProfitPerShare: number,
  currentPrice: number,
): number {
  if (currentPrice === 0) return 0;
  return maxProfitPerShare / currentPrice;
}

/**
 * Max total return on the user's actual cost basis.
 * premiumPerShare + (strike - costBasis) all divided by costBasis.
 */
export function maxTotalReturnOnCostForCall(
  premiumPerShare: number,
  strike: number,
  costBasisPerShare: number,
): number {
  if (costBasisPerShare === 0) return 0;
  const gain = premiumPerShare + (strike - costBasisPerShare);
  return gain / costBasisPerShare;
}

/** Annualized max total return (simple method). Comparison tool only. */
export function annualizedMaxTotalReturnForCall(
  maxTotalReturn: number,
  dte: number,
): number {
  return simpleAnnualizedRate(maxTotalReturn, dte);
}

/** Compounded annualized max total return. Comparison tool only. */
export function compoundedAnnualizedMaxTotalReturnForCall(
  maxTotalReturn: number,
  dte: number,
): number {
  return compoundAnnualizedRate(maxTotalReturn, dte);
}

/**
 * Covered call break-even.
 * For a newly purchased stock: shareCost - premium.
 * For an existing holding we still report the economic break-even relative to
 * the chosen reference price (cost basis OR current price — caller decides).
 */
export function breakEvenForCall(
  referencePrice: number,
  premiumPerShare: number,
): number {
  return referencePrice - premiumPerShare;
}

/** Downside protection from newly received premium, as a fraction of current price. */
export function downsideProtectionPercent(
  premiumPerShare: number,
  currentPrice: number,
): number {
  if (currentPrice === 0) return 0;
  return premiumPerShare / currentPrice;
}

/**
 * Assignment stock gain relative to cost basis (per share).
 * (strike - costBasis) — can be negative.
 */
export function assignmentStockGainPerShare(
  strike: number,
  costBasisPerShare: number,
): number {
  return strike - costBasisPerShare;
}

/** Total assigned profit (dollars) = assignmentStockGain * coveredShares + premiumIncome. */
export function totalAssignedProfit(
  strike: number,
  costBasisPerShare: number,
  coveredShares: number,
  premiumIncomeValue: number,
): number {
  const gain = assignmentStockGainPerShare(strike, costBasisPerShare) * coveredShares;
  return gain + premiumIncomeValue;
}

// ---------------------------------------------------------------------------
// Cash-secured put returns
// ---------------------------------------------------------------------------

/** Gross cash collateral = strike * multiplier * contracts. */
export function grossCollateral(
  strike: number,
  contracts: number,
  multiplier: number = 100,
): number {
  return strike * multiplier * contracts;
}

/** Net capital at risk = gross collateral - premium income. */
export function netCapitalAtRisk(
  grossCollateralValue: number,
  premiumIncomeValue: number,
): number {
  return grossCollateralValue - premiumIncomeValue;
}

/** Return on gross collateral. */
export function returnOnGrossCollateral(
  premiumIncomeValue: number,
  grossCollateralValue: number,
): number {
  if (grossCollateralValue === 0) return 0;
  return premiumIncomeValue / grossCollateralValue;
}

/** Return on net capital. */
export function returnOnNetCapital(
  premiumIncomeValue: number,
  netCapitalValue: number,
): number {
  if (netCapitalValue === 0) return 0;
  return premiumIncomeValue / netCapitalValue;
}

/** Effective purchase price if put is assigned = strike - premiumPerShare. */
export function effectivePurchasePrice(
  strike: number,
  premiumPerShare: number,
): number {
  return strike - premiumPerShare;
}

/** CSP break-even = strike - premiumPerShare (same as effective purchase price). */
export function cspBreakEven(strike: number, premiumPerShare: number): number {
  return strike - premiumPerShare;
}

/** Discount to current price if assigned = (current - effective) / current. */
export function discountToCurrentPrice(
  currentPrice: number,
  effectivePurchasePriceValue: number,
): number {
  if (currentPrice === 0) return 0;
  return (currentPrice - effectivePurchasePriceValue) / currentPrice;
}
