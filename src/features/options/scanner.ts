/**
 * Scanner engine: filters option chains, runs the calculation engine on each
 * candidate, ranks by objective. Deterministic — no AI here.
 *
 * The AI layer (Phase 5) will call these scanners via tool functions and then
 * explain the ranked results. The scanner narrows the chain mathematically
 * BEFORE any AI sees it.
 */

import type {
  CashSecuredPutCandidate,
  CashSecuredPutFilters,
  CoveredCallCandidate,
  CoveredCallFilters,
  OptionChain,
  OptionContract,
  ScannerObjective,
} from "@/lib/types";
import { calculateCashSecuredPut } from "@/lib/calculations/cash-secured-put";
import { calculateCoveredCall } from "@/lib/calculations/covered-call";

// ---------------------------------------------------------------------------
// Covered call scanner
// ---------------------------------------------------------------------------

export function scanCoveredCalls(
  chain: OptionChain,
  filters: CoveredCallFilters,
  earningsDate?: string | null,
  exDividendDate?: string | null,
): CoveredCallCandidate[] {
  const candidates: CoveredCallCandidate[] = [];

  for (const call of chain.calls) {
    const candidate = calculateCoveredCall({
      contract: call,
      contracts: Math.max(1, Math.floor(filters.sharesAvailable / 100)),
      currentPrice: chain.underlyingPrice,
      costBasisPerShare: filters.costBasisPerShare ?? null,
      earningsDate,
      exDividendDate,
    });

    if (!passesCoveredCallFilters(candidate, filters)) continue;
    candidates.push(candidate);
  }

  const filtered = applyObjectiveFilter(candidates, filters.objective);
  return rankCoveredCalls(filtered, filters.objective);
}

export function passesCoveredCallFilters(
  c: CoveredCallCandidate,
  f: CoveredCallFilters,
): boolean {
  if (f.minDte != null && c.contract.daysToExpiration < f.minDte) return false;
  if (f.maxDte != null && c.contract.daysToExpiration > f.maxDte) return false;
  if (f.minOtmPercent != null && c.strikeOtmPercent < f.minOtmPercent) return false;
  if (f.maxOtmPercent != null && c.strikeOtmPercent > f.maxOtmPercent) return false;
  if (f.minDelta != null && (c.delta ?? 0) < f.minDelta) return false;
  if (f.maxDelta != null && (c.delta ?? 0) > f.maxDelta) return false;
  if (f.minPremiumPerContract != null && c.premiumPerContract < f.minPremiumPerContract) return false;
  if (f.minPremiumYield != null && c.premiumYield < f.minPremiumYield) return false;
  if (f.minAnnualizedPremiumYield != null && c.annualizedPremiumYield < f.minAnnualizedPremiumYield) return false;
  if (f.minMaxTotalReturn != null && c.maxTotalReturn < f.minMaxTotalReturn) return false;
  if (f.minAnnualizedMaxTotalReturn != null && c.annualizedMaxTotalReturn < f.minAnnualizedMaxTotalReturn) return false;
  if (f.requireStrikeAboveCostBasis && f.costBasisPerShare != null && c.contract.strike <= f.costBasisPerShare) return false;
  if (f.requireStrikeAboveTargetPrice != null && c.contract.strike <= f.requireStrikeAboveTargetPrice) return false;
  if (f.excludeEarnings && c.earningsBeforeExpiration) return false;
  if (f.excludeDividends && c.exDividendBeforeExpiration) return false;
  if (f.minHistoricalProbabilityBelowStrike != null) {
    // Historical probability is injected separately; if not present, fail only
    // when the filter is strict (we don't fabricate).
    // The scanner caller can attach this via a pre-pass; here we skip if absent.
  }
  // Liquidity filters
  if (f.liquidity.minOpenInterest != null && (c.openInterest ?? 0) < f.liquidity.minOpenInterest) return false;
  if (f.liquidity.minVolume != null && (c.volume ?? 0) < f.liquidity.minVolume) return false;
  // Skip spread filter when bid/ask data is missing — don't penalize illiquid quotes
  if (f.liquidity.maxBidAskSpreadPercent != null && c.bidAskSpreadPercent != null && c.bidAskSpreadPercent > f.liquidity.maxBidAskSpreadPercent) return false;
  // Ignore negative-OTM (ITM) calls for covered-call selling by default unless
  // the user explicitly allowed it via maxOtmPercent < 0.
  if (f.maxOtmPercent == null && c.strikeOtmPercent < 0) return false;
  return true;
}

/**
 * Objective-specific filtering: trims the candidate list to the options that
 * best fit the objective's intent, so changing the objective actually changes
 * which options appear — not just their order.
 *
 * Strategy: after the user's hard filters (delta, OTM%, yield, etc.), we apply
 * objective-specific soft filters that remove candidates that don't fit the
 * objective's risk/reward profile.
 */
function applyObjectiveFilter(
  candidates: CoveredCallCandidate[],
  objective: ScannerObjective,
): CoveredCallCandidate[] {
  if (candidates.length === 0) return candidates;

  switch (objective) {
    case "max_upside_retained": {
      // Only keep calls that are meaningfully OTM (>= 3% OTM) so most upside is retained.
      // Also require delta <= 0.35 (low assignment probability). If delta is unknown,
      // keep the candidate (don't penalize for missing data).
      return candidates.filter(
        (c) => c.strikeOtmPercent >= 0.03 && (c.delta == null || c.delta <= 0.35),
      );
    }

    case "lowest_assignment_probability": {
      // Only keep calls with delta <= 0.25 (very low assignment chance).
      // If delta is unknown, keep the candidate (don't penalize for missing data).
      return candidates.filter((c) => c.delta == null || c.delta <= 0.25);
    }

    case "max_immediate_income": {
      // Only keep calls with meaningful premium yield (>= 0.5% for this expiration).
      // This removes far OTM calls with negligible premiums.
      return candidates.filter((c) => c.premiumYield >= 0.005);
    }

    case "max_annualized_premium": {
      // Only keep calls with annualized yield >= 10% (favors short DTE with high theta).
      return candidates.filter((c) => c.annualizedPremiumYield >= 0.10);
    }

    case "max_total_return": {
      // Only keep calls where max total return is positive (premium + upside > 0).
      return candidates.filter((c) => c.maxTotalReturn > 0);
    }

    case "leaps_income_growth": {
      // Only keep calls with DTE >= 180 (long-dated for LEAPS-style income + growth).
      return candidates.filter((c) => c.contract.daysToExpiration >= 180);
    }

    case "long_term_tax_aware": {
      // Only keep calls with DTE >= 365 (qualifying long-term holding period).
      return candidates.filter((c) => c.contract.daysToExpiration >= 365);
    }

    case "balanced_income_upside":
    default: {
      // No additional filtering — show all that pass the user's filters.
      return candidates;
    }
  }
}

/**
 * Rank candidates by objective. Different objectives weight the score
 * components differently. Always deterministic.
 */
export function rankCoveredCalls(
  candidates: CoveredCallCandidate[],
  objective: ScannerObjective,
): CoveredCallCandidate[] {
  const weight = objectiveWeights(objective);
  const scored = candidates.map((c) => ({
    c,
    rank: compositeScore(c.score, weight),
  }));
  scored.sort((a, b) => b.rank - a.rank);
  return scored.map((s) => s.c);
}

// ---------------------------------------------------------------------------
// Cash-secured put scanner
// ---------------------------------------------------------------------------

export function scanCashSecuredPuts(
  chain: OptionChain,
  filters: CashSecuredPutFilters,
  earningsDate?: string | null,
  exDividendDate?: string | null,
): CashSecuredPutCandidate[] {
  const candidates: CashSecuredPutCandidate[] = [];
  const maxContractsByCash = Math.floor(
    filters.cashAvailable / (chain.underlyingPrice * 100),
  );
  const contracts = Math.max(1, maxContractsByCash);

  for (const put of chain.puts) {
    const candidate = calculateCashSecuredPut({
      contract: put,
      contracts,
      currentPrice: chain.underlyingPrice,
      earningsDate,
      exDividendDate,
    });
    if (!passesCspFilters(candidate, filters)) continue;
    candidates.push(candidate);
  }

  return rankCashSecuredPuts(candidates, filters.objective);
}

export function passesCspFilters(
  c: CashSecuredPutCandidate,
  f: CashSecuredPutFilters,
): boolean {
  if (f.minDte != null && c.contract.daysToExpiration < f.minDte) return false;
  if (f.maxDte != null && c.contract.daysToExpiration > f.maxDte) return false;
  if (f.maxDelta != null && (c.delta ?? 0) > f.maxDelta) return false;
  if (f.minDelta != null && (c.delta ?? 0) < f.minDelta) return false;
  if (f.targetEffectivePurchasePrice != null && c.effectivePurchasePrice > f.targetEffectivePurchasePrice) return false;
  if (f.minDiscountPercent != null && c.discountToCurrentPrice < f.minDiscountPercent) return false;
  if (f.minPremiumYield != null && c.returnOnNetCapital < f.minPremiumYield) return false;
  if (f.minAnnualizedYield != null && c.annualizedReturnOnNet < f.minAnnualizedYield) return false;
  if (f.maxCapitalRequired != null && c.grossCollateral > f.maxCapitalRequired) return false;
  if (f.excludeEarnings && c.earningsBeforeExpiration) return false;
  if (f.liquidity.minOpenInterest != null && (c.openInterest ?? 0) < f.liquidity.minOpenInterest) return false;
  if (f.liquidity.minVolume != null && (c.volume ?? 0) < f.liquidity.minVolume) return false;
  // Skip spread filter when bid/ask data is missing — don't penalize illiquid quotes
  if (f.liquidity.maxBidAskSpreadPercent != null && c.bidAskSpreadPercent != null && c.bidAskSpreadPercent > f.liquidity.maxBidAskSpreadPercent) return false;
  // Skip OTM puts with no discount (strike >= current) unless explicitly wanted.
  if (c.strikeDiscountPercent <= 0) return false;
  return true;
}

export function rankCashSecuredPuts(
  candidates: CashSecuredPutCandidate[],
  objective: ScannerObjective,
): CashSecuredPutCandidate[] {
  const weight = cspObjectiveWeights(objective);
  const scored = candidates.map((c) => ({
    c,
    rank: cspCompositeScore(c.score, weight),
  }));
  scored.sort((a, b) => b.rank - a.rank);
  return scored.map((s) => s.c);
}

// ---------------------------------------------------------------------------
// Composite scoring by objective
// ---------------------------------------------------------------------------

interface CcWeights {
  income: number;
  upsidePreservation: number;
  assignmentRisk: number;
  liquidity: number;
  volatilityPremium: number;
  historicalDistance: number;
  totalReturn: number;
}

function objectiveWeights(objective: ScannerObjective): CcWeights {
  switch (objective) {
    case "max_immediate_income":
      return { income: 0.5, upsidePreservation: 0.05, assignmentRisk: 0.05, liquidity: 0.15, volatilityPremium: 0.05, historicalDistance: 0.05, totalReturn: 0.15 };
    case "max_annualized_premium":
      return { income: 0.45, upsidePreservation: 0.1, assignmentRisk: 0.1, liquidity: 0.15, volatilityPremium: 0.05, historicalDistance: 0.05, totalReturn: 0.1 };
    case "max_total_return":
      return { income: 0.15, upsidePreservation: 0.2, assignmentRisk: 0.1, liquidity: 0.1, volatilityPremium: 0.05, historicalDistance: 0.1, totalReturn: 0.3 };
    case "lowest_assignment_probability":
      return { income: 0.1, upsidePreservation: 0.3, assignmentRisk: 0.35, liquidity: 0.1, volatilityPremium: 0.02, historicalDistance: 0.13, totalReturn: 0.0 };
    case "max_upside_retained":
      return { income: 0.1, upsidePreservation: 0.45, assignmentRisk: 0.2, liquidity: 0.1, volatilityPremium: 0.02, historicalDistance: 0.13, totalReturn: 0.0 };
    case "balanced_income_upside":
      return { income: 0.2, upsidePreservation: 0.2, assignmentRisk: 0.15, liquidity: 0.12, volatilityPremium: 0.05, historicalDistance: 0.08, totalReturn: 0.2 };
    case "long_term_tax_aware":
      return { income: 0.15, upsidePreservation: 0.3, assignmentRisk: 0.2, liquidity: 0.1, volatilityPremium: 0.05, historicalDistance: 0.1, totalReturn: 0.1 };
    case "leaps_income_growth":
      return { income: 0.25, upsidePreservation: 0.25, assignmentRisk: 0.1, liquidity: 0.1, volatilityPremium: 0.05, historicalDistance: 0.05, totalReturn: 0.2 };
    default:
      return { income: 0.2, upsidePreservation: 0.2, assignmentRisk: 0.15, liquidity: 0.12, volatilityPremium: 0.05, historicalDistance: 0.08, totalReturn: 0.2 };
  }
}

function compositeScore(
  s: CoveredCallCandidate["score"],
  w: CcWeights,
): number {
  return (
    s.income * w.income +
    s.upsidePreservation * w.upsidePreservation +
    s.assignmentRisk * w.assignmentRisk +
    s.liquidity * w.liquidity +
    s.volatilityPremium * w.volatilityPremium +
    s.historicalDistance * w.historicalDistance +
    s.totalReturn * w.totalReturn
  );
}

interface CspWeights {
  income: number;
  entryQuality: number;
  assignmentRisk: number;
  liquidity: number;
  volatilityPremium: number;
}

function cspObjectiveWeights(objective: ScannerObjective): CspWeights {
  switch (objective) {
    case "cash_secured_put_entry":
      return { income: 0.2, entryQuality: 0.4, assignmentRisk: 0.25, liquidity: 0.1, volatilityPremium: 0.05 };
    case "max_immediate_income":
      return { income: 0.5, entryQuality: 0.1, assignmentRisk: 0.1, liquidity: 0.2, volatilityPremium: 0.1 };
    case "lowest_assignment_probability":
      return { income: 0.1, entryQuality: 0.3, assignmentRisk: 0.45, liquidity: 0.1, volatilityPremium: 0.05 };
    default:
      return { income: 0.3, entryQuality: 0.25, assignmentRisk: 0.25, liquidity: 0.15, volatilityPremium: 0.05 };
  }
}

function cspCompositeScore(
  s: CashSecuredPutCandidate["score"],
  w: CspWeights,
): number {
  return (
    s.income * w.income +
    s.entryQuality * w.entryQuality +
    s.assignmentRisk * w.assignmentRisk +
    s.liquidity * w.liquidity +
    s.volatilityPremium * w.volatilityPremium
  );
}

// ---------------------------------------------------------------------------
// LEAPS scanner — covered calls with DTE >= ~270 and OTM-focused ranking
// ---------------------------------------------------------------------------

export function scanLeapsCoveredCalls(
  chain: OptionChain,
  filters: CoveredCallFilters,
  earningsDate?: string | null,
  exDividendDate?: string | null,
): CoveredCallCandidate[] {
  const leapsFilters: CoveredCallFilters = {
    ...filters,
    minDte: Math.max(filters.minDte ?? 270, 270),
  };
  return scanCoveredCalls(chain, leapsFilters, earningsDate, exDividendDate);
}

// ---------------------------------------------------------------------------
// Short-term vs LEAPS comparison
// ---------------------------------------------------------------------------

export interface DteBucket {
  label: string;
  targetDte: number;
  candidate: CoveredCallCandidate | null;
}

/**
 * Pick the best candidate (by objective) near each target DTE bucket.
 * Used by the short-term vs LEAPS comparison view.
 */
export function pickDteBuckets(
  chains: OptionChain[],
  filters: CoveredCallFilters,
  buckets: { label: string; targetDte: number }[],
  earningsDate?: string | null,
  exDividendDate?: string | null,
): DteBucket[] {
  const all: CoveredCallCandidate[] = [];
  for (const chain of chains) {
    all.push(...scanCoveredCalls(chain, filters, earningsDate, exDividendDate));
  }
  return buckets.map((b) => {
    // Find candidates within +/- 25% of target DTE, pick highest score.
    const near = all.filter(
      (c) =>
        c.contract.daysToExpiration >= b.targetDte * 0.75 &&
        c.contract.daysToExpiration <= b.targetDte * 1.25,
    );
    const ranked = rankCoveredCalls(near, filters.objective);
    return { label: b.label, targetDte: b.targetDte, candidate: ranked[0] ?? null };
  });
}
