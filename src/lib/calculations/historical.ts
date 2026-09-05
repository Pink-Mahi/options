/**
 * Historical analytics: returns, volatility, drawdowns, moving averages,
 * rolling return distributions, IV context.
 *
 * Pure & deterministic given a price series. Unit-tested.
 *
 * IMPORTANT: All outputs are historical descriptions, NOT predictions.
 * The UI must label them as such.
 */

import type {
  HistoricalPricePoint,
  HistoricalReturns,
  ImpliedVolatilityContext,
  MovingAverage,
  RollingReturnDistribution,
} from "@/lib/types";

/** Return over N calendar days from a price series: (end/start) - 1. */
export function returnOverDays(
  points: HistoricalPricePoint[],
  days: number,
): number | null {
  if (points.length < 2) return null;
  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end) return null;
  const actualDays =
    (new Date(end.date).getTime() - new Date(start.date).getTime()) /
    (1000 * 60 * 60 * 24);
  // Only return if the series roughly covers the requested window.
  if (actualDays < days * 0.8) return null;
  if (start.adjustedClose === 0) return null;
  return end.adjustedClose / start.adjustedClose - 1;
}

/**
 * Annualized volatility from daily log returns.
 * sigma_annual = sigma_daily * sqrt(252)
 */
export function annualizedVolatility(points: HistoricalPricePoint[]): number | null {
  const returns = dailyLogReturns(points);
  if (returns.length < 2) return null;
  const mean = meanOf(returns);
  const variance =
    returns.reduce((acc, r) => acc + Math.pow(r - mean, 2), 0) /
    (returns.length - 1);
  const dailyStd = Math.sqrt(variance);
  return dailyStd * Math.sqrt(252);
}

export function dailyLogReturns(points: HistoricalPricePoint[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (!prev || !curr) continue;
    if (prev.adjustedClose > 0 && curr.adjustedClose > 0) {
      out.push(Math.log(curr.adjustedClose / prev.adjustedClose));
    }
  }
  return out;
}

/** Maximum drawdown over the series (as a negative fraction, e.g. -0.42). */
export function maxDrawdown(points: HistoricalPricePoint[]): number | null {
  if (points.length < 2) return null;
  let peak = points[0]?.adjustedClose ?? 0;
  let maxDd = 0;
  for (const p of points) {
    if (p.adjustedClose > peak) peak = p.adjustedClose;
    if (peak > 0) {
      const dd = p.adjustedClose / peak - 1;
      if (dd < maxDd) maxDd = dd;
    }
  }
  return maxDd === 0 ? 0 : maxDd;
}

/** Simple moving average over the last N closes. */
export function movingAverage(
  points: HistoricalPricePoint[],
  period: number,
): MovingAverage | null {
  if (points.length < period) return null;
  const slice = points.slice(points.length - period);
  const sum = slice.reduce((acc, p) => acc + p.adjustedClose, 0);
  const value = sum / period;
  const last = points[points.length - 1];
  return {
    period,
    value,
    priceAbove: last != null ? last.adjustedClose >= value : false,
  };
}

export function calculateHistoricalReturns(
  points: HistoricalPricePoint[],
): HistoricalReturns {
  const sorted = [...points].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const last = sorted[sorted.length - 1];
  const close = last?.adjustedClose ?? null;

  const sliceEnding = (days: number) => {
    if (sorted.length === 0) return null;
    const end = sorted[sorted.length - 1];
    if (!end) return null;
    const targetMs = new Date(end.date).getTime() - days * 86400000;
    // find earliest point within the window
    let startIdx = -1;
    for (let i = 0; i < sorted.length; i++) {
      if (new Date(sorted[i]!.date).getTime() >= targetMs) {
        startIdx = i;
        break;
      }
    }
    if (startIdx <= 0) return null;
    return { start: sorted[startIdx]!, end };
  };

  const ret = (days: number) => {
    const s = sliceEnding(days);
    if (!s || !s.start || s.start.adjustedClose === 0) return null;
    return s.end.adjustedClose / s.start.adjustedClose - 1;
  };

  // 52-week range
  const yearPoints = sorted.slice(Math.max(0, sorted.length - 252));
  const high52 = yearPoints.length ? Math.max(...yearPoints.map((p) => p.adjustedClose)) : null;
  const low52 = yearPoints.length ? Math.min(...yearPoints.map((p) => p.adjustedClose)) : null;

  return {
    oneMonthReturn: ret(30),
    threeMonthReturn: ret(91),
    sixMonthReturn: ret(182),
    oneYearReturn: ret(365),
    threeYearReturn: ret(365 * 3),
    fiveYearReturn: ret(365 * 5),
    annualizedVolatility: annualizedVolatility(sorted),
    maxDrawdown: maxDrawdown(sorted),
    avgMonthlyReturn: avgPeriodReturn(sorted, 21),
    avgAnnualReturn: avgPeriodReturn(sorted, 252),
    high52Week: high52,
    low52Week: low52,
    distanceFrom52WeekHigh:
      high52 != null && close != null && high52 > 0 ? close / high52 - 1 : null,
    distanceFrom52WeekLow:
      low52 != null && close != null && low52 > 0 ? close / low52 - 1 : null,
  };
}

/** Average return over rolling windows of `period` days. */
export function avgPeriodReturn(
  points: HistoricalPricePoint[],
  period: number,
): number | null {
  if (points.length < period + 1) return null;
  const returns: number[] = [];
  for (let i = period; i < points.length; i++) {
    const prev = points[i - period];
    const curr = points[i];
    if (!prev || !curr || prev.adjustedClose === 0) continue;
    returns.push(curr.adjustedClose / prev.adjustedClose - 1);
  }
  if (returns.length === 0) return null;
  return meanOf(returns);
}

/**
 * Rolling return distribution for a window of `windowDays` calendar days.
 * Returns percentiles and the fraction of windows that exceeded `thresholdReturn`
 * (e.g. the strike appreciation). Also fraction declining below break-even
 * (thresholdReturn < 0 means a loss threshold).
 */
export function rollingReturnDistribution(
  points: HistoricalPricePoint[],
  windowDays: number,
  thresholdReturn: number,
): RollingReturnDistribution | null {
  if (points.length < 2) return null;
  const sorted = [...points].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  // Build rolling windows by calendar days.
  const returns: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    if (!start) continue;
    const targetMs = new Date(start.date).getTime() + windowDays * 86400000;
    // find the first point at or after target
    let endIdx = -1;
    for (let j = i + 1; j < sorted.length; j++) {
      if (new Date(sorted[j]!.date).getTime() >= targetMs) {
        endIdx = j;
        break;
      }
    }
    if (endIdx === -1) continue;
    const end = sorted[endIdx];
    if (!end || start.adjustedClose === 0) continue;
    returns.push(end.adjustedClose / start.adjustedClose - 1);
  }

  if (returns.length < 5) return null;

  const sortedR = [...returns].sort((a, b) => a - b);
  const pct = (p: number) => percentile(sortedR, p);
  const percentExceeding = returns.filter((r) => r > thresholdReturn).length / returns.length;
  const percentDeclining = returns.filter((r) => r < thresholdReturn).length / returns.length;

  return {
    windowDays,
    sampleSize: returns.length,
    median: pct(0.5),
    mean: meanOf(returns),
    stdDev: stdDevOf(returns),
    p10: pct(0.1),
    p25: pct(0.25),
    p50: pct(0.5),
    p75: pct(0.75),
    p90: pct(0.9),
    percentExceedingThreshold: percentExceeding,
    percentDecliningBelowBreakEven: percentDeclining,
  };
}

// ---------------------------------------------------------------------------
// Risk-adjusted returns: Sharpe and Sortino ratios.
// ---------------------------------------------------------------------------

export interface RiskAdjustedReturns {
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  calmarRatio: number | null;
  annualizedReturn: number;
  annualizedVolatility: number;
  downsideDeviation: number | null;
  maxDrawdown: number;
  riskFreeRate: number;
  warnings: string[];
}

/**
 * Compute Sharpe, Sortino, and Calmar ratios from a price series.
 *
 * Sharpe = (annualizedReturn - riskFreeRate) / annualizedVolatility
 * Sortino = (annualizedReturn - riskFreeRate) / downsideDeviation
 * Calmar = annualizedReturn / |maxDrawdown|
 *
 * @param riskFreeRate Annualized risk-free rate (default 4.5% = current T-bill approx)
 */
export function calculateRiskAdjustedReturns(
  points: HistoricalPricePoint[],
  riskFreeRate = 0.045,
): RiskAdjustedReturns {
  const warnings: string[] = [];
  if (points.length < 60) {
    warnings.push("Insufficient history for risk-adjusted returns (need 60+ days).");
  }

  const dailyReturns: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const cur = points[i];
    const prev = points[i - 1];
    if (!cur || !prev) continue;
    const r = Math.log(cur.adjustedClose / prev.adjustedClose);
    if (Number.isFinite(r)) dailyReturns.push(r);
  }

  if (dailyReturns.length < 30) {
    return {
      sharpeRatio: null,
      sortinoRatio: null,
      calmarRatio: null,
      annualizedReturn: 0,
      annualizedVolatility: 0,
      downsideDeviation: null,
      maxDrawdown: 0,
      riskFreeRate,
      warnings: [...warnings, "Not enough valid return observations."],
    };
  }

  const meanDaily = mean(dailyReturns);
  const variance = dailyReturns.reduce((s, r) => s + (r - meanDaily) ** 2, 0) / (dailyReturns.length - 1);
  const stdDaily = Math.sqrt(variance);
  const annualizedVolatility = stdDaily * Math.sqrt(252);
  const annualizedReturn = Math.exp(meanDaily * 252) - 1;

  // Downside deviation (only negative returns). Use sample variance for consistency.
  const downsideReturns = dailyReturns.filter((r) => r < 0);
  const downsideVariance = downsideReturns.length > 1
    ? downsideReturns.reduce((s, r) => s + r * r, 0) / (downsideReturns.length - 1)
    : 0;
  const downsideDeviation = Math.sqrt(downsideVariance) * Math.sqrt(252);

  // Max drawdown.
  let peak = points[0]?.adjustedClose ?? 0;
  let maxDd = 0;
  for (const p of points) {
    if (!p) continue;
    if (p.adjustedClose > peak) peak = p.adjustedClose;
    const dd = (p.adjustedClose - peak) / peak;
    if (dd < maxDd) maxDd = dd;
  }

  const sharpeRatio = annualizedVolatility > 0
    ? (annualizedReturn - riskFreeRate) / annualizedVolatility
    : null;
  const sortinoRatio = downsideDeviation > 0
    ? (annualizedReturn - riskFreeRate) / downsideDeviation
    : null;
  const calmarRatio = maxDd < 0 ? annualizedReturn / Math.abs(maxDd) : null;

  return {
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    annualizedReturn,
    annualizedVolatility,
    downsideDeviation,
    maxDrawdown: maxDd,
    riskFreeRate,
    warnings,
  };
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo] ?? 0;
  const frac = idx - lo;
  const a = sortedAsc[lo] ?? 0;
  const b = sortedAsc[hi] ?? 0;
  return a + (b - a) * frac;
}

export function meanOf(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stdDevOf(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = meanOf(xs);
  const v = xs.reduce((a, b) => a + Math.pow(b - m, 2), 0) / (xs.length - 1);
  return Math.sqrt(v);
}

/**
 * IV percentile & rank from a series of historical IV readings.
 * IV percentile = % of past readings below current IV.
 * IV rank = (currentIV - lowIV) / (highIV - lowIV).
 */
export function impliedVolatilityContext(
  historicalIvs: number[],
  currentIv: number | null,
  hv30: number | null,
  hv90: number | null,
  hv1Year: number | null,
): ImpliedVolatilityContext {
  if (currentIv == null || historicalIvs.length === 0) {
    return {
      currentIv,
      ivPercentile: null,
      ivRank: null,
      hv30,
      hv90,
      hv1Year,
      ivRealizedSpread: null,
    };
  }
  const below = historicalIvs.filter((v) => v < currentIv).length;
  const ivPercentile = below / historicalIvs.length;
  const high = Math.max(...historicalIvs);
  const low = Math.min(...historicalIvs);
  const ivRank = high === low ? 0.5 : (currentIv - low) / (high - low);
  const ivRealizedSpread =
    hv1Year != null ? currentIv - hv1Year : null;
  return {
    currentIv,
    ivPercentile,
    ivRank,
    hv30,
    hv90,
    hv1Year,
    ivRealizedSpread,
  };
}

/** Historical volatility over the last N trading days (annualized). */
export function historicalVolatility(
  points: HistoricalPricePoint[],
  days: number,
): number | null {
  if (points.length < days + 1) return null;
  const slice = points.slice(points.length - (days + 1));
  const vol = annualizedVolatility(slice);
  return vol;
}

export interface AssignmentProbability {
  /** Percentage of rolling historical windows where stock finished above strike. */
  historicalProbability: number | null;
  /** Lognormal Monte Carlo estimate using historical volatility. */
  monteCarloProbability: number | null;
  /** Option delta used as a market-implied probability proxy. */
  deltaProxy: number | null;
  /** Average of historical and MC, fallback to delta, or null if all unavailable. */
  compositeProbability: number | null;
  sampleSize: number;
  warnings: string[];
}

/**
 * Estimate the probability that the stock finishes above `strike` at `dte` days.
 *
 * Combines three inputs:
 * 1. Historical: rolling windows of `dte` calendar days, % ending above strike.
 * 2. Monte Carlo: lognormal bootstrap of daily returns with historical volatility.
 * 3. Delta: the option's delta, which is the market's risk-neutral probability proxy.
 *
 * This is NOT a prediction — it is a historical/model estimate only.
 */
export function calculateAssignmentProbability(
  points: HistoricalPricePoint[],
  dte: number,
  currentPrice: number,
  strike: number,
  delta: number | null,
): AssignmentProbability {
  const warnings: string[] = [];
  if (points.length < 30) {
    warnings.push("Insufficient history for assignment probability (need 30+ days).");
    return { historicalProbability: null, monteCarloProbability: null, deltaProxy: delta, compositeProbability: delta, sampleSize: 0, warnings };
  }

  const thresholdReturn = currentPrice > 0 ? (strike - currentPrice) / currentPrice : 0;

  // 1. Historical rolling probability.
  const dist = rollingReturnDistribution(points, dte, thresholdReturn);
  const historicalProbability = dist != null ? dist.percentExceedingThreshold : null;
  const sampleSize = dist?.sampleSize ?? 0;

  // 2. Lognormal MC estimate.
  let monteCarloProbability: number | null = null;
  const vol = annualizedVolatility(points);
  const dailyLog = dailyLogReturns(points);
  if (vol != null && vol > 0 && dailyLog.length > 1 && currentPrice > 0 && strike > 0) {
    const meanDaily = meanOf(dailyLog);
    const T = dte / 252; // business-day years approximation
    const sigmaT = vol * Math.sqrt(T);
    const muT = meanDaily * 252 * T - 0.5 * sigmaT * sigmaT;
    const d2 = (Math.log(currentPrice / strike) + muT) / (sigmaT || 1e-9);
    monteCarloProbability = normalCDF(d2);
  }

  // 3. Composite.
  let compositeProbability: number | null = null;
  if (historicalProbability != null && monteCarloProbability != null) {
    // Weight historical a bit more when sample size is large.
    const histWeight = Math.min(0.7, 0.4 + sampleSize / 500);
    compositeProbability = historicalProbability * histWeight + monteCarloProbability * (1 - histWeight);
  } else if (historicalProbability != null) {
    compositeProbability = historicalProbability;
  } else if (monteCarloProbability != null) {
    compositeProbability = monteCarloProbability;
  } else if (delta != null && delta > 0) {
    compositeProbability = delta;
  }

  return { historicalProbability, monteCarloProbability, deltaProxy: delta, compositeProbability, sampleSize, warnings };
}

/** Standard normal cumulative distribution function. */
function normalCDF(x: number): number {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * a);
  const d = 0.3989423 * Math.exp((-a * a) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return s > 0 ? 1 - p : p;
}
