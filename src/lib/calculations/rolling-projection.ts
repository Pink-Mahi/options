/**
 * Rolling income projection.
 *
 * Projects what happens if you sell a covered call at a given strike-offset
 * and DTE, repeatedly, for a full year. Uses historical returns to estimate:
 *   - How often you'd be assigned (stock above strike at expiration)
 *   - Total premium income over the year
 *   - Total return (premium + stock appreciation up to the strike cap)
 *   - Effective annual yield
 *
 * This is a HISTORICAL projection, not a prediction. It assumes the future
 * resembles the past and that similar premium opportunities persist.
 */

import type { HistoricalPricePoint } from "@/lib/types";

export interface RollingProjectionConfig {
  periodDte: number;
  strikeOtmPercent: number; // strike = spot * (1 + otmPercent)
  premiumYieldPerPeriod: number; // fraction of spot
  periodsPerYear: number; // typically 365 / periodDte
}

export interface RollingProjection {
  periodsAnalyzed: number;
  periodsPerYear: number;
  assignmentRate: number; // fraction of periods where stock was above strike
  avgPeriodReturn: number; // avg per-period total return (premium + capped appreciation)
  projectedAnnualPremiumIncome: number; // as fraction of initial capital
  projectedAnnualTotalReturn: number; // premium + capped appreciation, annualized
  projectedAnnualUncappedReturn: number; // buy-and-hold comparison
  incomeCaptureEfficiency: number; // how much of buy-and-hold return you captured
  distribution: {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  };
  warnings: string[];
}

export function projectRollingIncome(
  historical: HistoricalPricePoint[],
  config: RollingProjectionConfig,
): RollingProjection | null {
  const warnings: string[] = [];
  if (historical.length < config.periodDte * 4) {
    warnings.push(`Insufficient history for ${config.periodDte}-day rolling projection (need ${config.periodDte * 4}+ days).`);
  }

  const periodReturns: number[] = [];
  const uncappedReturns: number[] = [];
  let assignments = 0;
  let totalPeriods = 0;

  // Slide a window of periodDte across history.
  for (let i = config.periodDte; i < historical.length; i++) {
    const start = historical[i - config.periodDte];
    const end = historical[i];
    if (!start || !end) continue;

    const startPrice = start.adjustedClose;
    const endPrice = end.adjustedClose;
    const rawReturn = (endPrice - startPrice) / startPrice;
    const strike = startPrice * (1 + config.strikeOtmPercent);
    const cappedAppreciation = Math.max(0, Math.min(rawReturn, config.strikeOtmPercent));
    const periodTotalReturn = config.premiumYieldPerPeriod + cappedAppreciation;

    periodReturns.push(periodTotalReturn);
    uncappedReturns.push(rawReturn);
    if (endPrice > strike) assignments++;
    totalPeriods++;
  }

  if (totalPeriods < 10) {
    return {
      periodsAnalyzed: totalPeriods,
      periodsPerYear: config.periodsPerYear,
      assignmentRate: 0,
      avgPeriodReturn: 0,
      projectedAnnualPremiumIncome: 0,
      projectedAnnualTotalReturn: 0,
      projectedAnnualUncappedReturn: 0,
      incomeCaptureEfficiency: 0,
      distribution: { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 },
      warnings: [...warnings, "Not enough overlapping periods for a meaningful projection."],
    };
  }

  const assignmentRate = assignments / totalPeriods;
  const avgPeriodReturn = mean(periodReturns);
  const avgUncapped = mean(uncappedReturns);

  // Annualize: compound the average period return.
  const projectedAnnualTotalReturn = Math.pow(1 + avgPeriodReturn, config.periodsPerYear) - 1;
  const projectedAnnualPremiumIncome = config.premiumYieldPerPeriod * config.periodsPerYear;
  const projectedAnnualUncappedReturn = Math.pow(1 + avgUncapped, config.periodsPerYear) - 1;

  const incomeCaptureEfficiency = projectedAnnualUncappedReturn !== 0
    ? projectedAnnualTotalReturn / projectedAnnualUncappedReturn
    : 0;

  const sorted = [...periodReturns].sort((a, b) => a - b);

  return {
    periodsAnalyzed: totalPeriods,
    periodsPerYear: config.periodsPerYear,
    assignmentRate,
    avgPeriodReturn,
    projectedAnnualPremiumIncome,
    projectedAnnualTotalReturn,
    projectedAnnualUncappedReturn,
    incomeCaptureEfficiency,
    distribution: {
      p10: percentile(sorted, 0.1),
      p25: percentile(sorted, 0.25),
      p50: percentile(sorted, 0.5),
      p75: percentile(sorted, 0.75),
      p90: percentile(sorted, 0.9),
    },
    warnings,
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
