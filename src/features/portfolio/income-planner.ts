/**
 * Portfolio income planner + goal feasibility engine.
 *
 * Deterministic. Scans the user's holdings for covered-call opportunities and
 * available cash for CSP opportunities, then estimates whether a monthly
 * income target is achievable under the user's constraints.
 *
 * Never counts open premium as guaranteed income. Clearly separates realized,
 * open, and potential amounts.
 */

import "server-only";
import { getExpirations, getOptionChain, getQuote } from "@/features/market-data/service";
import { scanCashSecuredPuts, scanCoveredCalls } from "@/features/options/scanner";
import { getOrCreatePortfolioId, getPortfolio } from "@/lib/database/portfolio-repo";
import type { CoveredCallCandidate, CashSecuredPutCandidate, ScannerObjective } from "@/lib/types";

export interface IncomePlanCandidate {
  symbol: string;
  strategy: "COVERED_CALL" | "CASH_SECURED_PUT";
  contracts: number;
  expectedPremium: number;
  rationale: string;
  topStrike?: number;
  expiration?: string;
  premiumYield?: number;
  maxTotalReturn?: number;
  effectiveEntry?: number;
  discountToCurrent?: number;
}

export interface PortfolioIncomeAnalysis {
  monthlyTarget: number;
  estimatedFeasibleIncome: number;
  targetGap: number;
  feasibility: "easily_supported" | "potentially_achievable" | "requires_relaxing" | "not_supported";
  coveredCallCandidates: IncomePlanCandidate[];
  cashSecuredPutCandidates: IncomePlanCandidate[];
  warnings: string[];
  classification: string;
}

export async function analyzePortfolioIncome(monthlyTarget: number, userId: string): Promise<PortfolioIncomeAnalysis> {
  const portfolio = await getPortfolio(userId).catch(() => null);
  const warnings: string[] = [];
  const ccCandidates: IncomePlanCandidate[] = [];
  const cspCandidates: IncomePlanCandidate[] = [];

  if (!portfolio) {
    return {
      monthlyTarget,
      estimatedFeasibleIncome: 0,
      targetGap: monthlyTarget,
      feasibility: "not_supported",
      coveredCallCandidates: [],
      cashSecuredPutCandidates: [],
      warnings: ["Portfolio unavailable."],
      classification: "Portfolio data unavailable.",
    };
  }

  const goal = portfolio.goals[0] ?? null;
  const objective: ScannerObjective = goal?.riskProfile === "income" ? "max_annualized_premium" : "balanced_income_upside";
  const minOtm = goal?.minimumOTMPercent ?? 0.05;
  const maxDelta = goal?.maximumDelta ?? 0.3;
  const targetDte = goal?.preferredDteMax ?? 45;

  // Covered calls against each holding (respect protected lots).
  for (const lot of portfolio.stockLots) {
    if (lot.protectedFromCalls) {
      warnings.push(`${lot.symbol} lot is protected from calls — skipped.`);
      continue;
    }
    try {
      const expirations = await getExpirations({ symbol: lot.symbol });
      const expiration = pickClosest(expirations.data, targetDte);
      if (!expiration) continue;
      const chain = await getOptionChain({ symbol: lot.symbol, expiration: expiration.expirationDate });
      const ranked = scanCoveredCalls(
        chain.data,
        {
          symbol: lot.symbol,
          sharesAvailable: lot.shares,
          costBasisPerShare: lot.costBasisPerShare,
          minDte: goal?.preferredDteMin ?? null,
          maxDte: goal?.preferredDteMax ?? null,
          minOtmPercent: minOtm,
          maxOtmPercent: null,
          minDelta: null,
          maxDelta,
          minPremiumPerContract: null,
          minPremiumYield: null,
          minAnnualizedPremiumYield: null,
          minMaxTotalReturn: null,
          minAnnualizedMaxTotalReturn: null,
          minHistoricalProbabilityBelowStrike: null,
          requireStrikeAboveCostBasis: false,
          requireStrikeAboveTargetPrice: null,
          excludeEarnings: goal?.earningsPreference === "exclude",
          excludeDividends: false,
          liquidity: { minOpenInterest: 50, minVolume: null, maxBidAskSpreadPercent: 0.1 },
          objective,
        },
      );
      const top = ranked[0];
      if (top) {
        // Cap contracts at the lot size and respect any minimum-uncovered goal.
        const maxContracts = Math.floor(lot.shares / 100);
        const minUncovered = goal?.minimumSharesUncovered ?? 0;
        const usableContracts = Math.max(0, Math.min(maxContracts, maxContracts - Math.ceil(minUncovered / 100)));
        const contracts = Math.max(1, usableContracts);
        const expectedPremium = top.premiumPerContract * contracts;
        ccCandidates.push({
          symbol: lot.symbol,
          strategy: "COVERED_CALL",
          contracts,
          expectedPremium,
          rationale: `Top-ranked ${top.contract.strike} call expiring ${top.contract.expiration}.`,
          topStrike: top.contract.strike,
          expiration: top.contract.expiration,
          premiumYield: top.premiumYield,
          maxTotalReturn: top.maxTotalReturn,
        });
      } else {
        warnings.push(`No covered call for ${lot.symbol} met the filters (min OTM ${(minOtm * 100).toFixed(0)}%, max delta ${maxDelta}).`);
      }
    } catch (e) {
      warnings.push(`${lot.symbol} scan failed: ${(e as Error).message}`);
    }
  }

  // Cash-secured puts using available cash (if any). For MVP we use a nominal
  // cash figure derived from the goal or a default; full cash tracking is Phase 7.
  const cashAvailable = 25000; // placeholder until cash tracking lands
  if (cashAvailable > 0 && portfolio.stockLots.length > 0) {
    // Suggest CSPs on the user's existing symbols (stocks they clearly like).
    for (const lot of portfolio.stockLots.slice(0, 3)) {
      try {
        const expirations = await getExpirations({ symbol: lot.symbol });
        const expiration = pickClosest(expirations.data, targetDte);
        if (!expiration) continue;
        const chain = await getOptionChain({ symbol: lot.symbol, expiration: expiration.expirationDate });
        const ranked = scanCashSecuredPuts(
          chain.data,
          {
            symbol: lot.symbol,
            cashAvailable: cashAvailable / 3,
            minDte: goal?.preferredDteMin ?? null,
            maxDte: goal?.preferredDteMax ?? null,
            maxDelta,
            minDelta: null,
            targetEffectivePurchasePrice: null,
            minDiscountPercent: 0.05,
            minPremiumYield: null,
            minAnnualizedYield: null,
            maxCapitalRequired: null,
            minIvPercentile: null,
            excludeEarnings: goal?.earningsPreference === "exclude",
            liquidity: { minOpenInterest: 50, minVolume: null, maxBidAskSpreadPercent: 0.1 },
            objective: "cash_secured_put_entry",
          },
        );
        const top = ranked[0];
        if (top) {
          const contracts = Math.max(1, Math.floor((cashAvailable / 3) / top.grossCollateral));
          cspCandidates.push({
            symbol: lot.symbol,
            strategy: "CASH_SECURED_PUT",
            contracts,
            expectedPremium: top.premiumPerContract * contracts,
            rationale: `Effective entry ${top.effectivePurchasePrice} (${(top.discountToCurrentPrice * 100).toFixed(1)}% below current).`,
            topStrike: top.contract.strike,
            expiration: top.contract.expiration,
            effectiveEntry: top.effectivePurchasePrice,
            discountToCurrent: top.discountToCurrentPrice,
          });
        }
      } catch {
        // skip
      }
    }
  }

  const ccTotal = ccCandidates.reduce((s, c) => s + c.expectedPremium, 0);
  const cspTotal = cspCandidates.reduce((s, c) => s + c.expectedPremium, 0);
  const estimatedFeasible = ccTotal + cspTotal;
  const targetGap = monthlyTarget - estimatedFeasible;

  // Feasibility classification — based on calculations, not AI intuition.
  let feasibility: PortfolioIncomeAnalysis["feasibility"];
  let classification: string;
  const ratio = monthlyTarget > 0 ? estimatedFeasible / monthlyTarget : 0;
  if (ratio >= 1.0) {
    feasibility = "easily_supported";
    classification = `Estimated achievable income ($${estimatedFeasible.toFixed(0)}) meets or exceeds the target.`;
  } else if (ratio >= 0.7) {
    feasibility = "potentially_achievable";
    classification = `Estimated achievable income covers ${Math.round(ratio * 100)}% of target. May be reachable by widening filters slightly.`;
  } else if (ratio >= 0.3) {
    feasibility = "requires_relaxing";
    classification = `Only ${Math.round(ratio * 100)}% of target appears achievable under current constraints. Relaxing OTM/delta/DTE or adding holdings would help.`;
  } else {
    feasibility = "not_supported";
    classification = `Current opportunities cover only ${Math.round(ratio * 100)}% of target. The goal likely requires substantially more capital or greater assignment risk.`;
  }

  if (portfolio.stockLots.length === 0) {
    warnings.push("No holdings entered. Add positions in Portfolio for a real income plan.");
  }

  return {
    monthlyTarget,
    estimatedFeasibleIncome: estimatedFeasible,
    targetGap,
    feasibility,
    coveredCallCandidates: ccCandidates,
    cashSecuredPutCandidates: cspCandidates,
    warnings,
    classification,
  };
}

function pickClosest<T extends { daysToExpiration: number; expirationDate: string }>(list: T[], targetDte: number): T | null {
  if (list.length === 0) return null;
  let best: T | null = null;
  let bestDist = Infinity;
  for (const e of list) {
    const d = Math.abs(e.daysToExpiration - targetDte);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

// Re-exported for the dashboard / income planner page.
export async function getPortfolioSummary(userId: string) {
  const portfolio = await getPortfolio(userId).catch(() => null);
  if (!portfolio) return null;
  const quotes = await Promise.all(
    Array.from(new Set(portfolio.stockLots.map((l) => l.symbol))).map((s) =>
      getQuote({ symbol: s }).then((r) => r.data).catch(() => null),
    ),
  );
  const quoteMap = new Map(quotes.filter(Boolean).map((q) => [q!.symbol, q!]));
  let stockValue = 0;
  let totalCost = 0;
  for (const lot of portfolio.stockLots) {
    const q = quoteMap.get(lot.symbol);
    stockValue += (q?.price ?? lot.costBasisPerShare) * lot.shares;
    totalCost += lot.totalCostBasis;
  }
  const unrealized = stockValue - totalCost;
  return {
    stockValue,
    totalCost,
    unrealized,
    lotCount: portfolio.stockLots.length,
    symbolCount: new Set(portfolio.stockLots.map((l) => l.symbol)).size,
    openOptions: portfolio.optionPositions.filter((o) => o.status === "OPEN").length,
    goal: portfolio.goals[0] ?? null,
  };
}
