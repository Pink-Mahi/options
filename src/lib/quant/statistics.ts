/**
 * Quant performance statistics with overfitting correction.
 *
 * The core problem this module solves: if you try 200 strategy variants and
 * report the best one's Sharpe ratio, that number is meaningless. The maximum of
 * 200 random draws looks impressive even when every variant is pure noise. This
 * is the single most common reason retail backtests fail in live trading.
 *
 * The corrections implemented here are from Bailey & Lopez de Prado:
 *  - Probabilistic Sharpe Ratio (PSR): confidence that true Sharpe exceeds a
 *    benchmark, adjusted for non-normal returns (skew and fat tails).
 *  - Deflated Sharpe Ratio (DSR): PSR against a benchmark raised to account for
 *    how many variants were tried. This is the number to actually trust.
 *
 * References:
 *  - Bailey & Lopez de Prado (2012), "The Sharpe Ratio Efficient Frontier"
 *  - Bailey & Lopez de Prado (2014), "The Deflated Sharpe Ratio"
 *
 * All functions are PURE and DETERMINISTIC. Unit-tested in ./statistics.test.ts.
 */

/** Euler-Mascheroni constant, used in the expected-maximum-Sharpe estimator. */
const EULER_MASCHERONI = 0.5772156649015329;

export interface MomentSummary {
  count: number;
  mean: number;
  stdDev: number;
  /** Fisher-Pearson standardized third moment. 0 for a symmetric distribution. */
  skewness: number;
  /** NON-excess kurtosis. 3 for a normal distribution. */
  kurtosis: number;
}

/**
 * Sample moments of a return series.
 *
 * Note `kurtosis` is returned in non-excess form (normal = 3) because that is
 * the convention the PSR formula expects.
 */
export function computeMoments(returns: number[]): MomentSummary | null {
  const n = returns.length;
  if (n < 2) return null;

  const mean = returns.reduce((s, r) => s + r, 0) / n;
  // Sample variance (Bessel-corrected) for stdDev.
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1);
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) {
    return { count: n, mean, stdDev: 0, skewness: 0, kurtosis: 3 };
  }

  // Population moments for skew/kurtosis (divide by n), which is what the
  // Bailey & Lopez de Prado formulation uses.
  const m2 = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / n;
  const m3 = returns.reduce((s, r) => s + (r - mean) ** 3, 0) / n;
  const m4 = returns.reduce((s, r) => s + (r - mean) ** 4, 0) / n;

  const skewness = m3 / Math.pow(m2, 1.5);
  const kurtosis = m4 / (m2 * m2);

  return { count: n, mean, stdDev, skewness, kurtosis };
}

/**
 * Sharpe ratio of a period-return series, annualized.
 *
 * `periodsPerYear` MUST match the sampling frequency of `returns` (252 for
 * daily, 52 weekly, 12 monthly). Mismatching it is a common way to accidentally
 * inflate Sharpe by a factor of sqrt(ratio).
 */
export function sharpe(
  returns: number[],
  periodsPerYear: number,
  annualRiskFreeRate = 0,
): number | null {
  const m = computeMoments(returns);
  if (!m || m.stdDev === 0 || periodsPerYear <= 0) return null;
  const periodRf = annualRiskFreeRate / periodsPerYear;
  return ((m.mean - periodRf) / m.stdDev) * Math.sqrt(periodsPerYear);
}

/**
 * Probabilistic Sharpe Ratio.
 *
 * Returns the probability (0-1) that the TRUE Sharpe ratio exceeds
 * `benchmarkSharpe`, given the observed sample and its higher moments.
 * Negative skew and fat tails both reduce this confidence.
 *
 * @param observedSharpe - non-annualized (per-period) Sharpe
 * @param benchmarkSharpe - non-annualized threshold to beat
 */
export function probabilisticSharpeRatio(
  observedSharpe: number,
  benchmarkSharpe: number,
  sampleSize: number,
  skewness: number,
  kurtosis: number,
): number | null {
  if (sampleSize < 2) return null;

  // Variance of the Sharpe estimator under non-normal returns.
  const denomInner =
    1 - skewness * observedSharpe + ((kurtosis - 1) / 4) * observedSharpe * observedSharpe;

  // Guard against pathological moment combinations producing a negative variance.
  if (denomInner <= 0) return null;

  const z =
    ((observedSharpe - benchmarkSharpe) * Math.sqrt(sampleSize - 1)) / Math.sqrt(denomInner);

  return normalCdf(z);
}

/**
 * Expected maximum Sharpe ratio from `trials` independent variants, each with
 * true Sharpe zero. This is the bar a strategy must clear just to beat luck.
 *
 * Uses the extreme-value approximation for the maximum of N Gaussians.
 *
 * @param varianceOfTrialSharpes - variance of the Sharpe ratios ACROSS variants
 */
export function expectedMaxSharpe(trials: number, varianceOfTrialSharpes: number): number {
  if (trials <= 1 || varianceOfTrialSharpes <= 0) return 0;

  const sd = Math.sqrt(varianceOfTrialSharpes);
  const a = normalInv(1 - 1 / trials);
  const b = normalInv(1 - 1 / (trials * Math.E));
  return sd * ((1 - EULER_MASCHERONI) * a + EULER_MASCHERONI * b);
}

export interface DeflatedSharpeResult {
  /** Observed per-period Sharpe of the selected variant. */
  observedSharpe: number;
  /** Annualized form of the above, for display only. */
  annualizedSharpe: number;
  /** The luck-adjusted hurdle the strategy had to clear. */
  benchmarkSharpe: number;
  /** Probability (0-1) that true Sharpe > 0 ignoring selection bias. */
  probabilisticSharpe: number | null;
  /** Probability (0-1) that true Sharpe > benchmark, i.e. survives selection bias. */
  deflatedSharpe: number | null;
  trials: number;
  sampleSize: number;
  skewness: number;
  kurtosis: number;
  /** Plain-language read on whether this clears the bar. */
  verdict: "likely_genuine" | "inconclusive" | "likely_overfit" | "insufficient_data";
  notes: string[];
}

/**
 * Deflated Sharpe Ratio for a variant selected out of many.
 *
 * @param selectedReturns - period returns of the chosen variant
 * @param allTrialSharpes - per-period Sharpe of EVERY variant tried, including the winner
 * @param periodsPerYear - sampling frequency of selectedReturns
 */
export function deflatedSharpeRatio(
  selectedReturns: number[],
  allTrialSharpes: number[],
  periodsPerYear: number,
): DeflatedSharpeResult {
  const notes: string[] = [];
  const moments = computeMoments(selectedReturns);

  if (!moments || moments.stdDev === 0) {
    return {
      observedSharpe: 0,
      annualizedSharpe: 0,
      benchmarkSharpe: 0,
      probabilisticSharpe: null,
      deflatedSharpe: null,
      trials: allTrialSharpes.length,
      sampleSize: selectedReturns.length,
      skewness: 0,
      kurtosis: 3,
      verdict: "insufficient_data",
      notes: ["Not enough return observations (or zero variance) to compute a Sharpe ratio."],
    };
  }

  const observedSharpe = moments.mean / moments.stdDev;
  const annualizedSharpe = observedSharpe * Math.sqrt(periodsPerYear);

  // Spread of Sharpes across the variants we searched.
  const trials = Math.max(allTrialSharpes.length, 1);
  const trialMoments = computeMoments(allTrialSharpes);
  const varianceOfTrials = trialMoments ? trialMoments.stdDev ** 2 : 0;

  let benchmarkSharpe = expectedMaxSharpe(trials, varianceOfTrials);

  if (trials === 1) {
    notes.push(
      "Only one variant was evaluated, so there is no selection bias to deflate. This is the Probabilistic Sharpe Ratio, not a deflated one.",
    );
    benchmarkSharpe = 0;
  }
  if (varianceOfTrials === 0 && trials > 1) {
    notes.push(
      "All variants produced an identical Sharpe ratio, so the selection-bias hurdle could not be estimated and was set to zero.",
    );
  }

  const psr = probabilisticSharpeRatio(
    observedSharpe,
    0,
    moments.count,
    moments.skewness,
    moments.kurtosis,
  );
  const dsr = probabilisticSharpeRatio(
    observedSharpe,
    benchmarkSharpe,
    moments.count,
    moments.skewness,
    moments.kurtosis,
  );

  if (moments.count < 30) {
    notes.push(
      `Only ${moments.count} return observations. Sharpe estimates are very noisy below ~30 and the confidence figures should be treated as indicative only.`,
    );
  }
  if (moments.skewness < -0.5) {
    notes.push(
      `Returns are negatively skewed (${moments.skewness.toFixed(2)}): many small gains punctuated by larger losses. This reduces confidence in the Sharpe ratio.`,
    );
  }
  if (moments.kurtosis > 5) {
    notes.push(
      `Returns are fat-tailed (kurtosis ${moments.kurtosis.toFixed(2)} vs 3 for normal), so extreme moves are more likely than a normal model assumes.`,
    );
  }

  let verdict: DeflatedSharpeResult["verdict"];
  if (moments.count < 20) verdict = "insufficient_data";
  else if (dsr == null) verdict = "inconclusive";
  else if (dsr >= 0.95) verdict = "likely_genuine";
  else if (dsr >= 0.75) verdict = "inconclusive";
  else verdict = "likely_overfit";

  if (verdict === "likely_overfit") {
    notes.push(
      "After adjusting for how many variants were tried, this edge is not statistically distinguishable from luck. Do not trade it on the strength of this backtest.",
    );
  }

  return {
    observedSharpe,
    annualizedSharpe,
    benchmarkSharpe,
    probabilisticSharpe: psr,
    deflatedSharpe: dsr,
    trials,
    sampleSize: moments.count,
    skewness: moments.skewness,
    kurtosis: moments.kurtosis,
    verdict,
    notes,
  };
}

/** Maximum peak-to-trough decline of an equity curve, as a positive fraction. */
export function maxDrawdown(equityCurve: number[]): number {
  if (equityCurve.length === 0) return 0;
  let peak = equityCurve[0] ?? 0;
  let worst = 0;
  for (const v of equityCurve) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = (peak - v) / peak;
      if (dd > worst) worst = dd;
    }
  }
  return worst;
}

/** Downside-deviation Sharpe. Only penalizes returns below the target. */
export function sortino(
  returns: number[],
  periodsPerYear: number,
  targetReturn = 0,
): number | null {
  if (returns.length < 2 || periodsPerYear <= 0) return null;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const downside = returns.filter((r) => r < targetReturn);
  if (downside.length === 0) return null;
  const dd = Math.sqrt(
    downside.reduce((s, r) => s + (r - targetReturn) ** 2, 0) / downside.length,
  );
  if (dd === 0) return null;
  return ((mean - targetReturn) / dd) * Math.sqrt(periodsPerYear);
}

// ---------------------------------------------------------------------------
// Normal distribution helpers
// ---------------------------------------------------------------------------

/** Standard normal CDF via the Abramowitz-Stegun 7.1.26 error-function approximation. */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

/**
 * Inverse standard normal CDF (probit) using Acklam's rational approximation.
 * Relative error is below ~1.15e-9 across the open interval (0, 1).
 */
export function normalInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      ((((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
        ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1))
    );
  }

  if (p > pHigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -((((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
        ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1))
    );
  }

  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
}
