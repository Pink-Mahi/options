/**
 * Market regime classifier — identifies the current market regime using
 * VIX level, SPY trend, and volatility metrics.
 *
 * Regimes:
 * - LOW_VOL_BULL: VIX < 15, SPY above 200-SMA
 * - HIGH_VOL_BULL: VIX >= 15, SPY above 200-SMA
 * - LOW_VOL_SIDEWAYS: VIX < 15, SPY near 200-SMA
 * - HIGH_VOL_SIDEWAYS: VIX >= 15, SPY near 200-SMA
 * - LOW_VOL_BEAR: VIX < 15, SPY below 200-SMA
 * - HIGH_VOL_BEAR: VIX >= 15, SPY below 200-SMA
 * - CRISIS: VIX > 30
 *
 * Each regime has implications for options strategy selection.
 *
 * All functions are PURE and DETERMINISTIC. Unit-tested in ./market-regime.test.ts.
 */

import type { HistoricalPricePoint } from "@/lib/types";

export type MarketRegime =
  | "LOW_VOL_BULL"
  | "HIGH_VOL_BULL"
  | "LOW_VOL_SIDEWAYS"
  | "HIGH_VOL_SIDEWAYS"
  | "LOW_VOL_BEAR"
  | "HIGH_VOL_BEAR"
  | "CRISIS";

export interface RegimeResult {
  regime: MarketRegime;
  vix: number;
  spyTrend: "up" | "down" | "flat";
  spyAbove200sma: boolean;
  realizedVol30: number;
  description: string;
  strategyImplications: string[];
  riskLevel: "low" | "moderate" | "elevated" | "high" | "extreme";
}

/**
 * Classify the current market regime.
 *
 * @param vix - current VIX level
 * @param spyPrices - SPY historical prices (at least 200 trading days)
 */
export function classifyMarketRegime(
  vix: number,
  spyPrices: HistoricalPricePoint[],
): RegimeResult {
  // Compute 200-day SMA
  const sma200 = computeSMA(spyPrices, 200);
  const currentPrice = spyPrices[spyPrices.length - 1]?.adjustedClose ?? 0;

  // Compute 30-day realized vol
  const realizedVol30 = computeRealizedVol(spyPrices, 30);

  // Determine trend
  let spyTrend: "up" | "down" | "flat";
  let spyAbove200sma: boolean;

  if (sma200 != null && currentPrice > 0) {
    spyAbove200sma = currentPrice > sma200;
    const pctAbove = (currentPrice - sma200) / sma200;
    if (pctAbove > 0.02) spyTrend = "up";
    else if (pctAbove < -0.02) spyTrend = "down";
    else spyTrend = "flat";
  } else {
    spyAbove200sma = true;
    spyTrend = "flat";
  }

  // Classify regime
  let regime: MarketRegime;
  let description: string;
  let riskLevel: RegimeResult["riskLevel"];
  const strategyImplications: string[] = [];

  if (vix > 30) {
    regime = "CRISIS";
    description = "Crisis regime: elevated fear, high volatility. Defensive positioning recommended.";
    riskLevel = "extreme";
    strategyImplications.push("Consider buying protective puts or reducing position sizes.");
    strategyImplications.push("Credit spreads may offer attractive risk/reward but assignment risk is elevated.");
    strategyImplications.push("Avoid selling naked options — tail risk is high.");
    strategyImplications.push("Iron condors with wider wings can capture elevated premium.");
  } else if (vix >= 15) {
    riskLevel = "elevated";
    if (spyTrend === "up") {
      regime = "HIGH_VOL_BULL";
      description = "High-volatility bull market: uptrend with elevated volatility.";
      strategyImplications.push("Covered calls benefit from higher premium but cap upside.");
      strategyImplications.push("Cash-secured puts can capture elevated IV with downside protection.");
    } else if (spyTrend === "down") {
      regime = "HIGH_VOL_BEAR";
      description = "High-volatility bear market: downtrend with elevated volatility.";
      riskLevel = "high";
      strategyImplications.push("Defensive: favor cash-secured puts at lower strikes for entry.");
      strategyImplications.push("Avoid covered calls unless willing to sell shares at strike.");
      strategyImplications.push("Bear call spreads can capitalize on downward drift.");
    } else {
      regime = "HIGH_VOL_SIDEWAYS";
      description = "High-volatility sideways market: range-bound with elevated volatility.";
      strategyImplications.push("Iron condors and strangles benefit from elevated IV and range-bound price action.");
      strategyImplications.push("Consider selling premium at support/resistance levels.");
    }
  } else {
    riskLevel = "moderate";
    if (spyTrend === "up") {
      regime = "LOW_VOL_BULL";
      description = "Low-volatility bull market: steady uptrend with low volatility.";
      riskLevel = "low";
      strategyImplications.push("Covered calls for steady income, but premium will be lower.");
      strategyImplications.push("Consider LEAPS or diagonals to leverage low vol.");
      strategyImplications.push("Wheel strategy works well in this regime.");
    } else if (spyTrend === "down") {
      regime = "LOW_VOL_BEAR";
      description = "Low-volatility bear market: downtrend with compressed volatility.";
      riskLevel = "high";
      strategyImplications.push("Be cautious — low VIX in a downtrend can signal complacency.");
      strategyImplications.push("Cash-secured puts at support levels for potential entry.");
    } else {
      regime = "LOW_VOL_SIDEWAYS";
      description = "Low-volatility sideways market: range-bound with low volatility.";
      strategyImplications.push("Premium is thin — consider wider spreads or longer DTE.");
      strategyImplications.push("Calendar spreads can benefit from vol expansion.");
    }
  }

  return {
    regime,
    vix,
    spyTrend,
    spyAbove200sma,
    realizedVol30,
    description,
    strategyImplications,
    riskLevel,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeSMA(prices: HistoricalPricePoint[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  const sum = slice.reduce((s, p) => s + p.adjustedClose, 0);
  return sum / period;
}

function computeRealizedVol(prices: HistoricalPricePoint[], window: number): number {
  if (prices.length < window + 1) return 0;
  const slice = prices.slice(-window - 1);
  const logReturns: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    const prev = slice[i - 1];
    const curr = slice[i];
    if (!prev || !curr) continue;
    const r = Math.log(curr.adjustedClose / prev.adjustedClose);
    if (Number.isFinite(r)) logReturns.push(r);
  }
  if (logReturns.length < 2) return 0;
  const mean = logReturns.reduce((s, r) => s + r, 0) / logReturns.length;
  const variance = logReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (logReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}
