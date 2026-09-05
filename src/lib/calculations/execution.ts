/**
 * Execution realism — models slippage, fill probability, and market impact
 * to provide more realistic estimates of actual fill prices.
 *
 * All functions are PURE and DETERMINISTIC. Unit-tested in ./execution.test.ts.
 */

export interface ExecutionInput {
  bid: number;
  ask: number;
  volume: number | null;
  openInterest: number | null;
  orderSize: number; // contracts
  orderType: "MARKET" | "LIMIT" | "MID";
  limitPrice?: number; // for LIMIT orders
}

export interface ExecutionResult {
  estimatedFillPrice: number;
  slippage: number; // per share
  fillProbability: number; // 0-1
  effectiveSpread: number;
  marketImpact: number;
  warning: string | null;
}

/**
 * Estimate realistic execution price accounting for spread, slippage, and fill probability.
 */
export function estimateExecution(input: ExecutionInput): ExecutionResult {
  const { bid, ask, volume, openInterest, orderSize, orderType, limitPrice } = input;
  const mid = (bid + ask) / 2;
  const spread = ask - bid;
  const effectiveSpread = spread;

  let estimatedFillPrice: number;
  let slippage: number;
  let fillProbability: number;
  let marketImpact: number;
  let warning: string | null = null;

  // Liquidity assessment
  const volOi = volume != null && openInterest != null && openInterest > 0
    ? volume / openInterest
    : null;

  // Illiquid warning
  if (spread / mid > 0.05) {
    warning = "Wide spread (>5% of mid) — low liquidity, expect significant slippage.";
  } else if (openInterest != null && openInterest < 100) {
    warning = "Low open interest (<100) — fill may be difficult.";
  } else if (volume != null && volume < 10) {
    warning = "Very low volume (<10 contracts today) — fill may be difficult.";
  }

  // Market impact: larger orders relative to volume have more impact
  const volumeRatio = volume != null && volume > 0 ? orderSize / volume : 0.1;
  marketImpact = spread * Math.min(volumeRatio, 1) * 0.5;

  switch (orderType) {
    case "MARKET":
      // Market order: pay the ask (buy) or get the bid (sell) + market impact
      estimatedFillPrice = ask + marketImpact;
      slippage = estimatedFillPrice - mid;
      fillProbability = 0.95; // market orders usually fill but at adverse price
      break;

    case "LIMIT":
      if (limitPrice == null) {
        estimatedFillPrice = mid;
        slippage = 0;
        fillProbability = 0.5;
        break;
      }
      estimatedFillPrice = limitPrice;
      slippage = limitPrice - mid;
      // Fill probability depends on how aggressively the limit is priced
      if (limitPrice >= ask) {
        fillProbability = 0.95;
      } else if (limitPrice >= mid) {
        fillProbability = 0.6;
      } else if (limitPrice >= bid) {
        fillProbability = 0.3;
      } else {
        fillProbability = 0.05;
      }
      // Reduce fill probability for large orders
      if (orderSize > 10) fillProbability *= 0.8;
      if (orderSize > 50) fillProbability *= 0.7;
      break;

    case "MID":
      // Mid-price order: try to fill at mid
      estimatedFillPrice = mid;
      slippage = 0;
      fillProbability = 0.4; // mid-price orders often don't fill
      if (spread > 0.10) fillProbability *= 0.7; // harder with wide spreads
      if (orderSize > 10) fillProbability *= 0.8;
      break;

    default:
      estimatedFillPrice = mid;
      slippage = 0;
      fillProbability = 0.5;
  }

  // Adjust fill probability for liquidity
  if (volOi != null && volOi < 0.1) {
    fillProbability *= 0.9;
  }

  return {
    estimatedFillPrice,
    slippage,
    fillProbability,
    effectiveSpread,
    marketImpact,
    warning,
  };
}

/**
 * Estimate the probability of a limit order filling within a given time frame,
 * based on historical fill patterns and current market conditions.
 */
export function estimateFillProbability(
  delta: number,
  dte: number,
  spreadPercent: number,
  orderSize: number,
  limitOffset: number, // how far from mid (positive = aggressive, negative = passive)
): number {
  let prob = 0.5;

  // More aggressive limit = higher fill probability
  prob += limitOffset * 2;

  // Wider spread = harder to fill at mid
  prob -= spreadPercent * 5;

  // Larger orders = harder to fill
  if (orderSize > 10) prob -= 0.1;
  if (orderSize > 50) prob -= 0.15;

  // Higher delta (more liquid) = easier to fill
  if (delta > 0.3 && delta < 0.7) prob += 0.1;

  // More DTE = more time to fill
  if (dte > 30) prob += 0.05;

  return Math.max(0.01, Math.min(0.99, prob));
}
