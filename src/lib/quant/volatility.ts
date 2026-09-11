/**
 * Advanced volatility estimators for the backtester.
 *
 * The default `realizedVol` in backtester.ts uses close-to-close log returns,
 * which is simple but ignores intraday information. The Yang-Zhang estimator
 * uses open, high, low, and close prices to capture both overnight and
 * intraday volatility, producing a more accurate realized vol estimate.
 *
 * Also provides a calibrated volatility risk premium (VRP) model that adjusts
 * the IV-RV spread based on the current regime, rather than using a fixed
 * multiplier.
 *
 * References:
 *  - Yang & Zhang (2000), "An Alternative Lag Range Volatility Estimator"
 *  - Garman & Klass (1980), "On the Estimation of Security Price Volatilities"
 *  - Bollerslev, Tauchen & Zhou (2009), "Expected Stock Returns and Variance Risk Premia"
 *
 * All functions are PURE and DETERMINISTIC.
 */

import type { HistoricalPricePoint } from "@/lib/types";

// ---------------------------------------------------------------------------
// Yang-Zhang volatility estimator
// ---------------------------------------------------------------------------

/**
 * Compute the Yang-Zhang volatility estimator over a window of prices.
 *
 * The Yang-Zhang estimator combines:
 *  - Overnight volatility (close-to-open variance)
 *  - Intraday volatility (open-to-close variance, weighted by Rogers-Satchell)
 *
 * It is approximately 8× more efficient than close-to-close and handles
 * overnight jumps and intraday mean reversion better than Garman-Klass.
 *
 * @param prices - daily OHLC prices, oldest first
 * @param endIdx - compute over [endIdx-window, endIdx)
 * @param window - number of trading days in the lookback
 * @returns annualized volatility as a decimal (e.g. 0.30 = 30%)
 */
export function yangZhangVolatility(
  prices: HistoricalPricePoint[],
  endIdx: number,
  window: number,
): number {
  if (endIdx < window + 1) return 0.3; // fallback
  const slice = prices.slice(endIdx - window, endIdx);
  if (slice.length < 3) return 0.3;

  // k parameter: weighting between overnight and intraday volatility.
  // Yang-Zhang: k = (α - 1) / (α + (n-1)/n), where α = (Var(overnight) - Var(intraday)) / ...
  // In practice, k ≈ 0.34 / (1.34 + (n+1)/(n-1)) for daily data.
  const n = slice.length;
  const k = 0.34 / (1.34 + (n + 1) / (n - 1));

  // Overnight returns: ln(open_t / close_{t-1})
  const overnightReturns: number[] = [];
  // Intraday returns (Rogers-Satchell): ln(H_t/O_t) * ln(H_t/C_t) + ln(L_t/O_t) * ln(L_t/C_t)
  const intradayRS: number[] = [];

  for (let i = 1; i < slice.length; i++) {
    const prev = slice[i - 1];
    const curr = slice[i];
    if (!prev || !curr) continue;
    if (prev.adjustedClose <= 0 || curr.open <= 0) continue;

    // Overnight return
    const overnightR = Math.log(curr.open / prev.adjustedClose);
    if (Number.isFinite(overnightR)) overnightReturns.push(overnightR);

    // Rogers-Satchell intraday variance component
    const o = curr.open;
    const h = curr.high;
    const l = curr.low;
    const c = curr.adjustedClose;
    if (o > 0 && h > 0 && l > 0 && c > 0) {
      const rs = (Math.log(h / o) * Math.log(h / c)) + (Math.log(l / o) * Math.log(l / c));
      if (Number.isFinite(rs)) intradayRS.push(rs);
    }
  }

  if (overnightReturns.length < 2) return 0.3;

  // Overnight variance
  const overnightMean = overnightReturns.reduce((s, r) => s + r, 0) / overnightReturns.length;
  const overnightVar = overnightReturns.reduce((s, r) => s + (r - overnightMean) ** 2, 0) / (overnightReturns.length - 1);

  // Intraday variance (Rogers-Satchell is already a variance estimator)
  const intradayVar = intradayRS.length > 0
    ? intradayRS.reduce((s, r) => s + r, 0) / intradayRS.length
    : 0;

  // Yang-Zhang total variance = overnight + k * intraday + (1-k) * RS
  // Simplified: σ²_YZ = σ²_overnight + k * σ²_intraday
  const totalVar = overnightVar + k * Math.max(0, intradayVar);

  if (totalVar <= 0) return 0.3;
  return Math.sqrt(totalVar) * Math.sqrt(252);
}

/**
 * Garman-Klass volatility estimator (simpler, for comparison).
 * Uses OHLC but not overnight jumps.
 */
export function garmanKlassVolatility(
  prices: HistoricalPricePoint[],
  endIdx: number,
  window: number,
): number {
  if (endIdx < window) return 0.3;
  const slice = prices.slice(endIdx - window, endIdx);
  if (slice.length < 3) return 0.3;

  const logReturns: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    const curr = slice[i];
    if (!curr) continue;
    const o = curr.open;
    const h = curr.high;
    const l = curr.low;
    const c = curr.adjustedClose;
    if (o > 0 && h > 0 && l > 0 && c > 0) {
      // GK: 0.5 * (ln(H/L))² - (2ln2-1) * (ln(C/O))²
      const gk = 0.5 * Math.log(h / l) ** 2 - (2 * Math.log(2) - 1) * Math.log(c / o) ** 2;
      if (Number.isFinite(gk)) logReturns.push(gk);
    }
  }

  if (logReturns.length < 2) return 0.3;
  const mean = logReturns.reduce((s, r) => s + r, 0) / logReturns.length;
  const variance = logReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (logReturns.length - 1);
  if (variance <= 0) return 0.3;
  return Math.sqrt(variance) * Math.sqrt(252);
}

// ---------------------------------------------------------------------------
// Calibrated volatility risk premium (VRP)
// ---------------------------------------------------------------------------

/**
 * Market regime classification for VRP calibration.
 */
export type VolRegime = "low_vol" | "normal_vol" | "high_vol" | "crisis_vol";

/**
 * Classify the current volatility regime based on recent realized vol
 * relative to its longer-term average.
 *
 * @param recentVol - short-window realized vol (e.g. 30-day)
 * @param longVol - long-window realized vol (e.g. 252-day)
 * @returns regime label
 */
export function classifyVolRegime(recentVol: number, longVol: number): VolRegime {
  if (longVol <= 0) return "normal_vol";
  const ratio = recentVol / longVol;
  if (ratio > 2.0) return "crisis_vol";
  if (ratio > 1.5) return "high_vol";
  if (ratio < 0.7) return "low_vol";
  return "normal_vol";
}

/**
 * Calibrated volatility risk premium multiplier.
 *
 * Instead of a fixed `ivRiskPremium` multiplier (e.g. 1.15), this adjusts
 * the IV-to-RV spread based on the current volatility regime:
 *
 *  - low_vol: IV is typically elevated relative to RV (VRP is wider)
 *  - normal_vol: standard VRP
 *  - high_vol: VRP narrows as options become expensive
 *  - crisis_vol: VRP can invert (IV < RV) during panics
 *
 * @param regime - current volatility regime
 * @param baseMultiplier - base IV multiplier (e.g. 1.15)
 * @returns adjusted IV multiplier
 */
export function calibratedVrpMultiplier(
  regime: VolRegime,
  baseMultiplier: number = 1.15,
): number {
  switch (regime) {
    case "low_vol":
      // In low-vol regimes, options are relatively cheap, so the VRP
      // (IV - RV) is wider. Increase the multiplier slightly.
      return baseMultiplier * 1.05;
    case "normal_vol":
      return baseMultiplier;
    case "high_vol":
      // In high-vol regimes, options are expensive, so the VRP narrows.
      return baseMultiplier * 0.95;
    case "crisis_vol":
      // In crises, IV can spike above RV but the premium for selling is
      // riskier. Reduce the multiplier to be conservative.
      return baseMultiplier * 0.85;
    default:
      return baseMultiplier;
  }
}

/**
 * Compute a calibrated IV from realized vol using regime-aware VRP.
 *
 * @param recentVol - short-window realized vol (e.g. 30-day Yang-Zhang)
 * @param longVol - long-window realized vol (e.g. 252-day)
 * @param baseMultiplier - base IV multiplier (e.g. 1.15)
 * @returns calibrated implied volatility
 */
export function calibratedImpliedVol(
  recentVol: number,
  longVol: number,
  baseMultiplier: number = 1.15,
): number {
  const regime = classifyVolRegime(recentVol, longVol);
  const multiplier = calibratedVrpMultiplier(regime, baseMultiplier);
  return recentVol * multiplier;
}

// ---------------------------------------------------------------------------
// Early assignment probability
// ---------------------------------------------------------------------------

/**
 * Estimate the probability of early assignment for a short put.
 *
 * Early assignment is most likely when:
 *  - The put is deep ITM (delta near -1)
 *  - There is little extrinsic value remaining
 *  - The stock is hard-to-borrow (high borrow cost)
 *  - A dividend is approaching (for calls, not puts)
 *
 * For puts, the main driver is the lack of extrinsic value — once the
 * put is trading at parity (intrinsic only), there's no reason for the
 * long put holder to keep the position vs. exercising.
 *
 * @param spot - current stock price
 * @param strike - put strike
 * @param timeToExpiry - in years (DTE / 365)
 * @param iv - implied volatility
 * @param riskFreeRate - annual risk-free rate
 * @param dividendYield - annual dividend yield
 * @returns probability of early assignment (0–1)
 */
export function earlyAssignmentProbability(
  spot: number,
  strike: number,
  timeToExpiry: number,
  iv: number,
  riskFreeRate: number,
  dividendYield: number = 0,
): number {
  // Only ITM puts have early assignment risk
  if (spot >= strike) return 0;

  // Compute the put's extrinsic value using Black-Scholes
  // (imported inline to avoid circular dependency)
  const intrinsic = strike - spot;
  if (intrinsic <= 0) return 0;

  // Simple extrinsic value approximation: for a deep ITM put, extrinsic ≈
  // PV(strike) - strike + spot * (1 - e^(-q*T)) ... but we'll use a
  // simplified model based on moneyness and time.
  const moneyness = (strike - spot) / strike; // how far ITM (0 = ATM, 1 = deep ITM)
  const volTime = iv * Math.sqrt(timeToExpiry);

  // Extrinsic value decays as the put goes deeper ITM and as time passes.
  // When extrinsic < ~0.5% of strike, assignment risk is high.
  const extrinsicApprox = spot * volTime * Math.exp(-moneyness * 3);

  // Assignment probability increases as extrinsic value decreases
  const extrinsicPctOfStrike = extrinsicApprox / strike;
  if (extrinsicPctOfStrike > 0.02) return 0.01; // >2% extrinsic: very low risk
  if (extrinsicPctOfStrike > 0.01) return 0.10; // 1-2%: low risk
  if (extrinsicPctOfStrike > 0.005) return 0.30; // 0.5-1%: moderate risk
  if (extrinsicPctOfStrike > 0.001) return 0.60; // 0.1-0.5%: high risk
  return 0.90; // <0.1% extrinsic: very high risk
}

/**
 * Determine if a short put should be considered for early assignment
 * during the cycle (before expiration).
 *
 * @param spot - current stock price
 * @param strike - put strike
 * @param remainingDays - days to expiration
 * @param iv - implied volatility
 * @param riskFreeRate - annual risk-free rate
 * @param threshold - probability threshold for triggering assignment (default 0.50)
 * @returns true if early assignment should be simulated
 */
export function shouldSimulateEarlyAssignment(
  spot: number,
  strike: number,
  remainingDays: number,
  iv: number,
  riskFreeRate: number,
  threshold: number = 0.50,
): boolean {
  if (spot >= strike) return false; // OTM, no assignment
  const timeToExpiry = Math.max(remainingDays, 1) / 365;
  const prob = earlyAssignmentProbability(spot, strike, timeToExpiry, iv, riskFreeRate);
  return prob >= threshold;
}
