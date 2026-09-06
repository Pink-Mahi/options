/**
 * Market context analysis — compares a stock's performance against a broad
 * market benchmark (SPY) to distinguish systemic drawdowns (market-wide events
 * like COVID, GFC, rate-hike panics) from idiosyncratic ones (company-specific
 * problems when the rest of the market is fine).
 *
 * All functions are PURE and DETERMINISTIC. Unit-tested in ./market-context.test.ts.
 */

import type { HistoricalPricePoint } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MarketRegimeType = "BULL" | "BEAR" | "CRISIS" | "RECOVERY";

export interface MarketRegime {
  type: MarketRegimeType;
  startDate: string;
  endDate: string;
  benchmarkReturn: number;
  description: string;
}

export interface DrawdownAttribution {
  startDate: string;
  endDate: string;
  stockDrawdown: number;
  marketDrawdown: number;
  /** Fraction of the stock's drawdown explained by market movement (0–1) */
  systemicFraction: number;
  type: "SYSTEMIC" | "IDIOSYNCRATIC" | "MIXED";
  description: string;
}

export interface MarketContext {
  benchmarkSymbol: string;
  benchmarkReturn: number;
  benchmarkAnnualizedReturn: number;
  benchmarkMaxDrawdown: number;
  /** Average rolling 90-day beta over the period */
  avgBeta: number;
  /** Average rolling 90-day correlation */
  avgCorrelation: number;
  /** Alpha vs benchmark (stock return - beta * benchmark return) */
  alpha: number;
  /** Regime periods identified in the backtest window */
  regimes: MarketRegime[];
  /** Major stock drawdowns (>10%) attributed to systemic vs idiosyncratic */
  drawdownAttributions: DrawdownAttribution[];
  /** Percentage of the stock's total drawdown magnitude attributable to market */
  systemicDrawdownPct: number;
  /** Regime at the end of the backtest period */
  currentRegime: MarketRegimeType;
  /** Benchmark equity curve normalized to the same starting capital */
  benchmarkEquity: { date: string; equity: number }[];
  /** Human-readable summary for the UI */
  summary: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AlignedPoint {
  date: string;
  stockClose: number;
  benchmarkClose: number;
}

/** Align stock and benchmark price series by date (inner join). */
function alignByDate(
  stock: HistoricalPricePoint[],
  benchmark: HistoricalPricePoint[],
): AlignedPoint[] {
  const map = new Map<string, AlignedPoint>();
  for (const p of stock) {
    map.set(p.date, { date: p.date, stockClose: p.adjustedClose, benchmarkClose: NaN });
  }
  for (const p of benchmark) {
    const existing = map.get(p.date);
    if (existing) {
      existing.benchmarkClose = p.adjustedClose;
    }
  }
  const aligned: AlignedPoint[] = [];
  for (const p of map.values()) {
    if (Number.isFinite(p.benchmarkClose)) aligned.push(p);
  }
  return aligned.sort((a, b) => a.date.localeCompare(b.date));
}

/** Daily log returns from a price series. */
function logReturns(prices: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const curr = prices[i];
    if (prev && curr && Number.isFinite(curr / prev)) {
      out.push(Math.log(curr / prev));
    }
  }
  return out;
}

/** Simple moving average over N periods. */
function sma(values: number[], window: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < window - 1) {
      out.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = i - window + 1; j <= i; j++) sum += values[j]!;
    out.push(sum / window);
  }
  return out;
}

/** Rolling max drawdown ending at each index. */
function rollingDrawdown(prices: number[]): { date: string; drawdown: number; peakIdx: number }[] {
  const out: { date: string; drawdown: number; peakIdx: number }[] = [];
  let peak = prices[0] ?? 0;
  let peakIdx = 0;
  for (let i = 0; i < prices.length; i++) {
    if (prices[i]! > peak) {
      peak = prices[i]!;
      peakIdx = i;
    }
    const dd = peak > 0 ? (peak - prices[i]!) / peak : 0;
    out.push({ date: "", drawdown: dd, peakIdx });
  }
  return out;
}

/**
 * Rolling regression beta: cov(stock, benchmark) / var(benchmark).
 * Returns beta and correlation for each window.
 */
function rollingBetaCorrelation(
  stockReturns: number[],
  benchmarkReturns: number[],
  window: number,
): { beta: number; correlation: number }[] {
  const out: { beta: number; correlation: number }[] = [];
  for (let i = 0; i < stockReturns.length; i++) {
    if (i < window - 1) {
      out.push({ beta: NaN, correlation: NaN });
      continue;
    }
    const sr = stockReturns.slice(i - window + 1, i + 1);
    const br = benchmarkReturns.slice(i - window + 1, i + 1);
    const n = sr.length;
    if (n < 2) {
      out.push({ beta: NaN, correlation: NaN });
      continue;
    }
    const meanS = sr.reduce((s, r) => s + r, 0) / n;
    const meanB = br.reduce((s, r) => s + r, 0) / n;
    let cov = 0;
    let varB = 0;
    let varS = 0;
    for (let j = 0; j < n; j++) {
      const ds = sr[j]! - meanS;
      const db = br[j]! - meanB;
      cov += ds * db;
      varB += db * db;
      varS += ds * ds;
    }
    const beta = varB > 1e-12 ? cov / varB : NaN;
    const corr =
      varS > 1e-12 && varB > 1e-12 ? cov / Math.sqrt(varS * varB) : NaN;
    out.push({ beta, correlation: corr });
  }
  return out;
}

/** Compute max drawdown from a price series. */
function computeMaxDrawdown(prices: number[]): number {
  let peak = prices[0] ?? 0;
  let maxDd = 0;
  for (const p of prices) {
    if (p > peak) peak = p;
    const dd = peak > 0 ? (peak - p) / peak : 0;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

/** Find drawdown periods exceeding a threshold. Returns start/end indices. */
function findDrawdownPeriods(
  prices: number[],
  threshold: number,
): { startIdx: number; troughIdx: number; endIdx: number; drawdown: number }[] {
  const periods: { startIdx: number; troughIdx: number; endIdx: number; drawdown: number }[] = [];
  let peak = prices[0] ?? 0;
  let peakIdx = 0;
  let inDrawdown = false;
  let troughIdx = 0;
  let maxDdInPeriod = 0;

  for (let i = 0; i < prices.length; i++) {
    if (prices[i]! > peak) {
      if (inDrawdown && maxDdInPeriod >= threshold) {
        periods.push({ startIdx: peakIdx, troughIdx, endIdx: i - 1, drawdown: maxDdInPeriod });
      }
      peak = prices[i]!;
      peakIdx = i;
      inDrawdown = false;
      maxDdInPeriod = 0;
    } else {
      const dd = peak > 0 ? (peak - prices[i]!) / peak : 0;
      if (dd >= threshold && !inDrawdown) {
        inDrawdown = true;
        troughIdx = i;
        maxDdInPeriod = dd;
      } else if (inDrawdown) {
        if (dd > maxDdInPeriod) {
          maxDdInPeriod = dd;
          troughIdx = i;
        }
      }
    }
  }
  // If still in drawdown at the end
  if (inDrawdown && maxDdInPeriod >= threshold) {
    periods.push({ startIdx: peakIdx, troughIdx, endIdx: prices.length - 1, drawdown: maxDdInPeriod });
  }
  return periods;
}

// ---------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------

/**
 * Analyze market context by comparing a stock's performance against a benchmark.
 *
 * @param stockPrices  Historical prices for the stock being backtested
 * @param benchmarkPrices  Historical prices for the benchmark (e.g. SPY)
 * @param benchmarkSymbol  Symbol of the benchmark (for display)
 * @param startingCapital  Normalization base for the benchmark equity curve
 */
export function analyzeMarketContext(
  stockPrices: HistoricalPricePoint[],
  benchmarkPrices: HistoricalPricePoint[],
  benchmarkSymbol: string,
  startingCapital: number,
): MarketContext | null {
  const aligned = alignByDate(stockPrices, benchmarkPrices);
  if (aligned.length < 30) return null;

  const dates = aligned.map((p) => p.date);
  const stockCloses = aligned.map((p) => p.stockClose);
  const benchCloses = aligned.map((p) => p.benchmarkClose);

  // --- Returns ---
  const stockRet = logReturns(stockCloses);
  const benchRet = logReturns(benchCloses);

  const stockTotalReturn =
    stockCloses.length > 1
      ? (stockCloses[stockCloses.length - 1]! - stockCloses[0]!) / stockCloses[0]!
      : 0;
  const benchTotalReturn =
    benchCloses.length > 1
      ? (benchCloses[benchCloses.length - 1]! - benchCloses[0]!) / benchCloses[0]!
      : 0;

  const totalDays = aligned.length;
  const years = totalDays / 252;
  const benchAnnualized = years > 0
    ? (Math.pow(1 + benchTotalReturn, 1 / years) - 1)
    : 0;

  // --- Rolling beta & correlation (90-day window) ---
  const window = Math.min(90, Math.floor(stockRet.length / 3));
  const betas = rollingBetaCorrelation(stockRet, benchRet, Math.max(window, 20));
  const validBetas = betas.filter((b) => Number.isFinite(b.beta));
  const validCorrs = betas.filter((b) => Number.isFinite(b.correlation));
  const avgBeta = validBetas.length > 0
    ? validBetas.reduce((s, b) => s + b.beta, 0) / validBetas.length
    : 0;
  const avgCorrelation = validCorrs.length > 0
    ? validCorrs.reduce((s, b) => s + b.correlation, 0) / validCorrs.length
    : 0;

  // --- Alpha (CAPM-style: stock return - beta * benchmark return) ---
  const alpha = stockTotalReturn - avgBeta * benchTotalReturn;

  // --- Benchmark max drawdown ---
  const benchMaxDd = computeMaxDrawdown(benchCloses);

  // --- Regime detection using 200-day SMA on benchmark ---
  const smaWindow = Math.min(200, Math.floor(benchCloses.length / 2));
  const smaValues = sma(benchCloses, Math.max(smaWindow, 50));
  const regimes = detectRegimes(benchCloses, smaValues, dates, benchMaxDd);

  // --- Drawdown attribution ---
  const stockDdPeriods = findDrawdownPeriods(stockCloses, 0.10);
  const benchDdPeriods = findDrawdownPeriods(benchCloses, 0.05);

  const drawdownAttributions: DrawdownAttribution[] = stockDdPeriods.map((sp) => {
    const stockDd = sp.drawdown;
    // Find the benchmark drawdown over the same period
    const benchSlice = benchCloses.slice(sp.startIdx, sp.troughIdx + 1);
    const benchPeak = Math.max(...benchSlice);
    const benchTrough = benchCloses[sp.troughIdx] ?? benchPeak;
    const marketDd = benchPeak > 0 ? (benchPeak - benchTrough) / benchPeak : 0;

    // Systemic fraction: how much of the stock's drawdown is explained by market
    // Use beta-adjusted market drawdown as the expected stock drawdown from market
    const expectedFromMarket = Math.abs(avgBeta) * marketDd;
    const systemicFraction = stockDd > 0 ? Math.min(expectedFromMarket / stockDd, 1) : 0;

    let type: "SYSTEMIC" | "IDIOSYNCRATIC" | "MIXED";
    let description: string;

    if (marketDd >= 0.10 && systemicFraction > 0.6) {
      type = "SYSTEMIC";
      description = `Stock fell ${pct(stockDd)} but the market also fell ${pct(marketDd)} — this drawdown was driven by broad market conditions, not company-specific issues.`;
    } else if (marketDd < 0.05) {
      type = "IDIOSYNCRATIC";
      description = `Stock fell ${pct(stockDd)} while the market was roughly flat (${pct(marketDd)}) — this drawdown is company-specific, not a market-wide event.`;
    } else {
      type = "MIXED";
      description = `Stock fell ${pct(stockDd)} and the market fell ${pct(marketDd)} — partially explained by market conditions, but the stock underperformed even after adjusting for beta.`;
    }

    return {
      startDate: dates[sp.startIdx] ?? "",
      endDate: dates[sp.endIdx] ?? "",
      stockDrawdown: stockDd,
      marketDrawdown: marketDd,
      systemicFraction,
      type,
      description,
    };
  });

  // --- Overall systemic drawdown percentage ---
  const totalStockDd = drawdownAttributions.reduce((s, d) => s + d.stockDrawdown, 0);
  const totalSystemicDd = drawdownAttributions.reduce((s, d) => s + d.stockDrawdown * d.systemicFraction, 0);
  const systemicDrawdownPct = totalStockDd > 0 ? totalSystemicDd / totalStockDd : 0;

  // --- Benchmark equity curve (normalized to startingCapital) ---
  const benchStart = benchCloses[0] ?? 1;
  const benchmarkEquity = aligned.map((p, i) => ({
    date: p.date,
    equity: startingCapital * (benchCloses[i]! / benchStart),
  }));

  // --- Current regime ---
  const currentRegime = regimes.length > 0 ? regimes[regimes.length - 1]!.type : "BULL";

  // --- Summary text ---
  const systemicCount = drawdownAttributions.filter((d) => d.type === "SYSTEMIC").length;
  const idioCount = drawdownAttributions.filter((d) => d.type === "IDIOSYNCRATIC").length;
  const summary = buildSummary({
    benchmarkSymbol,
    benchTotalReturn,
    avgBeta,
    avgCorrelation,
    alpha,
    currentRegime,
    systemicCount,
    idioCount,
    systemicDrawdownPct,
    drawdownAttributions,
  });

  return {
    benchmarkSymbol,
    benchmarkReturn: benchTotalReturn,
    benchmarkAnnualizedReturn: benchAnnualized,
    benchmarkMaxDrawdown: benchMaxDd,
    avgBeta,
    avgCorrelation,
    alpha,
    regimes,
    drawdownAttributions,
    systemicDrawdownPct,
    currentRegime,
    benchmarkEquity,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Regime detection
// ---------------------------------------------------------------------------

function detectRegimes(
  benchmarkCloses: number[],
  smaValues: number[],
  dates: string[],
  maxDd: number,
): MarketRegime[] {
  const regimes: MarketRegime[] = [];
  if (benchmarkCloses.length < 50) return regimes;

  let currentType: MarketRegimeType = "BULL";
  let regimeStart = 0;
  let regimeStartPrice = benchmarkCloses[0]!;

  // Track drawdown from running peak for crisis detection
  let peak = benchmarkCloses[0]!;

  for (let i = 1; i < benchmarkCloses.length; i++) {
    const price = benchmarkCloses[i]!;
    const smaVal = smaValues[i] ?? NaN;
    if (price > peak) peak = price;
    const ddFromPeak = peak > 0 ? (peak - price) / peak : 0;

    let newType: MarketRegimeType;

    if (ddFromPeak > 0.20) {
      newType = "CRISIS";
    } else if (ddFromPeak > 0.10) {
      newType = "BEAR";
    } else if (Number.isFinite(smaVal) && price < smaVal) {
      // Below 200-SMA but not in deep drawdown
      if (currentType === "CRISIS" || currentType === "BEAR") {
        newType = "RECOVERY";
      } else {
        newType = "BEAR";
      }
    } else {
      // Above SMA, no significant drawdown
      if (currentType === "CRISIS" || currentType === "BEAR" || currentType === "RECOVERY") {
        // Check if we've fully recovered (made new high or close to it)
        if (price >= peak * 0.97) {
          newType = "BULL";
        } else {
          newType = "RECOVERY";
        }
      } else {
        newType = "BULL";
      }
    }

    if (newType !== currentType) {
      // Close current regime
      const regimeReturn =
        regimeStartPrice > 0
          ? (benchmarkCloses[i - 1]! - regimeStartPrice) / regimeStartPrice
          : 0;
      regimes.push({
        type: currentType,
        startDate: dates[regimeStart] ?? "",
        endDate: dates[i - 1] ?? "",
        benchmarkReturn: regimeReturn,
        description: regimeDescription(currentType, regimeReturn),
      });
      currentType = newType;
      regimeStart = i;
      regimeStartPrice = benchmarkCloses[i]!;
    }
  }

  // Close final regime
  const finalReturn =
    regimeStartPrice > 0
      ? (benchmarkCloses[benchmarkCloses.length - 1]! - regimeStartPrice) / regimeStartPrice
      : 0;
  regimes.push({
    type: currentType,
    startDate: dates[regimeStart] ?? "",
    endDate: dates[dates.length - 1] ?? "",
    benchmarkReturn: finalReturn,
    description: regimeDescription(currentType, finalReturn),
  });

  return regimes;
}

function regimeDescription(type: MarketRegimeType, ret: number): string {
  const r = pct(ret);
  switch (type) {
    case "BULL":
      return `Market was in a bull regime (${r} benchmark return). Strategy premiums typically benefit from rising prices and declining IV.`;
    case "BEAR":
      return `Market was in a bear regime (${r} benchmark return). Elevated IV may boost premiums, but assignment risk increases.`;
    case "CRISIS":
      return `Market was in crisis (${r} benchmark return). IV spikes inflate premiums but drawdowns are severe — this is a systemic event, not company-specific.`;
    case "RECOVERY":
      return `Market was recovering (${r} benchmark return). IV remains elevated, which can produce attractive premiums as prices normalize.`;
  }
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

function buildSummary(params: {
  benchmarkSymbol: string;
  benchTotalReturn: number;
  avgBeta: number;
  avgCorrelation: number;
  alpha: number;
  currentRegime: MarketRegimeType;
  systemicCount: number;
  idioCount: number;
  systemicDrawdownPct: number;
  drawdownAttributions: DrawdownAttribution[];
}): string {
  const {
    benchmarkSymbol,
    benchTotalReturn,
    avgBeta,
    avgCorrelation,
    alpha,
    currentRegime,
    systemicCount,
    idioCount,
    systemicDrawdownPct,
    drawdownAttributions,
  } = params;

  const parts: string[] = [];

  parts.push(
    `Over this period, ${benchmarkSymbol} returned ${pct(benchTotalReturn)}. ` +
    `The stock had an average beta of ${avgBeta.toFixed(2)} and correlation of ${avgCorrelation.toFixed(2)} to the market, ` +
    `meaning ${avgCorrelation > 0.7 ? "most of its moves tracked the broader market" : avgCorrelation > 0.4 ? "about half its moves tracked the market" : "it moved largely independently of the market"}.`,
  );

  if (alpha > 0.05) {
    parts.push(`The stock outperformed its beta-implied return by ${pct(alpha)} (positive alpha), suggesting company-specific strength.`);
  } else if (alpha < -0.05) {
    parts.push(`The stock underperformed its beta-implied return by ${pct(Math.abs(alpha))} (negative alpha), suggesting company-specific weakness beyond what market conditions explain.`);
  } else {
    parts.push(`Alpha was near zero (${pct(alpha)}), meaning the stock performed roughly as expected given its market sensitivity.`);
  }

  if (drawdownAttributions.length > 0) {
    parts.push(
      `Of ${drawdownAttributions.length} major drawdowns, ${systemicCount} were systemic (market-wide events like ${benchmarkSymbol} also falling) and ${idioCount} were idiosyncratic (stock-specific while the market was fine). ` +
      `Overall, ${pct(systemicDrawdownPct)} of the stock's drawdown magnitude is attributable to market conditions.`,
    );
  }

  parts.push(
    `The market ended the period in a ${currentRegime.toLowerCase()} regime. ` +
    `${currentRegime === "BULL" ? "This is generally favorable for covered-call income strategies." : currentRegime === "BEAR" ? "Expect higher IV and assignment risk — defensive strikes are warranted." : currentRegime === "CRISIS" ? "Premiums will be inflated but drawdown risk is extreme. This is when capital preservation matters more than premium income." : "IV is still elevated from the recent downturn, which can produce attractive entry points for new positions."}`,
  );

  return parts.join(" ");
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
