/**
 * Point-in-time factor extraction.
 *
 * THE CRITICAL INVARIANT: every feature at bar `i` is computed using ONLY bars
 * 0..i. Nothing may peek at future data. Lookahead bias is the fastest way to
 * produce a backtest that looks spectacular and loses money live, so the
 * `extractFeaturesAt` signature deliberately takes an index and slices behind it
 * rather than receiving a pre-computed indicator array.
 *
 * The factors here are deliberately well-known and academically documented
 * (momentum, trend, mean reversion, volatility, volume). They are NOT secret
 * alpha - published factors are heavily arbitraged and their historical premia
 * have decayed substantially since roughly 2010. Their value in this tool is as
 * transparent, auditable inputs to a signal you can validate, not as a promise
 * of returns.
 *
 * All functions are PURE and DETERMINISTIC. Unit-tested in ./features.test.ts.
 */

import type { HistoricalPricePoint } from "@/lib/types";

/** Longest lookback any feature needs. Bars before this cannot be scored. */
export const MIN_HISTORY_BARS = 252;

export interface FeatureVector {
  /** Index in the source series these features describe. */
  index: number;
  date: string;
  close: number;

  // --- Momentum: cumulative return over trailing windows -------------------
  momentum1m: number | null;
  momentum3m: number | null;
  momentum6m: number | null;
  momentum12m: number | null;

  // --- Trend ---------------------------------------------------------------
  /** Close divided by its 50-bar simple moving average, minus 1. */
  priceVsSma50: number | null;
  /** Close divided by its 200-bar simple moving average, minus 1. */
  priceVsSma200: number | null;
  /** Slope of the 50-bar SMA over the last 20 bars, normalized by price. */
  sma50Slope: number | null;
  /** True when SMA50 sits above SMA200 (a "golden cross" state). */
  goldenCross: boolean | null;

  // --- Mean reversion ------------------------------------------------------
  /** Standard deviations the close sits from its 20-bar mean. */
  zScore20: number | null;
  /** Wilder RSI over 14 bars, 0-100. */
  rsi14: number | null;

  // --- Volatility ----------------------------------------------------------
  /** Annualized realized volatility over 20 bars. */
  realizedVol20: number | null;
  /** Annualized realized volatility over 60 bars. */
  realizedVol60: number | null;
  /** realizedVol20 / realizedVol60. Above 1 means vol is expanding. */
  volRatio: number | null;
  /** Average true range over 14 bars, as a fraction of close. */
  atrPercent: number | null;

  // --- Volume --------------------------------------------------------------
  /** Standard deviations today's volume sits from its 20-bar mean. */
  volumeZScore: number | null;

  // --- Distribution shape --------------------------------------------------
  /** Skewness of the trailing 60 daily log returns. */
  returnSkew60: number | null;
}

/**
 * Extract every factor for a single bar using only history up to and including
 * that bar.
 *
 * Returns null when there is not enough history behind `index` to compute the
 * longest-lookback feature reliably.
 */
export function extractFeaturesAt(
  prices: HistoricalPricePoint[],
  index: number,
): FeatureVector | null {
  if (index < 0 || index >= prices.length) return null;
  const bar = prices[index];
  if (!bar) return null;

  // Inclusive window of everything visible at this bar.
  const visible = prices.slice(0, index + 1);
  if (visible.length < 21) return null;

  const closes = visible.map((p) => p.adjustedClose);
  const close = bar.adjustedClose;

  const logReturns = toLogReturns(closes);

  const sma50 = mean(tail(closes, 50));
  const sma200 = mean(tail(closes, 200));

  return {
    index,
    date: bar.date,
    close,

    momentum1m: trailingReturn(closes, 21),
    momentum3m: trailingReturn(closes, 63),
    momentum6m: trailingReturn(closes, 126),
    momentum12m: trailingReturn(closes, 252),

    priceVsSma50: sma50 != null && sma50 > 0 ? close / sma50 - 1 : null,
    priceVsSma200: sma200 != null && sma200 > 0 ? close / sma200 - 1 : null,
    sma50Slope: smaSlope(closes, 50, 20),
    goldenCross: sma50 != null && sma200 != null ? sma50 > sma200 : null,

    zScore20: zScore(closes, 20),
    rsi14: wilderRsi(closes, 14),

    realizedVol20: annualizedVol(logReturns, 20),
    realizedVol60: annualizedVol(logReturns, 60),
    volRatio: volExpansionRatio(logReturns),
    atrPercent: atrPercent(visible, 14),

    volumeZScore: volumeZScore(visible, 20),

    returnSkew60: skewness(tail(logReturns, 60)),
  };
}

/**
 * Extract features for every bar that has sufficient history.
 *
 * `fromIndex` defaults to MIN_HISTORY_BARS so the longest-lookback factors are
 * populated. Lower it only if you accept nulls in the long-window features.
 */
export function extractFeatureSeries(
  prices: HistoricalPricePoint[],
  fromIndex: number = MIN_HISTORY_BARS,
): FeatureVector[] {
  const out: FeatureVector[] = [];
  for (let i = Math.max(fromIndex, 0); i < prices.length; i++) {
    const f = extractFeaturesAt(prices, i);
    if (f) out.push(f);
  }
  return out;
}

/**
 * Forward return from `index` over `horizon` bars.
 *
 * This is the LABEL, not a feature. It looks into the future by definition and
 * must never be fed into a feature vector - only used as the training target
 * and only for bars whose future is already inside the training window.
 */
export function forwardReturn(
  prices: HistoricalPricePoint[],
  index: number,
  horizon: number,
): number | null {
  const from = prices[index];
  const to = prices[index + horizon];
  if (!from || !to || from.adjustedClose <= 0) return null;
  return to.adjustedClose / from.adjustedClose - 1;
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function tail<T>(arr: T[], n: number): T[] {
  return n >= arr.length ? arr.slice() : arr.slice(arr.length - n);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values);
  if (m == null) return null;
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function toLogReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const curr = closes[i];
    if (prev == null || curr == null || prev <= 0 || curr <= 0) continue;
    const r = Math.log(curr / prev);
    if (Number.isFinite(r)) out.push(r);
  }
  return out;
}

/** Simple return over the trailing `lookback` bars. */
function trailingReturn(closes: number[], lookback: number): number | null {
  if (closes.length <= lookback) return null;
  const now = closes[closes.length - 1];
  const then = closes[closes.length - 1 - lookback];
  if (now == null || then == null || then <= 0) return null;
  return now / then - 1;
}

/** Change in the SMA over `slopeWindow` bars, expressed as a fraction of price. */
function smaSlope(closes: number[], period: number, slopeWindow: number): number | null {
  if (closes.length < period + slopeWindow) return null;
  const nowWindow = tail(closes, period);
  const thenWindow = closes.slice(closes.length - period - slopeWindow, closes.length - slopeWindow);
  const smaNow = mean(nowWindow);
  const smaThen = mean(thenWindow);
  if (smaNow == null || smaThen == null || smaThen <= 0) return null;
  return (smaNow - smaThen) / smaThen;
}

function zScore(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const window = tail(closes, period);
  const m = mean(window);
  const sd = stdDev(window);
  const now = closes[closes.length - 1];
  if (m == null || sd == null || sd === 0 || now == null) return null;
  return (now - m) / sd;
}

/**
 * Wilder's RSI. Uses a simple average for the first `period` changes then
 * Wilder smoothing, which is the standard formulation.
 */
function wilderRsi(closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null;

  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const curr = closes[i];
    if (prev == null || curr == null) continue;
    changes.push(curr - prev);
  }
  if (changes.length < period) return null;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    const c = changes[i] ?? 0;
    if (c > 0) avgGain += c;
    else avgLoss -= c;
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < changes.length; i++) {
    const c = changes[i] ?? 0;
    const gain = c > 0 ? c : 0;
    const loss = c < 0 ? -c : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function annualizedVol(logReturns: number[], period: number): number | null {
  if (logReturns.length < period) return null;
  const sd = stdDev(tail(logReturns, period));
  if (sd == null) return null;
  return sd * Math.sqrt(252);
}

function volExpansionRatio(logReturns: number[]): number | null {
  const short = annualizedVol(logReturns, 20);
  const long = annualizedVol(logReturns, 60);
  if (short == null || long == null || long === 0) return null;
  return short / long;
}

/** Average true range as a fraction of the latest close. */
function atrPercent(bars: HistoricalPricePoint[], period: number): number | null {
  if (bars.length < period + 1) return null;

  const trueRanges: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1];
    const curr = bars[i];
    if (!prev || !curr) continue;
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close),
    );
    if (Number.isFinite(tr)) trueRanges.push(tr);
  }
  if (trueRanges.length < period) return null;

  const atr = mean(tail(trueRanges, period));
  const close = bars[bars.length - 1]?.adjustedClose;
  if (atr == null || close == null || close <= 0) return null;
  return atr / close;
}

function volumeZScore(bars: HistoricalPricePoint[], period: number): number | null {
  if (bars.length < period) return null;
  const volumes = tail(bars, period)
    .map((b) => b.volume)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (volumes.length < period) return null;

  const m = mean(volumes);
  const sd = stdDev(volumes);
  const now = bars[bars.length - 1]?.volume;
  if (m == null || sd == null || sd === 0 || now == null) return null;
  return (now - m) / sd;
}

function skewness(values: number[]): number | null {
  if (values.length < 3) return null;
  const m = mean(values);
  if (m == null) return null;
  const n = values.length;
  const m2 = values.reduce((s, v) => s + (v - m) ** 2, 0) / n;
  const m3 = values.reduce((s, v) => s + (v - m) ** 3, 0) / n;
  if (m2 <= 0) return null;
  return m3 / Math.pow(m2, 1.5);
}
