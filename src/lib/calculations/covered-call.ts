/**
 * Covered-call calculations.
 *
 * Pure & deterministic. Same inputs => same outputs. Unit-tested.
 *
 * Two return components are always computed and NEVER collapsed:
 *   1. Premium return (income / investment)
 *   2. Potential stock appreciation (strike - current) / current
 * Plus the combined Maximum Total Return If Assigned.
 */

import type {
  CoveredCallCandidate,
  CoveredCallScore,
  OptionContract,
  OptionPriceAssumption,
} from "@/lib/types";
import {
  annualizedMaxTotalReturnForCall,
  breakEvenForCall,
  downsideProtectionPercent,
  maxProfitPerShareForCall,
  maxTotalReturnForCall,
  maxTotalReturnOnCostForCall,
  premiumYield,
  premiumYieldOnCost,
} from "./returns";
import {
  bidAskSpread,
  bidAskSpreadPercent,
  compoundAnnualizedRate,
  daysBetween,
  DEFAULT_CONTRACT_MULTIPLIER,
  estimatedAssignmentProbability,
  eventBeforeExpiration,
  extrinsicValue,
  intrinsicValue,
  liquidityScore,
  potentialStockAppreciation,
  premiumIncome,
  premiumPerContract,
  resolveOptionPrice,
  simpleAnnualizedRate,
  strikeOtmPercent,
} from "./core";

export interface CoveredCallInput {
  contract: OptionContract;
  /** Number of contracts the user is considering selling. */
  contracts: number;
  /** Current underlying price (typically contract.underlyingPrice). */
  currentPrice: number;
  /** Cost basis per share, if known. */
  costBasisPerShare?: number | null;
  /** Pricing assumption. Defaults to "midpoint". */
  priceAssumption?: OptionPriceAssumption;
  /** Earnings date (ISO) if known, to flag earnings-before-expiration. */
  earningsDate?: string | null;
  /** Ex-dividend date (ISO) if known. */
  exDividendDate?: string | null;
  /** Historical probability of finishing below the strike (0-1), if computed. */
  historicalProbabilityBelowStrike?: number | null;
}

export function calculateCoveredCall(input: CoveredCallInput): CoveredCallCandidate {
  const {
    contract,
    contracts,
    currentPrice,
    costBasisPerShare = null,
    earningsDate = null,
    exDividendDate = null,
    historicalProbabilityBelowStrike = null,
  } = input;

  const assumption =
    input.priceAssumption ??
    resolveOptionPrice(contract, "midpoint");

  const premiumPerShare = assumption.pricePerShare;
  const dte = contract.daysToExpiration;
  const strike = contract.strike;

  const premiumPerContractValue = premiumPerContract(
    premiumPerShare,
    DEFAULT_CONTRACT_MULTIPLIER,
  );
  const premiumIncomeValue = premiumIncome(
    premiumPerShare,
    contracts,
    DEFAULT_CONTRACT_MULTIPLIER,
  );

  const coveredShares = contracts * DEFAULT_CONTRACT_MULTIPLIER;
  const currentMarketValue = coveredShares * currentPrice;
  const costBasisValue = costBasisPerShare != null ? coveredShares * costBasisPerShare : null;

  const pYield = premiumYield(premiumIncomeValue, currentMarketValue);
  const pYieldOnCost = costBasisValue != null ? premiumYieldOnCost(premiumIncomeValue, costBasisValue) : null;

  const annualizedPremiumYield = simpleAnnualizedRate(pYield, dte);
  const compoundedAnnualizedPremiumYield = compoundAnnualizedRate(pYield, dte);

  const otm = strikeOtmPercent(strike, currentPrice);
  const appreciation = potentialStockAppreciation(strike, currentPrice);

  const maxProfit = maxProfitPerShareForCall(premiumPerShare, strike, currentPrice);
  const maxTotalReturn = maxTotalReturnForCall(maxProfit, currentPrice);
  const maxTotalReturnOnCost =
    costBasisPerShare != null
      ? maxTotalReturnOnCostForCall(premiumPerShare, strike, costBasisPerShare)
      : null;
  const annualizedMaxTotalReturn = annualizedMaxTotalReturnForCall(maxTotalReturn, dte);

  const breakEven = breakEvenForCall(costBasisPerShare ?? currentPrice, premiumPerShare);
  const downside = downsideProtectionPercent(premiumPerShare, currentPrice);

  const delta = contract.greeks.delta;
  const assignmentProb = estimatedAssignmentProbability(delta, "CALL");

  const spread = bidAskSpread(contract.bid, contract.ask);
  const spreadPct = bidAskSpreadPercent(contract.bid, contract.ask);
  const liqScore = liquidityScore({
    openInterest: contract.openInterest,
    volume: contract.volume,
    bidAskSpreadPercent: spreadPct,
  });

  const earningsBefore = eventBeforeExpiration(earningsDate, contract.expiration);
  const exDivBefore = eventBeforeExpiration(exDividendDate, contract.expiration);

  const premiumPerDay = dte > 0 ? premiumIncomeValue / dte : 0;
  const premiumYieldPerDay = dte > 0 ? pYield / dte : 0;

  const score = scoreCoveredCall({
    premiumYield: pYield,
    annualizedPremiumYield,
    strikeOtmPercent: otm,
    delta,
    potentialStockAppreciation: appreciation,
    maxTotalReturn,
    historicalProbabilityBelowStrike,
    impliedVolatility: contract.impliedVolatility,
    liquidityScore: liqScore,
    earningsBeforeExpiration: earningsBefore,
    assignmentProbability: assignmentProb,
  });

  return {
    contract,
    priceAssumption: assumption,
    premiumPerShare,
    premiumPerContract: premiumPerContractValue,
    premiumIncome: premiumIncomeValue,
    contracts,
    premiumYield: pYield,
    premiumYieldOnCost: pYieldOnCost,
    annualizedPremiumYield,
    compoundedAnnualizedPremiumYield,
    strikeOtmPercent: otm,
    potentialStockAppreciation: appreciation,
    maxProfitPerShare: maxProfit,
    maxTotalReturn,
    maxTotalReturnOnCost,
    annualizedMaxTotalReturn,
    breakEven,
    downsideProtectionPercent: downside,
    delta,
    estimatedAssignmentProbability: assignmentProb,
    theta: contract.greeks.theta,
    gamma: contract.greeks.gamma,
    impliedVolatility: contract.impliedVolatility,
    openInterest: contract.openInterest,
    volume: contract.volume,
    bidAskSpread: spread,
    bidAskSpreadPercent: spreadPct,
    liquidityScore: liqScore,
    earningsBeforeExpiration: earningsBefore,
    exDividendBeforeExpiration: exDivBefore,
    premiumPerDay,
    premiumYieldPerDay,
    score,
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface ScoreInput {
  premiumYield: number;
  annualizedPremiumYield: number;
  strikeOtmPercent: number;
  delta: number | null;
  potentialStockAppreciation: number;
  maxTotalReturn: number;
  historicalProbabilityBelowStrike: number | null;
  impliedVolatility: number | null;
  liquidityScore: number;
  earningsBeforeExpiration: boolean;
  assignmentProbability: number | null;
}

/**
 * Score a covered call 0-100 from normalized sub-metrics.
 *
 * Weights reflect a BALANCED objective by default. The scanner can re-weight
 * by objective (see `reweightCoveredCallScore`). All raw metrics are
 * normalized to 0-1 before combining — we never add incompatible raw values.
 */
export function scoreCoveredCall(input: ScoreInput): CoveredCallScore {
  // Normalize each metric to 0-1.
  // Premium yield: 0 -> 0, 0.10 (10%) -> 1
  const incomeN = clamp01(input.premiumYield / 0.1);
  // Annualized premium yield: 0 -> 0, 0.30 (30%) -> 1
  const annualizedIncomeN = clamp01(input.annualizedPremiumYield / 0.3);
  // OTM distance: 0 -> 0, 0.30 (30%) -> 1 (more OTM = more upside preserved)
  const upsideN = clamp01(input.strikeOtmPercent / 0.3);
  // Assignment risk: lower is better. delta 0 -> 1, delta 0.5 -> 0
  const assignmentN =
    input.assignmentProbability != null
      ? clamp01(1 - input.assignmentProbability / 0.5)
      : 0.5;
  // Liquidity: already 0-100
  const liquidityN = input.liquidityScore / 100;
  // Volatility premium: IV 0 -> 0, IV 1.0 (100%) -> 1
  const volN =
    input.impliedVolatility != null ? clamp01(input.impliedVolatility / 1.0) : 0.5;
  // Historical distance: probability of finishing BELOW strike. Higher = safer.
  const histN =
    input.historicalProbabilityBelowStrike != null
      ? clamp01(input.historicalProbabilityBelowStrike)
      : 0.5;
  // Total return: 0 -> 0, 0.60 (60%) -> 1
  const totalReturnN = clamp01(input.maxTotalReturn / 0.6);

  // Penalty if earnings before expiration (adds risk).
  const earningsPenalty = input.earningsBeforeExpiration ? 0.85 : 1;

  const weights = {
    income: 0.18,
    upsidePreservation: 0.18,
    assignmentRisk: 0.15,
    liquidity: 0.12,
    volatilityPremium: 0.07,
    historicalDistance: 0.1,
    totalReturn: 0.2,
  };

  const income = Math.round(incomeN * 100);
  const upsidePreservation = Math.round(upsideN * 100);
  const assignmentRisk = Math.round(assignmentN * 100);
  const liquidity = Math.round(liquidityN * 100);
  const volatilityPremium = Math.round(volN * 100);
  const historicalDistance = Math.round(histN * 100);
  const totalReturn = Math.round(totalReturnN * 100);

  const totalRaw =
    (incomeN * weights.income +
      upsideN * weights.upsidePreservation +
      assignmentN * weights.assignmentRisk +
      liquidityN * weights.liquidity +
      volN * weights.volatilityPremium +
      histN * weights.historicalDistance +
      totalReturnN * weights.totalReturn) *
    earningsPenalty;

  const total = Math.round(clamp01(totalRaw) * 100);

  return {
    total,
    income,
    upsidePreservation,
    assignmentRisk,
    liquidity,
    volatilityPremium,
    historicalDistance,
    totalReturn,
  };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// Re-export helpers used by the UI/tests
export { intrinsicValue, extrinsicValue, daysBetween };
