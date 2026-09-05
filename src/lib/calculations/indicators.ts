/**
 * Technical indicators library.
 *
 * All functions are pure and deterministic given a price series.
 * Unit-tested. No external dependencies.
 *
 * Indicators implemented:
 *   - RSI (Relative Strength Index)
 *   - MACD (Moving Average Convergence Divergence)
 *   - Bollinger Bands
 *   - Stochastic Oscillator
 *   - ATR (Average True Range)
 *   - OBV (On-Balance Volume)
 *   - ADX (Average Directional Index)
 *   - VWAP (Volume-Weighted Average Price)
 *   - Ichimoku Cloud
 *   - Parabolic SAR
 *   - EMA (Exponential Moving Average) — used by MACD and others
 *   - SMA (Simple Moving Average) series
 *
 * IMPORTANT: These are mathematical descriptions of historical data.
 * They do NOT predict the future. The AI analysis layer uses them as
 * inputs for pattern recognition, clearly labeled as probabilistic.
 */

import type { HistoricalPricePoint } from "@/lib/types";

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

export function smaSeries(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j] ?? 0;
    result.push(sum / period);
  }
  return result;
}

export function emaSeries(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) {
      result.push(null);
      continue;
    }
    if (prev == null) {
      // Seed with SMA of first `period` values.
      if (i >= period - 1) {
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += values[j] ?? 0;
        prev = sum / period;
        result.push(prev);
      } else {
        result.push(null);
      }
    } else {
      prev = v * k + prev * (1 - k);
      result.push(prev);
    }
  }
  return result;
}

function trueRange(prev: HistoricalPricePoint | undefined, cur: HistoricalPricePoint): number {
  if (!prev) return cur.high - cur.low;
  return Math.max(
    cur.high - cur.low,
    Math.abs(cur.high - prev.close),
    Math.abs(cur.low - prev.close),
  );
}

// ---------------------------------------------------------------------------
// RSI (Relative Strength Index)
// ---------------------------------------------------------------------------

export interface RSIResult {
  values: (number | null)[];
  current: number | null;
  overbought: boolean; // > 70
  oversold: boolean; // < 30
  signal: "overbought" | "oversold" | "neutral";
}

export function computeRSI(points: HistoricalPricePoint[], period = 14): RSIResult {
  const values: (number | null)[] = [];
  if (points.length < period + 1) {
    return { values: points.map(() => null), current: null, overbought: false, oversold: false, signal: "neutral" };
  }

  let avgGain = 0;
  let avgLoss = 0;

  // Initial averages (Wilder's smoothing uses simple average for the first period).
  let validCount = 0;
  for (let i = 1; i <= period; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    if (!prev || !cur) continue;
    validCount++;
    const change = cur.close - prev.close;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  // Divide by the actual number of valid changes, not the requested period.
  // If there are no valid changes, RSI is undefined.
  if (validCount === 0) {
    return { values: points.map(() => null), current: null, overbought: false, oversold: false, signal: "neutral" };
  }
  avgGain /= validCount;
  avgLoss /= validCount;

  values.push(...Array(period).fill(null));

  // First RSI value.
  const rs1 = avgLoss === 0 ? 100 : avgGain / avgLoss;
  values.push(100 - 100 / (1 + rs1));

  // Subsequent values using Wilder's smoothing.
  for (let i = period + 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    if (!prev || !cur) {
      values.push(null);
      continue;
    }
    const change = cur.close - prev.close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    values.push(100 - 100 / (1 + rs));
  }

  const current = values[values.length - 1] ?? null;
  return {
    values,
    current,
    overbought: current != null && current > 70,
    oversold: current != null && current < 30,
    signal: current == null ? "neutral" : current > 70 ? "overbought" : current < 30 ? "oversold" : "neutral",
  };
}

// ---------------------------------------------------------------------------
// MACD (Moving Average Convergence Divergence)
// ---------------------------------------------------------------------------

export interface MACDResult {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
  current: { macd: number | null; signal: number | null; histogram: number | null };
  crossover: "bullish" | "bearish" | "none";
}

export function computeMACD(points: HistoricalPricePoint[], fast = 12, slow = 26, signalPeriod = 9): MACDResult {
  const closes = points.map((p) => p.close);
  const fastEma = emaSeries(closes, fast);
  const slowEma = emaSeries(closes, slow);

  const macdLine: (number | null)[] = closes.map((_, i) => {
    const f = fastEma[i];
    const s = slowEma[i];
    return f != null && s != null ? f - s : null;
  });

  // Signal line = EMA of MACD line.
  const macdValues = macdLine.map((v) => v ?? 0);
  const signalLine = emaSeries(macdValues, signalPeriod);

  const histogram: (number | null)[] = macdLine.map((m, i) => {
    const s = signalLine[i];
    return m != null && s != null ? m - s : null;
  });

  const currentMacd = macdLine[macdLine.length - 1] ?? null;
  const currentSignal = signalLine[signalLine.length - 1] ?? null;
  const currentHist = histogram[histogram.length - 1] ?? null;

  // Detect crossover in last 2 bars.
  let crossover: "bullish" | "bearish" | "none" = "none";
  if (macdLine.length >= 2) {
    const prevMacd = macdLine[macdLine.length - 2];
    const prevSignal = signalLine[signalLine.length - 2];
    const curMacd = macdLine[macdLine.length - 1];
    const curSignal = signalLine[signalLine.length - 1];
    if (prevMacd != null && prevSignal != null && curMacd != null && curSignal != null) {
      if (prevMacd <= prevSignal && curMacd > curSignal) crossover = "bullish";
      else if (prevMacd >= prevSignal && curMacd < curSignal) crossover = "bearish";
    }
  }

  return {
    macd: macdLine,
    signal: signalLine,
    histogram,
    current: { macd: currentMacd, signal: currentSignal, histogram: currentHist },
    crossover,
  };
}

// ---------------------------------------------------------------------------
// Bollinger Bands
// ---------------------------------------------------------------------------

export interface BollingerBandsResult {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
  current: { upper: number | null; middle: number | null; lower: number | null; bandwidth: number | null; percentB: number | null };
  squeeze: boolean; // bandwidth is low relative to recent history
}

export function computeBollingerBands(points: HistoricalPricePoint[], period = 20, stdDev = 2): BollingerBandsResult {
  const closes = points.map((p) => p.close);
  const sma = smaSeries(closes, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];

  for (let i = 0; i < closes.length; i++) {
    const mid = sma[i];
    if (mid == null || i < period - 1) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const v = closes[j] ?? 0;
      variance += (v - mid) ** 2;
    }
    const sd = Math.sqrt(variance / (period - 1));
    upper.push(mid + sd * stdDev);
    lower.push(mid - sd * stdDev);
  }

  const curUpper = upper[upper.length - 1] ?? null;
  const curMid = sma[sma.length - 1] ?? null;
  const curLower = lower[lower.length - 1] ?? null;
  const curPrice = closes[closes.length - 1] ?? null;
  const bandwidth = curUpper != null && curLower != null && curMid != null && curMid !== 0
    ? (curUpper - curLower) / curMid
    : null;
  const percentB = curUpper != null && curLower != null && curPrice != null && curUpper !== curLower
    ? (curPrice - curLower) / (curUpper - curLower)
    : null;

  // Squeeze: current bandwidth is in the lowest 20% of the last 60 bars.
  const bandwidths: number[] = [];
  for (let i = Math.max(0, upper.length - 60); i < upper.length; i++) {
    const u = upper[i];
    const l = lower[i];
    const m = sma[i];
    if (u != null && l != null && m != null && m !== 0) {
      bandwidths.push((u - l) / m);
    }
  }
  const squeezeThreshold = bandwidths.length > 10
    ? bandwidths.sort((a, b) => a - b)[Math.floor(bandwidths.length * 0.2)]
    : null;
  const squeeze = bandwidth != null && squeezeThreshold != null && bandwidth <= squeezeThreshold;

  return {
    upper,
    middle: sma,
    lower,
    current: { upper: curUpper, middle: curMid, lower: curLower, bandwidth, percentB },
    squeeze,
  };
}

// ---------------------------------------------------------------------------
// Stochastic Oscillator
// ---------------------------------------------------------------------------

export interface StochasticResult {
  k: (number | null)[];
  d: (number | null)[];
  current: { k: number | null; d: number | null };
  signal: "overbought" | "oversold" | "neutral";
}

export function computeStochastic(points: HistoricalPricePoint[], kPeriod = 14, dPeriod = 3): StochasticResult {
  const k: (number | null)[] = [];
  for (let i = 0; i < points.length; i++) {
    if (i < kPeriod - 1) {
      k.push(null);
      continue;
    }
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      const p = points[j];
      if (!p) continue;
      if (p.high > highest) highest = p.high;
      if (p.low < lowest) lowest = p.low;
    }
    const cur = points[i];
    if (cur && highest !== lowest) {
      k.push(((cur.close - lowest) / (highest - lowest)) * 100);
    } else {
      k.push(null);
    }
  }

  const kValues = k.map((v) => v ?? 0);
  const d = smaSeries(kValues, dPeriod);

  const curK = k[k.length - 1] ?? null;
  const curD = d[d.length - 1] ?? null;
  const signal = curK == null ? "neutral" : curK > 80 ? "overbought" : curK < 20 ? "oversold" : "neutral";

  return { k, d, current: { k: curK, d: curD }, signal };
}

// ---------------------------------------------------------------------------
// ATR (Average True Range)
// ---------------------------------------------------------------------------

export interface ATRResult {
  values: (number | null)[];
  current: number | null;
  currentAsPercent: number | null; // ATR / current price
  volatilityRegime: "low" | "normal" | "high";
}

export function computeATR(points: HistoricalPricePoint[], period = 14): ATRResult {
  const values: (number | null)[] = [];
  if (points.length < period + 1) {
    return { values: points.map(() => null), current: null, currentAsPercent: null, volatilityRegime: "normal" };
  }

  const trs: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const cur = points[i];
    if (!cur) { trs.push(0); continue; }
    trs.push(trueRange(points[i - 1], cur));
  }

  // First ATR = average of first `period` TRs.
  let atr = 0;
  for (let i = 0; i < period; i++) atr += trs[i] ?? 0;
  atr /= period;
  values.push(...Array(period - 1).fill(null));
  values.push(atr);

  // Subsequent ATRs use Wilder's smoothing.
  for (let i = period; i < points.length; i++) {
    atr = (atr * (period - 1) + (trs[i] ?? 0)) / period;
    values.push(atr);
  }

  const current = values[values.length - 1] ?? null;
  const curPrice = points[points.length - 1]?.close ?? 0;
  const currentAsPercent = current != null && curPrice > 0 ? current / curPrice : null;

  // Volatility regime: compare current ATR% to the median of recent ATR% values.
  const recentPcts: number[] = [];
  for (let i = Math.max(period, values.length - 60); i < values.length; i++) {
    const a = values[i];
    const p = points[i]?.close ?? 0;
    if (a != null && p > 0) recentPcts.push(a / p);
  }
  const sorted = [...recentPcts].sort((a, b) => a - b);
  const median = sorted.length > 0 ? (sorted[Math.floor(sorted.length / 2)] ?? currentAsPercent ?? 0) : (currentAsPercent ?? 0);
  const ratio = currentAsPercent != null && median > 0 ? currentAsPercent / median : 1;
  const volatilityRegime = ratio > 1.5 ? "high" : ratio < 0.7 ? "low" : "normal";

  return { values, current, currentAsPercent, volatilityRegime };
}

// ---------------------------------------------------------------------------
// OBV (On-Balance Volume)
// ---------------------------------------------------------------------------

export interface OBVResult {
  values: number[];
  current: number;
  trend: "up" | "down" | "flat";
  divergence: "bullish" | "bearish" | "none";
}

export function computeOBV(points: HistoricalPricePoint[]): OBVResult {
  const values: number[] = [];
  let obv = 0;
  for (let i = 0; i < points.length; i++) {
    if (i === 0) {
      obv = points[i]?.volume ?? 0;
    } else {
      const prev = points[i - 1];
      const cur = points[i];
      if (!prev || !cur) {
        values.push(obv);
        continue;
      }
      if (cur.close > prev.close) obv += cur.volume ?? 0;
      else if (cur.close < prev.close) obv -= cur.volume ?? 0;
      // If close === prev.close, OBV unchanged.
    }
    values.push(obv);
  }

  // Trend: compare last 20 bars.
  const recent = values.slice(-20);
  const trend = recent.length >= 2
    ? recent[recent.length - 1]! > recent[0]! ? "up" : recent[recent.length - 1]! < recent[0]! ? "down" : "flat"
    : "flat";

  // Divergence: price up but OBV down (bearish) or price down but OBV up (bullish).
  const priceRecent = points.slice(-20);
  const priceUp = priceRecent.length >= 2 && (priceRecent[priceRecent.length - 1]?.close ?? 0) > (priceRecent[0]?.close ?? 0);
  const obvUp = trend === "up";
  const divergence = priceUp && !obvUp ? "bearish" : !priceUp && obvUp ? "bullish" : "none";

  return { values, current: obv, trend, divergence };
}

// ---------------------------------------------------------------------------
// ADX (Average Directional Index)
// ---------------------------------------------------------------------------

export interface ADXResult {
  adx: (number | null)[];
  plusDI: (number | null)[];
  minusDI: (number | null)[];
  current: { adx: number | null; plusDI: number | null; minusDI: number | null };
  trendStrength: "weak" | "developing" | "strong";
  trendDirection: "bullish" | "bearish" | "neutral";
}

export function computeADX(points: HistoricalPricePoint[], period = 14): ADXResult {
  if (points.length < period * 2) {
    const nulls = points.map(() => null);
    return {
      adx: nulls, plusDI: nulls, minusDI: nulls,
      current: { adx: null, plusDI: null, minusDI: null },
      trendStrength: "weak", trendDirection: "neutral",
    };
  }

  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const trs: number[] = [];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    if (!prev || !cur) {
      plusDM.push(0); minusDM.push(0); trs.push(0);
      continue;
    }
    const upMove = cur.high - prev.high;
    const downMove = prev.low - cur.low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trs.push(trueRange(prev, cur));
  }

  // Wilder's smoothing for TR, +DM, -DM.
  const smoothedTR: number[] = [];
  const smoothedPlusDM: number[] = [];
  const smoothedMinusDM: number[] = [];

  let trSum = 0, plusDMSum = 0, minusDMSum = 0;
  for (let i = 0; i < period; i++) {
    trSum += trs[i] ?? 0;
    plusDMSum += plusDM[i] ?? 0;
    minusDMSum += minusDM[i] ?? 0;
  }
  smoothedTR.push(trSum);
  smoothedPlusDM.push(plusDMSum);
  smoothedMinusDM.push(minusDMSum);

  for (let i = period; i < trs.length; i++) {
    trSum = trSum - trSum / period + (trs[i] ?? 0);
    plusDMSum = plusDMSum - plusDMSum / period + (plusDM[i] ?? 0);
    minusDMSum = minusDMSum - minusDMSum / period + (minusDM[i] ?? 0);
    smoothedTR.push(trSum);
    smoothedPlusDM.push(plusDMSum);
    smoothedMinusDM.push(minusDMSum);
  }

  const plusDI: (number | null)[] = [];
  const minusDI: (number | null)[] = [];
  const dx: (number | null)[] = [];

  for (let i = 0; i < smoothedTR.length; i++) {
    const tr = smoothedTR[i] ?? 0;
    const pdi = tr > 0 ? ((smoothedPlusDM[i] ?? 0) / tr) * 100 : 0;
    const mdi = tr > 0 ? ((smoothedMinusDM[i] ?? 0) / tr) * 100 : 0;
    plusDI.push(pdi);
    minusDI.push(mdi);
    const sum = pdi + mdi;
    dx.push(sum > 0 ? (Math.abs(pdi - mdi) / sum) * 100 : 0);
  }

  // ADX = Wilder's smoothing of DX.
  const adx: (number | null)[] = [];
  if (dx.length < period) {
    return {
      adx: points.map(() => null), plusDI: points.map(() => null), minusDI: points.map(() => null),
      current: { adx: null, plusDI: null, minusDI: null },
      trendStrength: "weak", trendDirection: "neutral",
    };
  }
  let adxVal = 0;
  for (let i = 0; i < period; i++) adxVal += dx[i] ?? 0;
  adxVal /= period;
  adx.push(...Array(period - 1).fill(null), adxVal);
  for (let i = period; i < dx.length; i++) {
    adxVal = (adxVal * (period - 1) + (dx[i] ?? 0)) / period;
    adx.push(adxVal);
  }

  // Pad to match points length.
  while (adx.length < points.length) adx.unshift(null);
  while (plusDI.length < points.length) plusDI.unshift(null);
  while (minusDI.length < points.length) minusDI.unshift(null);

  const curAdx = adx[adx.length - 1] ?? null;
  const curPlus = plusDI[plusDI.length - 1] ?? null;
  const curMinus = minusDI[minusDI.length - 1] ?? null;

  const trendStrength = curAdx == null ? "weak" : curAdx < 20 ? "weak" : curAdx < 40 ? "developing" : "strong";
  const trendDirection = curPlus != null && curMinus != null
    ? curPlus > curMinus ? "bullish" : curPlus < curMinus ? "bearish" : "neutral"
    : "neutral";

  return { adx, plusDI, minusDI, current: { adx: curAdx, plusDI: curPlus, minusDI: curMinus }, trendStrength, trendDirection };
}

// ---------------------------------------------------------------------------
// VWAP (Volume-Weighted Average Price)
// ---------------------------------------------------------------------------

export interface VWAPResult {
  values: (number | null)[];
  current: number | null;
  priceVsVwap: "above" | "below" | "at";
}

export function computeVWAP(points: HistoricalPricePoint[]): VWAPResult {
  const values: (number | null)[] = [];
  let cumPV = 0;
  let cumVol = 0;
  for (const p of points) {
    if (!p) {
      values.push(null);
      continue;
    }
    const vol = p.volume ?? 0;
    const typical = (p.high + p.low + p.close) / 3;
    cumPV += typical * vol;
    cumVol += vol;
    values.push(cumVol > 0 ? cumPV / cumVol : null);
  }
  const current = values[values.length - 1] ?? null;
  const curPrice = points[points.length - 1]?.close ?? 0;
  const priceVsVwap = current == null ? "at" : Math.abs(curPrice - current) / current < 0.001 ? "at" : curPrice > current ? "above" : "below";
  return { values, current, priceVsVwap };
}

// ---------------------------------------------------------------------------
// Ichimoku Cloud
// ---------------------------------------------------------------------------

export interface IchimokuResult {
  tenkan: (number | null)[];
  kijun: (number | null)[];
  senkouA: (number | null)[];
  senkouB: (number | null)[];
  chikou: (number | null)[];
  current: {
    tenkan: number | null;
    kijun: number | null;
    senkouA: number | null;
    senkouB: number | null;
    chikou: number | null;
  };
  signal: "bullish" | "bearish" | "neutral";
  cloudColor: "green" | "red" | "flat";
}

export function computeIchimoku(points: HistoricalPricePoint[]): IchimokuResult {
  const tenkanPeriod = 9;
  const kijunPeriod = 26;
  const senkouBPeriod = 52;
  const displacement = 26;

  const midpoint = (pts: HistoricalPricePoint[], start: number, end: number): number | null => {
    if (start < 0 || end >= pts.length) return null;
    let highest = -Infinity;
    let lowest = Infinity;
    for (let i = start; i <= end; i++) {
      const p = pts[i];
      if (!p) continue;
      if (p.high > highest) highest = p.high;
      if (p.low < lowest) lowest = p.low;
    }
    return highest === -Infinity ? null : (highest + lowest) / 2;
  };

  const tenkan: (number | null)[] = points.map((_, i) => midpoint(points, i - tenkanPeriod + 1, i));
  const kijun: (number | null)[] = points.map((_, i) => midpoint(points, i - kijunPeriod + 1, i));
  const senkouA: (number | null)[] = points.map((_, i) => {
    const t = tenkan[i];
    const k = kijun[i];
    return t != null && k != null ? (t + k) / 2 : null;
  });
  const senkouB: (number | null)[] = points.map((_, i) => midpoint(points, i - senkouBPeriod + 1, i));
  const chikou: (number | null)[] = points.map((_, i) => {
    const future = i + displacement;
    return future < points.length ? points[future]?.close ?? null : null;
  });

  const curIdx = points.length - 1;
  const current = {
    tenkan: tenkan[curIdx] ?? null,
    kijun: kijun[curIdx] ?? null,
    senkouA: senkouA[curIdx] ?? null,
    senkouB: senkouB[curIdx] ?? null,
    chikou: chikou[curIdx] ?? null,
  };

  const curPrice = points[curIdx]?.close ?? 0;
  const cloudTop = Math.max(current.senkouA ?? 0, current.senkouB ?? 0);
  const cloudBottom = Math.min(current.senkouA ?? 0, current.senkouB ?? 0);
  const signal = curPrice > cloudTop ? "bullish" : curPrice < cloudBottom ? "bearish" : "neutral";
  const cloudColor = (current.senkouA ?? 0) > (current.senkouB ?? 0) ? "green" : (current.senkouA ?? 0) < (current.senkouB ?? 0) ? "red" : "flat";

  return { tenkan, kijun, senkouA, senkouB, chikou, current, signal, cloudColor };
}

// ---------------------------------------------------------------------------
// Parabolic SAR
// ---------------------------------------------------------------------------

export interface ParabolicSARResult {
  values: (number | null)[];
  current: number | null;
  trend: "up" | "down";
}

export function computeParabolicSAR(points: HistoricalPricePoint[], afStart = 0.02, afMax = 0.2): ParabolicSARResult {
  if (points.length < 2) {
    return { values: points.map(() => null), current: null, trend: "up" };
  }

  const values: (number | null)[] = [null];
  let psar = points[0]?.low ?? 0;
  let ep = points[0]?.high ?? 0;
  let af = afStart;
  let trend: "up" | "down" = "up";

  for (let i = 1; i < points.length; i++) {
    const cur = points[i];
    if (!cur) {
      values.push(null);
      continue;
    }

    if (trend === "up") {
      const newPsar = psar + af * (ep - psar);
      if (cur.low < newPsar) {
        // Reverse to downtrend.
        trend = "down";
        psar = ep;
        ep = cur.low;
        af = afStart;
      } else {
        psar = Math.min(newPsar, points[i - 1]?.low ?? Infinity, points[i - 2]?.low ?? Infinity);
        if (cur.high > ep) {
          ep = cur.high;
          af = Math.min(af + afStart, afMax);
        }
      }
    } else {
      const newPsar = psar + af * (ep - psar);
      if (cur.high > newPsar) {
        // Reverse to uptrend.
        trend = "up";
        psar = ep;
        ep = cur.high;
        af = afStart;
      } else {
        psar = Math.max(newPsar, points[i - 1]?.high ?? -Infinity, points[i - 2]?.high ?? -Infinity);
        if (cur.low < ep) {
          ep = cur.low;
          af = Math.min(af + afStart, afMax);
        }
      }
    }
    values.push(psar);
  }

  return { values, current: values[values.length - 1] ?? null, trend };
}

// ---------------------------------------------------------------------------
// TTM Squeeze (John Carter's volatility + momentum indicator)
// ---------------------------------------------------------------------------
// A squeeze fires when Bollinger Bands move INSIDE Keltner Channels (volatility
// contraction). The histogram shows momentum (linear regression of close minus
// SMA) to indicate direction of the expected breakout.
// On Thinkorswim: red dots = inside squeeze (compression), blue dots = just
// fired (breakout starting), histogram bars show momentum direction.

export interface TTMSqueezeResult {
  /** Per-bar: true when BB is inside KC (squeeze active) */
  squeezeActive: boolean[];
  /** Per-bar: true when squeeze just fired (was active, now released) */
  squeezeFired: boolean[];
  /** Momentum histogram (linear regression slope of close - SMA) */
  histogram: (number | null)[];
  current: {
    squeezeActive: boolean;
    squeezeFired: boolean;
    histogram: number | null;
  };
  signal: "squeeze" | "fired" | "normal";
}

export function computeTTMSqueeze(
  points: HistoricalPricePoint[],
  bbPeriod = 20,
  bbStdDev = 2,
  kcPeriod = 20,
  kcMultiplier = 1.5,
): TTMSqueezeResult {
  const closes = points.map((p) => p.close);
  const bb = computeBollingerBands(points, bbPeriod, bbStdDev);
  const kc = computeKeltnerChannels(points, kcPeriod, kcMultiplier);

  const squeezeActive: boolean[] = [];
  const squeezeFired: boolean[] = [];

  for (let i = 0; i < points.length; i++) {
    const bbUpper = bb.upper[i];
    const bbLower = bb.lower[i];
    const kcUpper = kc.upper[i];
    const kcLower = kc.lower[i];
    if (bbUpper == null || bbLower == null || kcUpper == null || kcLower == null) {
      squeezeActive.push(false);
      squeezeFired.push(false);
      continue;
    }
    const inside = bbUpper < kcUpper && bbLower > kcLower;
    squeezeActive.push(inside);
    // Fired: current bar not inside but previous bar was inside.
    const prevInside = i > 0 ? (squeezeActive[i - 1] ?? false) : false;
    squeezeFired.push(!inside && prevInside);
  }

  // Momentum histogram: linear regression value of (close - SMA) over `bbPeriod`.
  const sma = smaSeries(closes, bbPeriod);
  const histogram: (number | null)[] = [];
  for (let i = 0; i < points.length; i++) {
    if (i < bbPeriod - 1 || sma[i] == null) {
      histogram.push(null);
      continue;
    }
    // Linear regression slope of (close - sma) over the last bbPeriod bars.
    const vals: number[] = [];
    for (let j = i - bbPeriod + 1; j <= i; j++) {
      const s = sma[j];
      vals.push(s != null ? (closes[j] ?? 0) - s : 0);
    }
    const n = vals.length;
    const xMean = (n - 1) / 2;
    const yMean = vals.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let j = 0; j < n; j++) {
      num += (j - xMean) * ((vals[j] ?? 0) - yMean);
      den += (j - xMean) ** 2;
    }
    const slope = den !== 0 ? num / den : 0;
    // Histogram value = current (close - sma) + slope * (n-1) for momentum projection.
    const curVal = vals[n - 1] ?? 0;
    histogram.push(curVal + slope * (n - 1));
  }

  const curIdx = points.length - 1;
  const current = {
    squeezeActive: squeezeActive[curIdx] ?? false,
    squeezeFired: squeezeFired[curIdx] ?? false,
    histogram: histogram[curIdx] ?? null,
  };
  const signal = current.squeezeFired ? "fired" : current.squeezeActive ? "squeeze" : "normal";

  return { squeezeActive, squeezeFired, histogram, current, signal };
}

// ---------------------------------------------------------------------------
// Keltner Channels (ATR-based volatility bands)
// ---------------------------------------------------------------------------

export interface KeltnerChannelResult {
  upper: (number | null)[];
  middle: (number | null)[]; // EMA of close
  lower: (number | null)[];
  current: { upper: number | null; middle: number | null; lower: number | null };
}

export function computeKeltnerChannels(
  points: HistoricalPricePoint[],
  period = 20,
  multiplier = 1.5,
): KeltnerChannelResult {
  const closes = points.map((p) => p.close);
  const ema = emaSeries(closes, period);
  const atr = computeATR(points, period);

  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];

  for (let i = 0; i < points.length; i++) {
    const mid = ema[i];
    const a = atr.values[i];
    if (mid == null || a == null) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    upper.push(mid + multiplier * a);
    lower.push(mid - multiplier * a);
  }

  return {
    upper,
    middle: ema,
    lower,
    current: {
      upper: upper[upper.length - 1] ?? null,
      middle: ema[ema.length - 1] ?? null,
      lower: lower[lower.length - 1] ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Williams %R (Thinkorswim: WilliamsPercentR)
// ---------------------------------------------------------------------------

export interface WilliamsRResult {
  values: (number | null)[];
  current: number | null;
  signal: "oversold" | "overbought" | "neutral";
}

export function computeWilliamsR(points: HistoricalPricePoint[], period = 14): WilliamsRResult {
  const values: (number | null)[] = [];
  for (let i = 0; i < points.length; i++) {
    if (i < period - 1) {
      values.push(null);
      continue;
    }
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      const p = points[j];
      if (!p) continue;
      if (p.high > highest) highest = p.high;
      if (p.low < lowest) lowest = p.low;
    }
    const cur = points[i];
    if (cur && highest !== lowest) {
      // Williams %R = ((Highest High - Close) / (Highest High - Lowest Low)) * -100
      values.push(((highest - cur.close) / (highest - lowest)) * -100);
    } else {
      values.push(null);
    }
  }
  const current = values[values.length - 1] ?? null;
  // Williams %R range: -100 to 0. Oversold < -80, Overbought > -20.
  const signal = current == null ? "neutral" : current > -20 ? "overbought" : current < -80 ? "oversold" : "neutral";
  return { values, current, signal };
}

// ---------------------------------------------------------------------------
// CCI (Commodity Channel Index)
// ---------------------------------------------------------------------------

export interface CCIResult {
  values: (number | null)[];
  current: number | null;
  signal: "overbought" | "oversold" | "neutral";
}

export function computeCCI(points: HistoricalPricePoint[], period = 20): CCIResult {
  const values: (number | null)[] = [];
  const typicalPrices = points.map((p) => (p.high + p.low + p.close) / 3);

  for (let i = 0; i < points.length; i++) {
    if (i < period - 1) {
      values.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += typicalPrices[j] ?? 0;
    const smaTp = sum / period;
    // Mean deviation
    let meanDev = 0;
    for (let j = i - period + 1; j <= i; j++) {
      meanDev += Math.abs((typicalPrices[j] ?? 0) - smaTp);
    }
    meanDev /= period;
    const curTp = typicalPrices[i] ?? 0;
    // CCI = (Typical Price - SMA) / (0.015 * Mean Deviation)
    const cci = meanDev !== 0 ? (curTp - smaTp) / (0.015 * meanDev) : 0;
    values.push(cci);
  }
  const current = values[values.length - 1] ?? null;
  const signal = current == null ? "neutral" : current > 100 ? "overbought" : current < -100 ? "oversold" : "neutral";
  return { values, current, signal };
}

// ---------------------------------------------------------------------------
// MFI (Money Flow Index) — volume-weighted RSI
// ---------------------------------------------------------------------------

export interface MFIResult {
  values: (number | null)[];
  current: number | null;
  signal: "overbought" | "oversold" | "neutral";
}

export function computeMFI(points: HistoricalPricePoint[], period = 14): MFIResult {
  const values: (number | null)[] = [];
  if (points.length < period + 1) {
    return { values: points.map(() => null), current: null, signal: "neutral" };
  }

  const typicalPrices: number[] = [];
  const rawMoneyFlow: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p) { typicalPrices.push(0); rawMoneyFlow.push(0); continue; }
    const tp = (p.high + p.low + p.close) / 3;
    typicalPrices.push(tp);
    rawMoneyFlow.push(tp * (p.volume ?? 0));
  }

  for (let i = period; i < points.length; i++) {
    let posFlow = 0;
    let negFlow = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (j === 0) continue;
      const curTp = typicalPrices[j] ?? 0;
      const prevTp = typicalPrices[j - 1] ?? 0;
      const flow = rawMoneyFlow[j] ?? 0;
      if (curTp > prevTp) posFlow += flow;
      else if (curTp < prevTp) negFlow += flow;
    }
    const mfr = negFlow === 0 ? 100 : posFlow / negFlow;
    values.push(100 - 100 / (1 + mfr));
  }
  // Pad front with nulls
  while (values.length < points.length) values.unshift(null);

  const current = values[values.length - 1] ?? null;
  const signal = current == null ? "neutral" : current > 80 ? "overbought" : current < 20 ? "oversold" : "neutral";
  return { values, current, signal };
}

// ---------------------------------------------------------------------------
// Donchian Channels (price channel breakout)
// ---------------------------------------------------------------------------

export interface DonchianChannelResult {
  upper: (number | null)[];
  lower: (number | null)[];
  middle: (number | null)[];
  current: { upper: number | null; lower: number | null; middle: number | null };
}

export function computeDonchianChannels(points: HistoricalPricePoint[], period = 20): DonchianChannelResult {
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  const middle: (number | null)[] = [];

  for (let i = 0; i < points.length; i++) {
    if (i < period - 1) {
      upper.push(null);
      lower.push(null);
      middle.push(null);
      continue;
    }
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      const p = points[j];
      if (!p) continue;
      if (p.high > highest) highest = p.high;
      if (p.low < lowest) lowest = p.low;
    }
    upper.push(highest === -Infinity ? null : highest);
    lower.push(lowest === Infinity ? null : lowest);
    middle.push(highest !== -Infinity && lowest !== Infinity ? (highest + lowest) / 2 : null);
  }

  return {
    upper,
    lower,
    middle,
    current: {
      upper: upper[upper.length - 1] ?? null,
      lower: lower[lower.length - 1] ?? null,
      middle: middle[middle.length - 1] ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Aggregate Signal Score & Trade Levels
// ---------------------------------------------------------------------------

export type SignalLabel = "strong_sell" | "sell" | "neutral" | "buy" | "strong_buy";

export interface SignalScore {
  /** Score from -100 (max bearish) to +100 (max bullish) */
  score: number;
  label: SignalLabel;
  /** Weighted contribution breakdown for transparency */
  components: { name: string; value: number; weight: number }[];
}

export interface TradeLevels {
  buyZone: { lower: number | null; upper: number | null };
  sellZone: { lower: number | null; upper: number | null };
  stopLoss: number | null;
  targets: number[];
  /** Key support levels (price below current) */
  supports: { level: number; source: string }[];
  /** Key resistance levels (price above current) */
  resistances: { level: number; source: string }[];
}

/**
 * Computes a weighted signal score from all indicators.
 * Each indicator contributes a weighted vote from -1 (bearish) to +1 (bullish).
 * The final score is the weighted average scaled to -100..+100.
 */
export function computeSignalScore(ind: TechnicalIndicators): SignalScore {
  const components: { name: string; value: number; weight: number }[] = [];

  // RSI — weight 1.5
  {
    const v = ind.rsi.current;
    let vote = 0;
    if (v != null) {
      if (v < 30) vote = 0.8;        // oversold → bullish bounce
      else if (v < 45) vote = 0.3;
      else if (v > 70) vote = -0.8;  // overbought → bearish pullback
      else if (v > 55) vote = -0.3;
    }
    components.push({ name: "RSI", value: vote, weight: 1.5 });
  }

  // MACD — weight 2.0
  {
    let vote = 0;
    if (ind.macd.crossover === "bullish") vote = 0.8;
    else if (ind.macd.crossover === "bearish") vote = -0.8;
    const hist = ind.macd.current.histogram ?? 0;
    vote += Math.max(-0.4, Math.min(0.4, hist / Math.abs(hist || 1) * 0.4));
    components.push({ name: "MACD", value: vote, weight: 2.0 });
  }

  // Bollinger Bands — weight 1.0
  {
    const pb = ind.bollinger.current.percentB;
    let vote = 0;
    if (pb != null) {
      if (pb < 0) vote = 0.6;        // below lower band → oversold
      else if (pb > 1) vote = -0.6;  // above upper band → overbought
      else vote = (0.5 - pb) * 0.4;  // near lower = bullish, near upper = bearish
    }
    components.push({ name: "Bollinger", value: vote, weight: 1.0 });
  }

  // Stochastic — weight 1.0
  {
    let vote = 0;
    if (ind.stochastic.signal === "oversold") vote = 0.7;
    else if (ind.stochastic.signal === "overbought") vote = -0.7;
    components.push({ name: "Stochastic", value: vote, weight: 1.0 });
  }

  // ADX trend — weight 2.0
  {
    let vote = 0;
    if (ind.adx.trendDirection === "bullish" && ind.adx.trendStrength !== "weak") vote = 0.8;
    else if (ind.adx.trendDirection === "bearish" && ind.adx.trendStrength !== "weak") vote = -0.8;
    else if (ind.adx.trendStrength === "weak") vote = 0; // no trend = neutral
    components.push({ name: "ADX", value: vote, weight: 2.0 });
  }

  // OBV — weight 1.0
  {
    let vote = 0;
    if (ind.obv.trend === "up") vote = 0.5;
    else if (ind.obv.trend === "down") vote = -0.5;
    if (ind.obv.divergence === "bullish") vote += 0.3;
    if (ind.obv.divergence === "bearish") vote -= 0.3;
    components.push({ name: "OBV", value: Math.max(-1, Math.min(1, vote)), weight: 1.0 });
  }

  // VWAP — weight 0.5
  {
    let vote = 0;
    if (ind.vwap.priceVsVwap === "above") vote = 0.4;
    else if (ind.vwap.priceVsVwap === "below") vote = -0.4;
    components.push({ name: "VWAP", value: vote, weight: 0.5 });
  }

  // Ichimoku — weight 1.0
  {
    let vote = 0;
    if (ind.ichimoku.signal === "bullish") vote = 0.6;
    else if (ind.ichimoku.signal === "bearish") vote = -0.6;
    if (ind.ichimoku.cloudColor === "green") vote += 0.2;
    if (ind.ichimoku.cloudColor === "red") vote -= 0.2;
    components.push({ name: "Ichimoku", value: Math.max(-1, Math.min(1, vote)), weight: 1.0 });
  }

  // Parabolic SAR — weight 1.0
  {
    let vote = 0;
    if (ind.parabolicSAR.trend === "up") vote = 0.5;
    else vote = -0.5;
    components.push({ name: "Parabolic SAR", value: vote, weight: 1.0 });
  }

  // TTM Squeeze — weight 1.5
  {
    let vote = 0;
    if (ind.ttmSqueeze.signal === "fired") {
      vote = (ind.ttmSqueeze.current.histogram ?? 0) > 0 ? 0.8 : -0.8;
    } else if (ind.ttmSqueeze.signal === "squeeze") {
      vote = 0; // pending — neutral
    } else {
      const h = ind.ttmSqueeze.current.histogram ?? 0;
      vote = Math.max(-0.4, Math.min(0.4, h / Math.abs(h || 1) * 0.4));
    }
    components.push({ name: "TTM Squeeze", value: vote, weight: 1.5 });
  }

  // Williams %R — weight 1.0
  {
    let vote = 0;
    if (ind.williamsR.signal === "oversold") vote = 0.6;
    else if (ind.williamsR.signal === "overbought") vote = -0.6;
    components.push({ name: "Williams %R", value: vote, weight: 1.0 });
  }

  // CCI — weight 1.0
  {
    let vote = 0;
    if (ind.cci.signal === "oversold") vote = 0.6;
    else if (ind.cci.signal === "overbought") vote = -0.6;
    else {
      const c = ind.cci.current ?? 0;
      vote = Math.max(-0.3, Math.min(0.3, c / 200));
    }
    components.push({ name: "CCI", value: vote, weight: 1.0 });
  }

  // MFI — weight 1.0
  {
    let vote = 0;
    if (ind.mfi.signal === "oversold") vote = 0.6;
    else if (ind.mfi.signal === "overbought") vote = -0.6;
    components.push({ name: "MFI", value: vote, weight: 1.0 });
  }

  // Moving averages — weight 1.5
  {
    let vote = 0;
    if (ind.movingAverages.goldenCross) vote += 0.4;
    if (ind.movingAverages.deathCross) vote -= 0.4;
    if (ind.movingAverages.priceVsSMA50 === "above") vote += 0.3;
    else if (ind.movingAverages.priceVsSMA50 === "below") vote -= 0.3;
    if (ind.movingAverages.priceVsSMA200 === "above") vote += 0.3;
    else if (ind.movingAverages.priceVsSMA200 === "below") vote -= 0.3;
    components.push({ name: "Moving Averages", value: Math.max(-1, Math.min(1, vote)), weight: 1.5 });
  }

  // Donchian breakout — weight 0.5
  {
    let vote = 0;
    const price = ind.currentPrice;
    if (ind.donchian.current.upper != null && price >= ind.donchian.current.upper) vote = 0.6;
    else if (ind.donchian.current.lower != null && price <= ind.donchian.current.lower) vote = -0.6;
    components.push({ name: "Donchian", value: vote, weight: 0.5 });
  }

  // Compute weighted average.
  const totalWeight = components.reduce((s, c) => s + c.weight, 0);
  const weightedSum = components.reduce((s, c) => s + c.value * c.weight, 0);
  const score = Math.round((weightedSum / totalWeight) * 100);

  let label: SignalLabel;
  if (score <= -60) label = "strong_sell";
  else if (score <= -20) label = "sell";
  else if (score < 20) label = "neutral";
  else if (score < 60) label = "buy";
  else label = "strong_buy";

  return { score, label, components };
}

/**
 * Computes actionable buy/sell price zones from indicator-derived support/resistance.
 */
export function computeTradeLevels(ind: TechnicalIndicators): TradeLevels {
  const price = ind.currentPrice;
  const supports: { level: number; source: string }[] = [];
  const resistances: { level: number; source: string }[] = [];

  // Bollinger Bands
  if (ind.bollinger.current.lower != null) {
    if (ind.bollinger.current.lower < price) supports.push({ level: ind.bollinger.current.lower, source: "Bollinger Lower Band" });
  }
  if (ind.bollinger.current.upper != null) {
    if (ind.bollinger.current.upper > price) resistances.push({ level: ind.bollinger.current.upper, source: "Bollinger Upper Band" });
  }

  // Keltner Channels
  if (ind.keltner.current.lower != null && ind.keltner.current.lower < price) {
    supports.push({ level: ind.keltner.current.lower, source: "Keltner Lower" });
  }
  if (ind.keltner.current.upper != null && ind.keltner.current.upper > price) {
    resistances.push({ level: ind.keltner.current.upper, source: "Keltner Upper" });
  }

  // Donchian Channels
  if (ind.donchian.current.lower != null && ind.donchian.current.lower < price) {
    supports.push({ level: ind.donchian.current.lower, source: "Donchian Lower (20)" });
  }
  if (ind.donchian.current.upper != null && ind.donchian.current.upper > price) {
    resistances.push({ level: ind.donchian.current.upper, source: "Donchian Upper (20)" });
  }

  // Moving averages
  if (ind.movingAverages.sma50 != null && ind.movingAverages.sma50 < price) {
    supports.push({ level: ind.movingAverages.sma50, source: "SMA 50" });
  } else if (ind.movingAverages.sma50 != null && ind.movingAverages.sma50 > price) {
    resistances.push({ level: ind.movingAverages.sma50, source: "SMA 50" });
  }
  if (ind.movingAverages.sma200 != null && ind.movingAverages.sma200 < price) {
    supports.push({ level: ind.movingAverages.sma200, source: "SMA 200" });
  } else if (ind.movingAverages.sma200 != null && ind.movingAverages.sma200 > price) {
    resistances.push({ level: ind.movingAverages.sma200, source: "SMA 200" });
  }

  // Ichimoku
  if (ind.ichimoku.current.senkouB != null && ind.ichimoku.current.senkouB < price) {
    supports.push({ level: ind.ichimoku.current.senkouB, source: "Ichimoku Senkou B" });
  }
  if (ind.ichimoku.current.senkouA != null && ind.ichimoku.current.senkouA > price) {
    resistances.push({ level: ind.ichimoku.current.senkouA, source: "Ichimoku Senkou A" });
  }

  // Parabolic SAR
  if (ind.parabolicSAR.current != null) {
    if (ind.parabolicSAR.current < price) supports.push({ level: ind.parabolicSAR.current, source: "Parabolic SAR" });
    else resistances.push({ level: ind.parabolicSAR.current, source: "Parabolic SAR" });
  }

  // VWAP
  if (ind.vwap.current != null) {
    if (ind.vwap.current < price) supports.push({ level: ind.vwap.current, source: "VWAP" });
    else resistances.push({ level: ind.vwap.current, source: "VWAP" });
  }

  // Sort: supports descending (closest first), resistances ascending (closest first)
  supports.sort((a, b) => b.level - a.level);
  resistances.sort((a, b) => a.level - b.level);

  // Buy zone: from strongest support to next support (or current price - 1 ATR)
  const atrVal = ind.atr.current ?? 0;
  const buyLower = supports.length > 0 ? Math.min(...supports.map((s) => s.level)) : null;
  const buyUpper = supports.length > 0 ? supports[0]!.level : (price - atrVal * 0.5);

  // Sell zone: from closest resistance to next resistance (or current price + 1 ATR)
  const sellLower = resistances.length > 0 ? resistances[0]!.level : (price + atrVal * 0.5);
  const sellUpper = resistances.length > 0 ? Math.max(...resistances.map((r) => r.level)) : null;

  // Stop loss: 1.5 ATR below the buy zone upper
  const stopLoss = buyUpper != null ? buyUpper - atrVal * 1.5 : null;

  // Targets: resistance levels, or ATR-based projections
  const targets: number[] = [];
  for (const r of resistances.slice(0, 3)) targets.push(r.level);
  if (targets.length < 3) {
    for (const mult of [1, 2, 3]) {
      const t = price + atrVal * mult;
      if (!targets.includes(t)) targets.push(Math.round(t * 100) / 100);
    }
  }

  return {
    buyZone: { lower: buyLower, upper: buyUpper },
    sellZone: { lower: sellLower, upper: sellUpper },
    stopLoss,
    targets: targets.slice(0, 3),
    supports: supports.slice(0, 5),
    resistances: resistances.slice(0, 5),
  };
}

// ---------------------------------------------------------------------------
// Aggregate: all indicators at once
// ---------------------------------------------------------------------------

export interface TechnicalIndicators {
  symbol: string;
  currentPrice: number;
  rsi: RSIResult;
  macd: MACDResult;
  bollinger: BollingerBandsResult;
  stochastic: StochasticResult;
  atr: ATRResult;
  obv: OBVResult;
  adx: ADXResult;
  vwap: VWAPResult;
  ichimoku: IchimokuResult;
  parabolicSAR: ParabolicSARResult;
  ttmSqueeze: TTMSqueezeResult;
  williamsR: WilliamsRResult;
  cci: CCIResult;
  mfi: MFIResult;
  keltner: KeltnerChannelResult;
  donchian: DonchianChannelResult;
  movingAverages: {
    sma20: number | null;
    sma50: number | null;
    sma200: number | null;
    ema12: number | null;
    ema26: number | null;
    ema50: number | null;
    priceVsSMA50: "above" | "below" | "at";
    priceVsSMA200: "above" | "below" | "at";
    goldenCross: boolean; // SMA50 > SMA200
    deathCross: boolean; // SMA50 < SMA200
  };
  signalScore: SignalScore;
  tradeLevels: TradeLevels;
  summary: {
    bullishSignals: string[];
    bearishSignals: string[];
    neutralSignals: string[];
    overallBias: "bullish" | "bearish" | "neutral";
    signalCount: { bullish: number; bearish: number; neutral: number };
  };
  warnings: string[];
}

export function computeAllIndicators(points: HistoricalPricePoint[], symbol: string): TechnicalIndicators {
  const warnings: string[] = [];
  if (points.length < 60) {
    warnings.push(`Only ${points.length} data points — some indicators need 200+ for full accuracy.`);
  }

  const closes = points.map((p) => p.close);
  const currentPrice = closes[closes.length - 1] ?? 0;

  const rsi = computeRSI(points);
  const macd = computeMACD(points);
  const bollinger = computeBollingerBands(points);
  const stochastic = computeStochastic(points);
  const atr = computeATR(points);
  const obv = computeOBV(points);
  const adx = computeADX(points);
  const vwap = computeVWAP(points);
  const ichimoku = computeIchimoku(points);
  const parabolicSAR = computeParabolicSAR(points);
  const ttmSqueeze = computeTTMSqueeze(points);
  const williamsR = computeWilliamsR(points);
  const cci = computeCCI(points);
  const mfi = computeMFI(points);
  const keltner = computeKeltnerChannels(points);
  const donchian = computeDonchianChannels(points);

  const sma20Arr = smaSeries(closes, 20);
  const sma50Arr = smaSeries(closes, 50);
  const sma200Arr = smaSeries(closes, 200);
  const ema12Arr = emaSeries(closes, 12);
  const ema26Arr = emaSeries(closes, 26);
  const ema50Arr = emaSeries(closes, 50);

  const sma20 = sma20Arr[sma20Arr.length - 1] ?? null;
  const sma50 = sma50Arr[sma50Arr.length - 1] ?? null;
  const sma200 = sma200Arr[sma200Arr.length - 1] ?? null;
  const ema12 = ema12Arr[ema12Arr.length - 1] ?? null;
  const ema26 = ema26Arr[ema26Arr.length - 1] ?? null;
  const ema50 = ema50Arr[ema50Arr.length - 1] ?? null;

  const priceVsSMA50 = sma50 == null ? "at" : Math.abs(currentPrice - sma50) / sma50 < 0.001 ? "at" : currentPrice > sma50 ? "above" : "below";
  const priceVsSMA200 = sma200 == null ? "at" : Math.abs(currentPrice - sma200) / sma200 < 0.001 ? "at" : currentPrice > sma200 ? "above" : "below";
  const goldenCross = sma50 != null && sma200 != null && sma50 > sma200;
  const deathCross = sma50 != null && sma200 != null && sma50 < sma200;

  // Build signal summary.
  const bullishSignals: string[] = [];
  const bearishSignals: string[] = [];
  const neutralSignals: string[] = [];

  if (rsi.signal === "oversold") bullishSignals.push(`RSI oversold (${rsi.current?.toFixed(1)}) — potential bounce`);
  if (rsi.signal === "overbought") bearishSignals.push(`RSI overbought (${rsi.current?.toFixed(1)}) — potential pullback`);
  if (rsi.signal === "neutral") neutralSignals.push(`RSI neutral (${rsi.current?.toFixed(1)})`);

  if (macd.crossover === "bullish") bullishSignals.push("MACD bullish crossover — momentum turning up");
  if (macd.crossover === "bearish") bearishSignals.push("MACD bearish crossover — momentum turning down");
  if ((macd.current.histogram ?? 0) > 0) bullishSignals.push("MACD histogram positive");
  if ((macd.current.histogram ?? 0) < 0) bearishSignals.push("MACD histogram negative");

  if (bollinger.squeeze) neutralSignals.push("Bollinger Band squeeze — volatility expansion likely");
  if ((bollinger.current.percentB ?? 1) > 1) bearishSignals.push("Price above upper Bollinger Band — overextended");
  if ((bollinger.current.percentB ?? 1) < 0) bullishSignals.push("Price below lower Bollinger Band — oversold");

  if (stochastic.signal === "oversold") bullishSignals.push(`Stochastic oversold (%K ${stochastic.current.k?.toFixed(1)})`);
  if (stochastic.signal === "overbought") bearishSignals.push(`Stochastic overbought (%K ${stochastic.current.k?.toFixed(1)})`);

  if (adx.trendDirection === "bullish" && adx.trendStrength !== "weak") bullishSignals.push(`ADX ${adx.current.adx?.toFixed(1)} — strong uptrend`);
  if (adx.trendDirection === "bearish" && adx.trendStrength !== "weak") bearishSignals.push(`ADX ${adx.current.adx?.toFixed(1)} — strong downtrend`);
  if (adx.trendStrength === "weak") neutralSignals.push(`ADX ${adx.current.adx?.toFixed(1)} — weak/no trend`);

  if (obv.trend === "up") bullishSignals.push("OBV rising — accumulation");
  if (obv.trend === "down") bearishSignals.push("OBV falling — distribution");
  if (obv.divergence === "bullish") bullishSignals.push("Bullish OBV divergence — price down but volume up");
  if (obv.divergence === "bearish") bearishSignals.push("Bearish OBV divergence — price up but volume down");

  if (vwap.priceVsVwap === "above") bullishSignals.push("Price above VWAP — bullish intraday");
  if (vwap.priceVsVwap === "below") bearishSignals.push("Price below VWAP — bearish intraday");

  if (ichimoku.signal === "bullish") bullishSignals.push("Price above Ichimoku cloud");
  if (ichimoku.signal === "bearish") bearishSignals.push("Price below Ichimoku cloud");
  if (ichimoku.cloudColor === "green") bullishSignals.push("Ichimoku cloud green (Senkou A > B)");
  if (ichimoku.cloudColor === "red") bearishSignals.push("Ichimoku cloud red (Senkou A < B)");

  if (parabolicSAR.trend === "up") bullishSignals.push("Parabolic SAR in uptrend");
  if (parabolicSAR.trend === "down") bearishSignals.push("Parabolic SAR in downtrend");

  // TTM Squeeze signals
  if (ttmSqueeze.signal === "fired") {
    const histDir = (ttmSqueeze.current.histogram ?? 0) > 0 ? "bullish" : "bearish";
    if (histDir === "bullish") bullishSignals.push("TTM Squeeze fired — volatility expansion with bullish momentum");
    else bearishSignals.push("TTM Squeeze fired — volatility expansion with bearish momentum");
  }
  if (ttmSqueeze.signal === "squeeze") neutralSignals.push("TTM Squeeze active — volatility contraction, breakout pending");
  if (ttmSqueeze.signal === "normal" && (ttmSqueeze.current.histogram ?? 0) > 0) bullishSignals.push("TTM Squeeze histogram positive — bullish momentum");
  if (ttmSqueeze.signal === "normal" && (ttmSqueeze.current.histogram ?? 0) < 0) bearishSignals.push("TTM Squeeze histogram negative — bearish momentum");

  // Williams %R signals
  if (williamsR.signal === "oversold") bullishSignals.push(`Williams %R oversold (${williamsR.current?.toFixed(1)}) — potential bounce`);
  if (williamsR.signal === "overbought") bearishSignals.push(`Williams %R overbought (${williamsR.current?.toFixed(1)}) — potential pullback`);

  // CCI signals
  if (cci.signal === "oversold") bullishSignals.push(`CCI oversold (${cci.current?.toFixed(0)}) — potential bounce`);
  if (cci.signal === "overbought") bearishSignals.push(`CCI overbought (${cci.current?.toFixed(0)}) — potential pullback`);

  // MFI signals
  if (mfi.signal === "oversold") bullishSignals.push(`MFI oversold (${mfi.current?.toFixed(1)}) — money flow turning up`);
  if (mfi.signal === "overbought") bearishSignals.push(`MFI overbought (${mfi.current?.toFixed(1)}) — money flow turning down`);

  // Donchian channel breakout signals
  const curPrice = currentPrice;
  if (donchian.current.upper != null && curPrice >= donchian.current.upper) bullishSignals.push("Price at/above Donchian channel upper — breakout signal");
  if (donchian.current.lower != null && curPrice <= donchian.current.lower) bearishSignals.push("Price at/below Donchian channel lower — breakdown signal");

  if (goldenCross) bullishSignals.push("Golden cross (SMA50 > SMA200)");
  if (deathCross) bearishSignals.push("Death cross (SMA50 < SMA200)");
  if (priceVsSMA200 === "above") bullishSignals.push("Price above SMA200 — long-term uptrend");
  if (priceVsSMA200 === "below") bearishSignals.push("Price below SMA200 — long-term downtrend");
  if (priceVsSMA50 === "above") bullishSignals.push("Price above SMA50 — medium-term uptrend");
  if (priceVsSMA50 === "below") bearishSignals.push("Price below SMA50 — medium-term downtrend");

  const signalCount = { bullish: bullishSignals.length, bearish: bearishSignals.length, neutral: neutralSignals.length };
  const overallBias = signalCount.bullish > signalCount.bearish + 2 ? "bullish" : signalCount.bearish > signalCount.bullish + 2 ? "bearish" : "neutral";

  const baseIndicators: TechnicalIndicators = {
    symbol,
    currentPrice,
    rsi,
    macd,
    bollinger,
    stochastic,
    atr,
    obv,
    adx,
    vwap,
    ichimoku,
    parabolicSAR,
    ttmSqueeze,
    williamsR,
    cci,
    mfi,
    keltner,
    donchian,
    movingAverages: {
      sma20, sma50, sma200, ema12, ema26, ema50,
      priceVsSMA50, priceVsSMA200,
      goldenCross, deathCross,
    },
    summary: { bullishSignals, bearishSignals, neutralSignals, overallBias, signalCount },
    warnings,
    signalScore: { score: 0, label: "neutral", components: [] },
    tradeLevels: { buyZone: { lower: null, upper: null }, sellZone: { lower: null, upper: null }, stopLoss: null, targets: [], supports: [], resistances: [] },
  };

  const signalScore = computeSignalScore(baseIndicators);
  const tradeLevels = computeTradeLevels(baseIndicators);

  return { ...baseIndicators, signalScore, tradeLevels };
}
