/**
 * Monte Carlo simulation: covered-call strategy vs buy-and-hold.
 *
 * Uses historical daily returns to bootstrap a return distribution, then
 * simulates N paths over a horizon. For each path, models:
 *   - Buy-and-hold: hold shares for the full horizon.
 *   - Covered call: sell a call at the start of each period at the given
 *     strike-offset and DTE; if the path ends above the strike at expiration,
 *     shares are called away at the strike (and we re-buy at market for the
 *     next period — modeling the wheel-like continuity).
 *
 * Deterministic given the RNG seed. Returns distribution statistics, NOT
 * predictions. The UI labels this explicitly.
 */

import type { HistoricalPricePoint } from "@/lib/types";

export interface MonteCarloConfig {
  paths: number;
  horizonDays: number;
  periodDte: number; // covered-call period length
  strikeOtmPercent: number; // strike = spot * (1 + otmPercent) at each sale
  premiumYieldPerPeriod: number; // premium per period as fraction of spot (estimated)
  initialPrice: number;
  seed?: number;
}

export interface MonteCarloResult {
  paths: number;
  horizonDays: number;
  buyAndHold: {
    meanFinalValue: number;
    medianFinalValue: number;
    p5: number;
    p25: number;
    p75: number;
    p95: number;
    meanReturn: number;
    probPositive: number;
  };
  coveredCall: {
    meanFinalValue: number;
    medianFinalValue: number;
    p5: number;
    p25: number;
    p75: number;
    p95: number;
    meanReturn: number;
    probPositive: number;
    meanPremiumIncome: number;
    meanTimesAssigned: number;
  };
  comparison: {
    meanExcessReturn: number; // CC - B&H
    probCCBeatsBH: number;
    note: string;
  };
  warnings: string[];
}

export function runMonteCarlo(
  historical: HistoricalPricePoint[],
  config: MonteCarloConfig,
): MonteCarloResult {
  const warnings: string[] = [];
  if (historical.length < 60) {
    warnings.push("Insufficient history for Monte Carlo (need 60+ days).");
  }

  // Build empirical daily log-return distribution.
  const logReturns: number[] = [];
  for (let i = 1; i < historical.length; i++) {
    const cur = historical[i];
    const prev = historical[i - 1];
    if (!cur || !prev) continue;
    const r = Math.log(cur.adjustedClose / prev.adjustedClose);
    if (Number.isFinite(r)) logReturns.push(r);
  }
  if (logReturns.length < 30) {
    warnings.push("Not enough valid return observations.");
  }

  const rng = mulberry32(config.seed ?? 42);
  const periods = Math.max(1, Math.floor(config.horizonDays / config.periodDte));
  const bhFinals: number[] = [];
  const ccFinals: number[] = [];
  const ccPremiums: number[] = [];
  const ccAssignments: number[] = [];
  const excessReturns: number[] = [];

  for (let p = 0; p < config.paths; p++) {
    let bhPrice = config.initialPrice;
    let ccPrice = config.initialPrice;
    let ccCash = 0;
    let assignments = 0;

    for (let per = 0; per < periods; per++) {
      // Simulate periodDte days.
      const periodReturns: number[] = [];
      for (let d = 0; d < config.periodDte; d++) {
        const r = logReturns.length > 0 ? (logReturns[Math.floor(rng() * logReturns.length)] ?? 0) : 0;
        periodReturns.push(r);
        bhPrice *= Math.exp(r);
      }
      const periodEndBH = bhPrice;

      // Covered call: strike set at start of period.
      const strike = ccPrice * (1 + config.strikeOtmPercent);
      const premium = ccPrice * config.premiumYieldPerPeriod;
      ccCash += premium;

      // Apply the same period returns to ccPrice.
      let ccEnd = ccPrice;
      for (const r of periodReturns) ccEnd *= Math.exp(r);

      if (ccEnd >= strike) {
        // Assigned: shares called away at strike; re-buy at market for continuity.
        ccCash += strike - ccEnd; // net: receive strike, pay market to re-buy
        ccPrice = ccEnd;
        assignments++;
      } else {
        ccPrice = ccEnd;
      }
      void periodEndBH;
    }

    const bhFinal = bhPrice;
    const ccFinal = ccPrice + ccCash;
    bhFinals.push(bhFinal);
    ccFinals.push(ccFinal);
    ccPremiums.push(ccCash);
    ccAssignments.push(assignments);
    excessReturns.push((ccFinal - config.initialPrice) / config.initialPrice - (bhFinal - config.initialPrice) / config.initialPrice);
  }

  return {
    paths: config.paths,
    horizonDays: config.horizonDays,
    buyAndHold: summarize(bhFinals, config.initialPrice),
    coveredCall: {
      ...summarize(ccFinals, config.initialPrice),
      meanPremiumIncome: mean(ccPremiums),
      meanTimesAssigned: mean(ccAssignments),
    },
    comparison: {
      meanExcessReturn: mean(excessReturns),
      probCCBeatsBH: excessReturns.filter((r) => r > 0).length / excessReturns.length,
      note: "Simulated from historical return bootstrap. NOT a prediction. Past performance does not guarantee future results.",
    },
    warnings,
  };
}

function summarize(finals: number[], initial: number): Omit<MonteCarloResult["buyAndHold"], never> {
  const sorted = [...finals].sort((a, b) => a - b);
  const returns = finals.map((f) => (f - initial) / initial);
  return {
    meanFinalValue: mean(finals),
    medianFinalValue: percentile(sorted, 0.5),
    p5: percentile(sorted, 0.05),
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
    p95: percentile(sorted, 0.95),
    meanReturn: mean(returns),
    probPositive: returns.filter((r) => r > 0).length / returns.length,
  };
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[idx] ?? 0;
}

// Seeded RNG (mulberry32) for reproducibility.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
