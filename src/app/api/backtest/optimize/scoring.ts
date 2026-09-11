/**
 * Phase 3: Normalized composite scoring for the optimizer.
 *
 * Extracted from the route file so it can be unit-tested and so the route
 * file only exports HTTP methods (required by Next.js App Router type checking).
 */

import { deflatedSharpeRatio } from "@/lib/quant/statistics";

export interface OptimizeResult {
  strategy: string;
  dte: number;
  buyBackPct: number;
  deltaTarget: number;
  minCallYieldPct: number;
  minPutYieldPct: number;
  neverBelowCost: boolean;
  averageDown: boolean;
  rollOnAssignment: boolean;
  strategyReturn: number;
  annualizedReturn: number;
  buyHoldReturn: number;
  outperformance: number;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  calmarRatio: number | null;
  maxDrawdown: number;
  totalPremiumIncome: number;
  winRate: number;
  totalCycles: number;
  assignmentCount: number;
  earlyCloseCount: number;
  avgPremiumPerCycle: number;
  realDataCycles: number;
  bsModelCycles: number;
  compositeScore: number;
  avgMonthlyIncome: number;
  interestIncome: number;
  totalCommissions: number;
  returnOnCapitalDeployed: number | null;
  capitalUtilization: number;
  monthlyIncomeStdDev: number;
  zeroIncomeMonths: number;
  worstCyclePnl: number;
  worstMonthPnl: number;
  daysUnderwater: number;
  /** Phase 3: deflated Sharpe for the winner (null for non-winners). */
  deflatedSharpe: number | null;
  /** Phase 3: deflated Sharpe verdict label. */
  deflatedSharpeVerdict: string | null;
  /** Phase 3: number of trials used for deflated Sharpe. */
  trials: number;
  /** Phase 4: walk-forward OOS annualized return. */
  oosAnnualizedReturn?: number;
  /** Phase 4: IS/OOS return gap. */
  isOosGap?: number;
  /** Phase 4: OOS consistency (fraction of positive folds). */
  oosConsistency?: number;
  /** Phase 4: parameter stability score (0–1). */
  stabilityScore?: number;
  /** Phase 4: composite robustness score. */
  robustnessScore?: number;
}

export type OptimizeGoal = "cash_flow" | "balanced" | "long_term_gains";

/** Minimum cycles required for a candidate to be ranked. */
export const MIN_CYCLES = 12;

export interface ScoringMetric {
  key: string;
  /** Extract the raw value from a result. */
  value: (r: OptimizeResult) => number;
  /** Whether higher is better (true) or lower is better (false). */
  higherIsBetter: boolean;
  /** Weight in the balanced goal. */
  balancedWeight: number;
  /** Weight in the cash_flow goal. */
  cashFlowWeight: number;
  /** Weight in the long_term_gains goal. */
  longTermWeight: number;
}

const METRICS: ScoringMetric[] = [
  {
    key: "annualizedReturn",
    value: (r) => r.annualizedReturn,
    higherIsBetter: true,
    balancedWeight: 0.25,
    cashFlowWeight: 0.25,
    longTermWeight: 0.20,
  },
  {
    key: "sharpe",
    value: (r) => r.sharpeRatio ?? -10,
    higherIsBetter: true,
    balancedWeight: 0.20,
    cashFlowWeight: 0.15,
    longTermWeight: 0.15,
  },
  {
    key: "sortino",
    value: (r) => r.sortinoRatio ?? -10,
    higherIsBetter: true,
    balancedWeight: 0.15,
    cashFlowWeight: 0.10,
    longTermWeight: 0.10,
  },
  {
    key: "calmar",
    value: (r) => r.calmarRatio ?? -10,
    higherIsBetter: true,
    balancedWeight: 0.10,
    cashFlowWeight: 0.05,
    longTermWeight: 0.10,
  },
  {
    key: "outperformance",
    value: (r) => r.outperformance,
    higherIsBetter: true,
    balancedWeight: 0.10,
    cashFlowWeight: 0.05,
    longTermWeight: 0.15,
  },
  {
    key: "incomeConsistency",
    value: (r) => {
      const avg = r.avgMonthlyIncome;
      const std = r.monthlyIncomeStdDev;
      if (avg <= 0) return -10;
      return avg / (std + 1);
    },
    higherIsBetter: true,
    balancedWeight: 0.10,
    cashFlowWeight: 0.25,
    longTermWeight: 0.05,
  },
  {
    key: "capitalUtilization",
    value: (r) => r.capitalUtilization,
    higherIsBetter: true,
    balancedWeight: 0.05,
    cashFlowWeight: 0.10,
    longTermWeight: 0.05,
  },
  {
    key: "returnOnCapital",
    value: (r) => r.returnOnCapitalDeployed ?? -10,
    higherIsBetter: true,
    balancedWeight: 0.05,
    cashFlowWeight: 0.05,
    longTermWeight: 0.10,
  },
];

/**
 * Compute normalized composite scores for a set of results.
 * Uses percentile ranking (0 = worst, 1 = best) for each metric, then
 * applies goal-based weights. This is robust to outliers and unit-free.
 */
export function computeNormalizedScores(
  results: OptimizeResult[],
  riskTolerance: number,
  goal: OptimizeGoal,
): void {
  if (results.length === 0) return;

  const eligible = results.filter((r) => r.totalCycles >= MIN_CYCLES);

  for (const r of results) {
    if (r.totalCycles < MIN_CYCLES) {
      r.compositeScore = -1000 + r.totalCycles;
      continue;
    }

    let score = 0;
    for (const metric of METRICS) {
      const weight = goal === "cash_flow"
        ? metric.cashFlowWeight
        : goal === "long_term_gains"
          ? metric.longTermWeight
          : metric.balancedWeight;

      if (weight === 0) continue;

      const values = eligible.map((e) => metric.value(e));
      const v = metric.value(r);
      let rank = 0;
      for (const other of values) {
        if (metric.higherIsBetter) {
          if (v > other) rank++;
          else if (v === other) rank += 0.5;
        } else {
          if (v < other) rank++;
          else if (v === other) rank += 0.5;
        }
      }
      const percentile = values.length > 1 ? rank / (values.length - 1) : 0.5;
      score += percentile * weight;
    }

    const dd = Math.abs(r.maxDrawdown);
    const ddPenalty = dd * (riskTolerance <= 0.5 ? 0.15 : riskTolerance <= 1.5 ? 0.08 : 0.03);
    score -= ddPenalty;

    if (goal === "cash_flow" && r.zeroIncomeMonths > 0) {
      score -= r.zeroIncomeMonths * 0.02;
    }

    if (riskTolerance <= 0.5 && r.daysUnderwater > 50) {
      score -= 0.05;
    }

    r.compositeScore = score;
  }
}

/**
 * Apply deflated Sharpe ratio to the top candidates to detect overfitting.
 */
export function applyDeflatedSharpe(
  results: OptimizeResult[],
  dailyReturns: Map<string, number[]>,
  periodsPerYear: number,
): void {
  if (results.length === 0) return;

  const allTrialSharpes = results
    .map((r) => r.sharpeRatio)
    .filter((s): s is number => s != null && Number.isFinite(s));

  if (allTrialSharpes.length < 2) return;

  const top = results.slice(0, 5);
  for (const r of top) {
    const returns = dailyReturns.get(`${r.strategy}-${r.dte}-${r.buyBackPct}-${r.deltaTarget}`);
    if (!returns || returns.length < 10) {
      r.deflatedSharpe = null;
      r.deflatedSharpeVerdict = "insufficient_data";
      r.trials = allTrialSharpes.length;
      continue;
    }

    const dsr = deflatedSharpeRatio(returns, allTrialSharpes, periodsPerYear);
    r.deflatedSharpe = dsr.deflatedSharpe;
    r.deflatedSharpeVerdict = dsr.verdict;
    r.trials = allTrialSharpes.length;

    if (dsr.verdict === "likely_overfit") {
      r.compositeScore *= 0.7;
    } else if (dsr.verdict === "inconclusive") {
      r.compositeScore *= 0.9;
    }
  }
}
