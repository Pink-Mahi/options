/**
 * Implied volatility analytics + expected move.
 *
 * IV percentile: where the current ATM IV sits relative to the last 252
 * trading days of ATM IV (estimated from historical volatility as a proxy
 * when per-day IV history is unavailable from the provider).
 *
 * IV rank: (currentIV - lowIV) / (highIV - lowIV) over the lookback.
 *
 * Expected move: derived from ATM IV and DTE using the lognormal approximation:
 *   expectedMove ≈ S * IV * sqrt(DTE/365)
 * This is a model-implied 1-standard-deviation move, NOT a prediction.
 *
 * All functions are deterministic and unit-tested.
 */

import type { OptionChain, HistoricalPricePoint } from "@/lib/types";

export interface IVAnalytics {
  currentAtmIv: number | null;
  ivPercentile: number | null; // 0-1
  ivRank: number | null; // 0-1
  ivHistory: { date: string; iv: number }[];
  expectedMove: {
    oneStdDev: number; // dollars
    oneStdDevPercent: number; // fraction of spot
    upper1sd: number;
    lower1sd: number;
    dte: number;
    note: string;
  } | null;
  warnings: string[];
}

/**
 * Approximate per-day ATM IV using rolling 30-day historical volatility when
 * the provider does not expose per-day IV history. This is a documented
 * approximation — the UI labels it clearly.
 */
export function computeIVAnalytics(
  chain: OptionChain,
  historical: HistoricalPricePoint[],
  lookbackDays = 252,
): IVAnalytics {
  const warnings: string[] = [];
  const spot = chain.underlyingPrice;

  // Current ATM IV: pick the call (or put) closest to spot.
  const atm = findAtm(chain);
  const currentAtmIv = atm?.impliedVolatility ?? null;

  // Approximate IV history from rolling 30-day realized vol.
  const ivHistory: { date: string; iv: number }[] = [];
  const window = 30;
  for (let i = window; i < historical.length; i++) {
    const slice = historical.slice(i - window, i);
    const hv = realizedVol(slice);
    const point = historical[i];
    if (Number.isFinite(hv) && point) {
      ivHistory.push({ date: point.date, iv: hv });
    }
  }

  const trimmed = ivHistory.slice(-lookbackDays);
  let ivPercentile: number | null = null;
  let ivRank: number | null = null;
  if (currentAtmIv != null && trimmed.length >= 20) {
    const below = trimmed.filter((h) => h.iv < currentAtmIv).length;
    ivPercentile = below / trimmed.length;
    const ivs = trimmed.map((h) => h.iv);
    const high = Math.max(...ivs);
    const low = Math.min(...ivs);
    ivRank = high === low ? 0.5 : (currentAtmIv - low) / (high - low);
  } else if (currentAtmIv != null) {
    warnings.push("Insufficient history for IV percentile/rank (need 20+ days).");
  }

  // Expected move from ATM IV and DTE.
  let expectedMove: IVAnalytics["expectedMove"] = null;
  if (currentAtmIv != null && atm) {
    const dte = atm.daysToExpiration;
    const oneStdDev = spot * currentAtmIv * Math.sqrt(dte / 365);
    expectedMove = {
      oneStdDev,
      oneStdDevPercent: oneStdDev / spot,
      upper1sd: spot + oneStdDev,
      lower1sd: spot - oneStdDev,
      dte,
      note: `1 standard deviation move over ${dte} days, implied by ATM IV. ~68% probability band under lognormal model. NOT a prediction.`,
    };
  }

  return { currentAtmIv, ivPercentile, ivRank, ivHistory: trimmed, expectedMove, warnings };
}

function findAtm(chain: OptionChain) {
  const spot = chain.underlyingPrice;
  const all = [...chain.calls, ...chain.puts];
  if (all.length === 0) return null;
  let best = all[0];
  let bestDist = Infinity;
  for (const c of all) {
    const d = Math.abs(c.strike - spot);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

function realizedVol(slice: HistoricalPricePoint[]): number {
  if (slice.length < 2) return NaN;
  const logReturns: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    const cur = slice[i];
    const prev = slice[i - 1];
    if (!cur || !prev) continue;
    const r = Math.log(cur.adjustedClose / prev.adjustedClose);
    if (Number.isFinite(r)) logReturns.push(r);
  }
  if (logReturns.length < 2) return NaN;
  const mean = logReturns.reduce((s, r) => s + r, 0) / logReturns.length;
  const variance = logReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (logReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}
