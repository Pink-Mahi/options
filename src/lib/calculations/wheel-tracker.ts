/**
 * Wheel cycle tracking — follows the CSP → assignment → CC → called away loop.
 *
 * The wheel strategy cycles between:
 * 1. Sell cash-secured puts → collect premium
 * 2. If assigned → hold shares
 * 3. Sell covered calls against shares → collect premium
 * 4. If called away → return to step 1
 *
 * This module tracks the cycle state, computes per-cycle performance, and
 * provides projections for annualized income.
 *
 * All functions are PURE and DETERMINISTIC. Unit-tested in ./wheel-tracker.test.ts.
 */

export type WheelPhase = "PUT" | "HOLDING" | "CALL" | "CASH";

export interface WheelCycle {
  cycleNumber: number;
  phase: WheelPhase;
  startDate: string;
  endDate: string | null;
  symbol: string;
  strike: number;
  premium: number;
  contracts: number;
  outcome: "EXPIRED_WORTHLESS" | "ASSIGNED" | "CALLED_AWAY" | "OPEN" | "ROLLED";
  pnl: number;
  sharesHeldAfter: number;
}

export interface WheelSummary {
  symbol: string;
  totalCycles: number;
  completedCycles: number;
  currentPhase: WheelPhase;
  totalPremium: number;
  totalPnl: number;
  assignmentCount: number;
  calledAwayCount: number;
  expiredWorthlessCount: number;
  avgPremiumPerCycle: number;
  avgCycleDays: number;
  annualizedIncomeEstimate: number;
  cyclesPerYearEstimate: number;
  currentSharesHeld: number;
  cycleHistory: WheelCycle[];
}

/**
 * Build a wheel summary from a list of cycle records.
 */
export function buildWheelSummary(cycles: WheelCycle[]): WheelSummary | null {
  if (cycles.length === 0) return null;

  const symbol = cycles[0]?.symbol ?? "";
  const completed = cycles.filter((c) => c.outcome !== "OPEN");
  const totalPremium = cycles.reduce((s, c) => s + c.premium, 0);
  const totalPnl = cycles.reduce((s, c) => s + c.pnl, 0);
  const assignmentCount = cycles.filter((c) => c.outcome === "ASSIGNED").length;
  const calledAwayCount = cycles.filter((c) => c.outcome === "CALLED_AWAY").length;
  const expiredWorthlessCount = cycles.filter((c) => c.outcome === "EXPIRED_WORTHLESS").length;

  const lastCycle = cycles[cycles.length - 1];
  const currentPhase = lastCycle?.phase ?? "CASH";
  const currentSharesHeld = lastCycle?.sharesHeldAfter ?? 0;

  // Estimate cycle length from completed cycles
  const cycleDays: number[] = [];
  for (const c of completed) {
    if (c.startDate && c.endDate) {
      const days = (new Date(c.endDate).getTime() - new Date(c.startDate).getTime()) / (1000 * 60 * 60 * 24);
      if (days > 0) cycleDays.push(days);
    }
  }
  const avgCycleDays = cycleDays.length > 0 ? cycleDays.reduce((s, d) => s + d, 0) / cycleDays.length : 30;
  const cyclesPerYearEstimate = 365 / avgCycleDays;
  const avgPremiumPerCycle = cycles.length > 0 ? totalPremium / cycles.length : 0;
  const annualizedIncomeEstimate = avgPremiumPerCycle * cyclesPerYearEstimate;

  return {
    symbol,
    totalCycles: cycles.length,
    completedCycles: completed.length,
    currentPhase,
    totalPremium,
    totalPnl,
    assignmentCount,
    calledAwayCount,
    expiredWorthlessCount,
    avgPremiumPerCycle,
    avgCycleDays,
    annualizedIncomeEstimate,
    cyclesPerYearEstimate,
    currentSharesHeld,
    cycleHistory: cycles,
  };
}

/**
 * Determine the next phase of the wheel after a cycle completes.
 */
export function nextWheelPhase(current: WheelPhase, outcome: "EXPIRED_WORTHLESS" | "ASSIGNED" | "CALLED_AWAY"): WheelPhase {
  if (current === "PUT") {
    if (outcome === "ASSIGNED") return "HOLDING";
    return "PUT"; // stay in put phase if expired worthless
  }
  if (current === "HOLDING") {
    return "CALL";
  }
  if (current === "CALL") {
    if (outcome === "CALLED_AWAY") return "CASH";
    return "CALL"; // stay in call phase if expired worthless
  }
  if (current === "CASH") {
    return "PUT";
  }
  return "PUT";
}
