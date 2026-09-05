/**
 * Cash-secured-put calculations.
 * Pure & deterministic. Unit-tested.
 */

import type {
  CashSecuredPutCandidate,
  CashSecuredPutScore,
  OptionContract,
  OptionPriceAssumption,
} from "@/lib/types";
import {
  bidAskSpread,
  bidAskSpreadPercent,
  compoundAnnualizedRate,
  DEFAULT_CONTRACT_MULTIPLIER,
  estimatedAssignmentProbability,
  eventBeforeExpiration,
  liquidityScore,
  premiumIncome,
  premiumPerContract,
  resolveOptionPrice,
  simpleAnnualizedRate,
  strikeDiscountPercent,
} from "./core";
import {
  cspBreakEven,
  discountToCurrentPrice,
  effectivePurchasePrice,
  grossCollateral,
  netCapitalAtRisk,
  returnOnGrossCollateral,
  returnOnNetCapital,
} from "./returns";

export interface CashSecuredPutInput {
  contract: OptionContract;
  contracts: number;
  currentPrice: number;
  priceAssumption?: OptionPriceAssumption;
  earningsDate?: string | null;
  exDividendDate?: string | null;
}

export function calculateCashSecuredPut(
  input: CashSecuredPutInput,
): CashSecuredPutCandidate {
  const {
    contract,
    contracts,
    currentPrice,
    earningsDate = null,
    exDividendDate = null,
  } = input;

  const assumption =
    input.priceAssumption ?? resolveOptionPrice(contract, "midpoint");
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

  const gross = grossCollateral(strike, contracts, DEFAULT_CONTRACT_MULTIPLIER);
  const netCap = netCapitalAtRisk(gross, premiumIncomeValue);

  const retGross = returnOnGrossCollateral(premiumIncomeValue, gross);
  const retNet = returnOnNetCapital(premiumIncomeValue, netCap);

  const annGross = simpleAnnualizedRate(retGross, dte);
  const annNet = simpleAnnualizedRate(retNet, dte);
  const compoundAnnGross = compoundAnnualizedRate(retGross, dte);

  const effPrice = effectivePurchasePrice(strike, premiumPerShare);
  const breakEven = cspBreakEven(strike, premiumPerShare);
  const discount = discountToCurrentPrice(currentPrice, effPrice);
  const strikeDiscount = strikeDiscountPercent(strike, currentPrice);

  const delta = contract.greeks.delta;
  const assignmentProb = estimatedAssignmentProbability(delta, "PUT");

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

  const score = scoreCashSecuredPut({
    returnOnGrossCollateral: retGross,
    returnOnNetCapital: retNet,
    discountToCurrentPrice: discount,
    strikeDiscountPercent: strikeDiscount,
    delta,
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
    grossCollateral: gross,
    netCapitalAtRisk: netCap,
    returnOnGrossCollateral: retGross,
    returnOnNetCapital: retNet,
    annualizedReturnOnGross: annGross,
    annualizedReturnOnNet: annNet,
    effectivePurchasePrice: effPrice,
    breakEven,
    discountToCurrentPrice: discount,
    strikeDiscountPercent: strikeDiscount,
    delta,
    estimatedAssignmentProbability: assignmentProb,
    impliedVolatility: contract.impliedVolatility,
    openInterest: contract.openInterest,
    volume: contract.volume,
    bidAskSpread: spread,
    bidAskSpreadPercent: spreadPct,
    liquidityScore: liqScore,
    earningsBeforeExpiration: earningsBefore,
    exDividendBeforeExpiration: exDivBefore,
    premiumPerDay,
    score,
  };
}

export interface CspScoreInput {
  returnOnGrossCollateral: number;
  returnOnNetCapital: number;
  discountToCurrentPrice: number;
  strikeDiscountPercent: number;
  delta: number | null;
  impliedVolatility: number | null;
  liquidityScore: number;
  earningsBeforeExpiration: boolean;
  assignmentProbability: number | null;
}

/** Score a CSP 0-100. Balanced objective by default. */
export function scoreCashSecuredPut(input: CspScoreInput): CashSecuredPutScore {
  // Income: return on net capital 0 -> 0, 0.15 (15%) -> 1
  const incomeN = clamp01(input.returnOnNetCapital / 0.15);
  // Entry quality: deeper effective discount is better. 0 -> 0, 0.20 (20%) -> 1
  const entryN = clamp01(input.discountToCurrentPrice / 0.2);
  // Assignment risk: lower is better. delta 0 -> 1, 0.5 -> 0
  const assignmentN =
    input.assignmentProbability != null
      ? clamp01(1 - input.assignmentProbability / 0.5)
      : 0.5;
  const liquidityN = input.liquidityScore / 100;
  const volN =
    input.impliedVolatility != null ? clamp01(input.impliedVolatility / 1.0) : 0.5;

  const earningsPenalty = input.earningsBeforeExpiration ? 0.85 : 1;

  const weights = {
    income: 0.3,
    entryQuality: 0.25,
    assignmentRisk: 0.2,
    liquidity: 0.15,
    volatilityPremium: 0.1,
  };

  const totalRaw =
    (incomeN * weights.income +
      entryN * weights.entryQuality +
      assignmentN * weights.assignmentRisk +
      liquidityN * weights.liquidity +
      volN * weights.volatilityPremium) *
    earningsPenalty;

  const total = Math.round(clamp01(totalRaw) * 100);

  return {
    total,
    income: Math.round(incomeN * 100),
    entryQuality: Math.round(entryN * 100),
    assignmentRisk: Math.round(assignmentN * 100),
    liquidity: Math.round(liquidityN * 100),
    volatilityPremium: Math.round(volN * 100),
  };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
