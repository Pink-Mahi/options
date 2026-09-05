/**
 * Options pricing models: Black-Scholes (European) + Binomial CRR (American).
 *
 * Includes:
 * - Black-Scholes closed-form pricing + full Greeks
 * - Binomial Cox-Ross-Rubinstein tree with American early exercise
 * - Implied volatility solver (Newton-Raphson with bisection fallback)
 * - Probability of touch (barrier crossing approximation)
 * - Theoretical value vs market price comparison
 *
 * All functions are PURE and DETERMINISTIC. Unit-tested in ./pricing-model.test.ts.
 */

import type { OptionType, Greeks } from "@/lib/types";

// ---------------------------------------------------------------------------
// Normal distribution helpers
// ---------------------------------------------------------------------------

const SQRT_2PI = Math.sqrt(2 * Math.PI);

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

function normCdf(x: number): number {
  // Abramowitz & Stegun approximation (7.1.26) — accurate to ~1e-7
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);

  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

  return 0.5 * (1 + sign * y);
}

// ---------------------------------------------------------------------------
// Black-Scholes (European)
// ---------------------------------------------------------------------------

export interface BlackScholesInput {
  spot: number;
  strike: number;
  timeToExpiry: number; // in years (DTE / 365)
  riskFreeRate: number; // annual, as decimal (e.g. 0.05 for 5%)
  volatility: number; // annualized IV as decimal (e.g. 0.30 for 30%)
  dividendYield?: number; // annual continuous dividend yield, default 0
  optionType: OptionType;
}

export interface BlackScholesResult {
  price: number;
  greeks: Greeks;
  d1: number;
  d2: number;
}

/**
 * Black-Scholes-Merton pricing for European options with continuous dividend yield.
 * Returns theoretical price and full Greeks (delta, gamma, theta, vega, rho).
 */
export function blackScholes(input: BlackScholesInput): BlackScholesResult {
  const { spot: S, strike: K, timeToExpiry: T, riskFreeRate: r, volatility: sigma, dividendYield: q = 0, optionType } = input;

  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    // At expiry, option is worth intrinsic value
    const intrinsic = optionType === "CALL" ? Math.max(0, S - K) : Math.max(0, K - S);
    return {
      price: intrinsic,
      greeks: {
        delta: optionType === "CALL" ? (S > K ? 1 : 0) : (S < K ? -1 : 0),
        gamma: 0,
        theta: 0,
        vega: 0,
        rho: 0,
      },
      d1: 0,
      d2: 0,
    };
  }

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  const discountK = K * Math.exp(-r * T);
  const discountS = S * Math.exp(-q * T);

  let price: number;
  let delta: number;
  let rho: number;

  if (optionType === "CALL") {
    price = discountS * normCdf(d1) - discountK * normCdf(d2);
    delta = Math.exp(-q * T) * normCdf(d1);
    rho = K * T * Math.exp(-r * T) * normCdf(d2);
  } else {
    price = discountK * normCdf(-d2) - discountS * normCdf(-d1);
    delta = -Math.exp(-q * T) * normCdf(-d1);
    rho = -K * T * Math.exp(-r * T) * normCdf(-d2);
  }

  // Common Greeks
  const gamma = Math.exp(-q * T) * normPdf(d1) / (S * sigma * sqrtT);
  const vega = S * Math.exp(-q * T) * normPdf(d1) * sqrtT; // per 1.00 change in vol
  // Theta is per calendar day (divide by 365)
  let theta: number;
  if (optionType === "CALL") {
    theta = (-S * Math.exp(-q * T) * normPdf(d1) * sigma / (2 * sqrtT)
      - r * discountK * normCdf(d2)
      + q * discountS * normCdf(d1)) / 365;
  } else {
    theta = (-S * Math.exp(-q * T) * normPdf(d1) * sigma / (2 * sqrtT)
      + r * discountK * normCdf(-d2)
      - q * discountS * normCdf(-d1)) / 365;
  }

  return {
    price,
    greeks: { delta, gamma, theta, vega, rho },
    d1,
    d2,
  };
}

// ---------------------------------------------------------------------------
// Binomial CRR (American)
// ---------------------------------------------------------------------------

export interface BinomialInput {
  spot: number;
  strike: number;
  timeToExpiry: number; // years
  riskFreeRate: number;
  volatility: number;
  dividendYield?: number;
  optionType: OptionType;
  steps?: number; // default 200
}

export interface BinomialResult {
  price: number;
  greeks: Greeks;
}

/**
 * Cox-Ross-Rubinstein binomial tree with American early exercise.
 * Accurate for American-style options (all US equity options).
 */
export function binomialAmerican(input: BinomialInput): BinomialResult {
  return binomialAmericanInner(input, true);
}

/** Internal implementation with flag to skip Greek bumping (prevents infinite recursion). */
function binomialAmericanInner(input: BinomialInput, computeGreeks: boolean): BinomialResult {
  const { spot: S0, strike: K, timeToExpiry: T, riskFreeRate: r, volatility: sigma, dividendYield: q = 0, optionType, steps = 200 } = input;

  if (T <= 0 || sigma <= 0 || S0 <= 0 || K <= 0) {
    const intrinsic = optionType === "CALL" ? Math.max(0, S0 - K) : Math.max(0, K - S0);
    return {
      price: intrinsic,
      greeks: {
        delta: optionType === "CALL" ? (S0 > K ? 1 : 0) : (S0 < K ? -1 : 0),
        gamma: 0,
        theta: 0,
        vega: 0,
        rho: 0,
      },
    };
  }

  const dt = T / steps;
  const u = Math.exp(sigma * Math.sqrt(dt));
  const d = 1 / u;
  const drift = Math.exp((r - q) * dt);
  const p = (drift - d) / (u - d);
  const discStep = Math.exp(-r * dt);

  // Build terminal payoffs
  const prices: number[] = new Array(steps + 1);
  const values: number[] = new Array(steps + 1);

  for (let i = 0; i <= steps; i++) {
    const price = S0 * Math.pow(u, steps - i) * Math.pow(d, i);
    prices[i] = price;
    values[i] = optionType === "CALL"
      ? Math.max(0, price - K)
      : Math.max(0, K - price);
  }

  // Backward induction with early exercise
  for (let step = steps - 1; step >= 0; step--) {
    for (let i = 0; i <= step; i++) {
      const vi = values[i] ?? 0;
      const vi1 = values[i + 1] ?? 0;
      const contValue = discStep * (p * vi + (1 - p) * vi1);
      const spot = S0 * Math.pow(u, step - i) * Math.pow(d, i);
      const exerciseValue = optionType === "CALL"
        ? Math.max(0, spot - K)
        : Math.max(0, K - spot);
      values[i] = Math.max(contValue, exerciseValue);
    }
  }

  const price = values[0] ?? 0;

  // Greeks from the tree
  const upPrice = S0 * u;
  const downPrice = S0 * d;

  // Rebuild step-1 values for delta/gamma
  const step1Values: number[] = new Array(2);
  for (let i = 0; i <= 1; i++) {
    const vi = values[i] ?? 0;
    const vi1 = values[i + 1] ?? 0;
    const cont = discStep * (p * vi + (1 - p) * vi1);
    const spot1 = S0 * Math.pow(u, 1 - i) * Math.pow(d, i);
    const ex = optionType === "CALL" ? Math.max(0, spot1 - K) : Math.max(0, K - spot1);
    step1Values[i] = Math.max(cont, ex);
  }

  const s1v0 = step1Values[0] ?? 0;
  const s1v1 = step1Values[1] ?? 0;
  const delta = (s1v0 - s1v1) / (upPrice - downPrice);

  // Gamma: second derivative
  const midPrice = S0;
  const vMid = price;
  const gamma = ((s1v0 - vMid) / (upPrice - midPrice) - (vMid - s1v1) / (midPrice - downPrice))
    / ((upPrice - downPrice) / 2);

  // Theta: (V_step2 - V_step0) / (2 * dt)
  let theta = 0;
  if (steps >= 2) {
    const step2Values: number[] = new Array(3);
    for (let i = 0; i <= 2; i++) {
      const s1i = step1Values[i] ?? 0;
      const s1i1 = step1Values[Math.min(i + 1, 2)] ?? 0;
      const cont = discStep * (p * s1i + (1 - p) * s1i1);
      const spot2 = S0 * Math.pow(u, 2 - i) * Math.pow(d, i);
      const ex = optionType === "CALL" ? Math.max(0, spot2 - K) : Math.max(0, K - spot2);
      step2Values[i] = Math.max(cont, ex);
    }
    const avgStep2 = ((step2Values[0] ?? 0) + 2 * (step2Values[1] ?? 0) + (step2Values[2] ?? 0)) / 4;
    theta = (avgStep2 - price) / (2 * dt * 365);
  }

  // Vega and Rho: approximate by re-pricing with bumped parameters
  // Skip when computeGreeks is false to prevent infinite recursion
  let vega = 0;
  let rho = 0;
  if (computeGreeks) {
    const bumpedUp = binomialAmericanInner({ ...input, volatility: sigma * 1.01, steps: Math.min(steps, 100) }, false);
    const bumpedDown = binomialAmericanInner({ ...input, volatility: sigma * 0.99, steps: Math.min(steps, 100) }, false);
    vega = (bumpedUp.price - bumpedDown.price) / (2 * sigma * 0.01);

    const rhoUp = binomialAmericanInner({ ...input, riskFreeRate: r + 0.0001, steps: Math.min(steps, 100) }, false);
    const rhoDown = binomialAmericanInner({ ...input, riskFreeRate: r - 0.0001, steps: Math.min(steps, 100) }, false);
    rho = (rhoUp.price - rhoDown.price) / (2 * 0.0001) / 100;
  }

  return {
    price,
    greeks: { delta, gamma, theta, vega, rho },
  };
}

// ---------------------------------------------------------------------------
// Implied Volatility solver
// ---------------------------------------------------------------------------

/**
 * Solve for implied volatility using Newton-Raphson with bisection fallback.
 * Uses Black-Scholes (European) as the pricing model.
 *
 * @param marketPrice - observed option price (mid, last, etc.)
 * @param spot - underlying price
 * @param strike - option strike
 * @param timeToExpiry - years to expiry
 * @param riskFreeRate - annual rate
 * @param optionType - CALL or PUT
 * @param dividendYield - continuous dividend yield
 * @returns implied volatility as decimal, or null if no solution found
 */
export function impliedVolatility(
  marketPrice: number,
  spot: number,
  strike: number,
  timeToExpiry: number,
  riskFreeRate: number,
  optionType: OptionType,
  dividendYield: number = 0,
): number | null {
  if (marketPrice <= 0 || timeToExpiry <= 0 || spot <= 0 || strike <= 0) return null;

  // Check minimum value (intrinsic)
  const intrinsic = optionType === "CALL"
    ? Math.max(0, spot * Math.exp(-dividendYield * timeToExpiry) - strike * Math.exp(-riskFreeRate * timeToExpiry))
    : Math.max(0, strike * Math.exp(-riskFreeRate * timeToExpiry) - spot * Math.exp(-dividendYield * timeToExpiry));

  if (marketPrice < intrinsic) return null;

  const MAX_ITER = 100;
  const PRECISION = 1e-6;
  let vol = 0.3; // initial guess
  let volLow = 0.001;
  let volHigh = 5.0;

  for (let i = 0; i < MAX_ITER; i++) {
    const result = blackScholes({
      spot,
      strike,
      timeToExpiry,
      riskFreeRate,
      volatility: vol,
      dividendYield,
      optionType,
    });

    const diff = result.price - marketPrice;

    if (Math.abs(diff) < PRECISION) return vol;

    // Newton-Raphson step using vega
    const vega = result.greeks.vega;
    if (vega != null && vega > 1e-10) {
      const newVol = vol - diff / vega;
      if (newVol > volLow && newVol < volHigh) {
        vol = newVol;
      } else {
        // Bisection fallback
        if (diff > 0) volHigh = vol;
        else volLow = vol;
        vol = (volLow + volHigh) / 2;
      }
    } else {
      // Bisection fallback
      if (diff > 0) volHigh = vol;
      else volLow = vol;
      vol = (volLow + volHigh) / 2;
    }
  }

  // Return best approximation if within reasonable range
  if (vol > 0.001 && vol < 5.0) return vol;
  return null;
}

// ---------------------------------------------------------------------------
// Probability of touch (barrier crossing)
// ---------------------------------------------------------------------------

/**
 * Approximate probability that the stock price touches a barrier level
 * before expiration. Uses the reflection principle for Brownian motion.
 *
 * For a short option, this is the probability of the stock reaching the
 * strike at any point during the holding period (not just at expiration).
 * This is always >= the probability of finishing ITM (delta).
 *
 * @param spot - current stock price
 * @param barrier - target price level
 * @param timeToExpiry - years
 * @param volatility - annualized volatility (IV or HV)
 * @param riskFreeRate - annual rate
 * @param dividendYield - continuous dividend yield
 * @returns probability 0-1, or null if inputs invalid
 */
export function probabilityOfTouch(
  spot: number,
  barrier: number,
  timeToExpiry: number,
  volatility: number,
  riskFreeRate: number = 0.05,
  dividendYield: number = 0,
): number | null {
  if (timeToExpiry <= 0 || volatility <= 0 || spot <= 0 || barrier <= 0) return null;
  if (spot === barrier) return 1;

  const sigmaT = volatility * Math.sqrt(timeToExpiry);
  const drift = (riskFreeRate - dividendYield - 0.5 * volatility * volatility) * timeToExpiry;

  if (barrier > spot) {
    // Probability of touching above: P(max S_t >= H)
    // Using reflection principle for GBM:
    // P = N(-d) + (H/S)^(2μ/σ² - 1) * N(-d - 2νT/(σ√T))
    // where d = (ln(H/S) - νT) / (σ√T), μ = r-q, ν = μ - σ²/2
    const d = (Math.log(barrier / spot) - drift) / sigmaT;
    const exponent = 2 * (riskFreeRate - dividendYield) / (volatility * volatility) - 1;
    const reflectionFactor = Math.pow(barrier / spot, exponent);
    const firstTerm = normCdf(-d);
    const secondTerm = normCdf(-d - 2 * drift / sigmaT);
    return Math.min(1, Math.max(0, firstTerm + reflectionFactor * secondTerm));
  } else {
    // Probability of touching below: P(min S_t <= H)
    // P = N(-d) + (S/H)^(1 - 2μ/σ²) * N(-d + 2νT/(σ√T))
    // where d = (ln(S/H) + νT) / (σ√T)
    const d = (Math.log(spot / barrier) + drift) / sigmaT;
    const exponent = 2 * (riskFreeRate - dividendYield) / (volatility * volatility) - 1;
    const reflectionFactor = Math.pow(spot / barrier, -exponent);
    const firstTerm = normCdf(-d);
    const secondTerm = normCdf(-d + 2 * drift / sigmaT);
    return Math.min(1, Math.max(0, firstTerm + reflectionFactor * secondTerm));
  }
}

// ---------------------------------------------------------------------------
// Theoretical value comparison
// ---------------------------------------------------------------------------

export interface TheoreticalAnalysis {
  theoreticalPrice: number;
  marketPrice: number;
  edge: number; // theoretical - market (positive = underpriced, negative = overpriced)
  edgePercent: number | null;
  impliedVol: number | null;
  theoreticalVol: number | null; // vol used for theoretical price
  volEdge: number | null; // IV - theoretical vol (positive = IV rich, sell premium)
  label: "underpriced" | "fairly_priced" | "overpriced";
  note: string;
}

/**
 * Compare market price to theoretical value from a pricing model.
 * Uses IV solver to extract implied vol, then compares to a reference vol
 * (historical vol or IV mean) to determine if premium is rich or cheap.
 *
 * @param marketPrice - observed option price
 * @param spot - underlying price
 * @param strike - option strike
 * @param timeToExpiry - years
 * @param riskFreeRate - annual rate
 * @param optionType - CALL or PUT
 * @param referenceVol - historical or mean IV to compare against
 * @param dividendYield - continuous dividend yield
 */
export function analyzeTheoreticalValue(
  marketPrice: number,
  spot: number,
  strike: number,
  timeToExpiry: number,
  riskFreeRate: number,
  optionType: OptionType,
  referenceVol: number,
  dividendYield: number = 0,
): TheoreticalAnalysis {
  const iv = impliedVolatility(marketPrice, spot, strike, timeToExpiry, riskFreeRate, optionType, dividendYield);

  const theoResult = blackScholes({
    spot,
    strike,
    timeToExpiry,
    riskFreeRate,
    volatility: referenceVol,
    dividendYield,
    optionType,
  });

  const theoreticalPrice = theoResult.price;
  const edge = theoreticalPrice - marketPrice;
  const edgePercent = marketPrice > 0 ? edge / marketPrice : null;
  const volEdge = iv != null ? iv - referenceVol : null;

  let label: TheoreticalAnalysis["label"];
  let note: string;

  if (edgePercent != null && Math.abs(edgePercent) < 0.05) {
    label = "fairly_priced";
    note = "Market price is within 5% of theoretical value.";
  } else if (edge > 0) {
    label = "underpriced";
    note = volEdge != null && volEdge < 0
      ? `IV is ${Math.abs(volEdge * 100).toFixed(1)}% below reference vol — premium is cheap. Favorable for buying.`
      : "Market price is below theoretical value — option appears underpriced.";
  } else {
    label = "overpriced";
    note = volEdge != null && volEdge > 0
      ? `IV is ${(volEdge * 100).toFixed(1)}% above reference vol — premium is rich. Favorable for selling.`
      : "Market price is above theoretical value — option appears overpriced.";
  }

  return {
    theoreticalPrice,
    marketPrice,
    edge,
    edgePercent,
    impliedVol: iv,
    theoreticalVol: referenceVol,
    volEdge,
    label,
    note,
  };
}

// ---------------------------------------------------------------------------
// Fill Greeks gaps on a contract
// ---------------------------------------------------------------------------

/**
 * If a contract is missing Greeks or IV from the provider, compute them
 * using Black-Scholes (European) or binomial (American).
 * Returns a new Greeks object — only fills nulls, never overwrites provider values.
 */
export function fillMissingGreeks(
  contract: {
    strike: number;
    underlyingPrice: number;
    daysToExpiration: number;
    impliedVolatility: number | null;
    greeks: Greeks;
    optionType: OptionType;
    midpoint: number | null;
    bid: number | null;
    ask: number | null;
    last: number | null;
  },
  riskFreeRate: number = 0.05,
  dividendYield: number = 0,
): { greeks: Greeks; impliedVolatility: number | null; greeksProvenance: "provider" | "calculated" } {
  const T = contract.daysToExpiration / 365;
  const marketPrice = contract.midpoint ?? contract.last ?? (((contract.bid ?? 0) + (contract.ask ?? 0)) / 2 || 0);

  // Fill IV if missing
  let iv = contract.impliedVolatility;
  if (iv == null && marketPrice > 0 && T > 0) {
    iv = impliedVolatility(marketPrice, contract.underlyingPrice, contract.strike, T, riskFreeRate, contract.optionType, dividendYield);
  }

  const greeks = { ...contract.greeks };
  let anyFilled = false;

  // If any Greek is missing and we have IV, compute all from Black-Scholes
  const hasNulls = greeks.delta == null || greeks.gamma == null || greeks.theta == null || greeks.vega == null || greeks.rho == null;

  if (hasNulls && iv != null && iv > 0 && T > 0) {
    const bs = blackScholes({
      spot: contract.underlyingPrice,
      strike: contract.strike,
      timeToExpiry: T,
      riskFreeRate,
      volatility: iv,
      dividendYield,
      optionType: contract.optionType,
    });

    if (greeks.delta == null) { greeks.delta = bs.greeks.delta; anyFilled = true; }
    if (greeks.gamma == null) { greeks.gamma = bs.greeks.gamma; anyFilled = true; }
    if (greeks.theta == null) { greeks.theta = bs.greeks.theta; anyFilled = true; }
    if (greeks.vega == null) { greeks.vega = bs.greeks.vega; anyFilled = true; }
    if (greeks.rho == null) { greeks.rho = bs.greeks.rho; anyFilled = true; }
  }

  return {
    greeks,
    impliedVolatility: iv,
    greeksProvenance: anyFilled ? "calculated" : "provider",
  };
}
