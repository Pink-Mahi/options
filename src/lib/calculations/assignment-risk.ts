/**
 * Dividend & early-assignment risk analysis.
 *
 * American-style options can be exercised early, primarily for:
 * 1. Dividends — short calls exercised the day before ex-div if extrinsic < dividend
 * 2. Deep ITM puts with no extrinsic value left
 *
 * This module flags these risks for any short option position.
 *
 * All functions are PURE and DETERMINISTIC. Unit-tested in ./assignment-risk.test.ts.
 */

import type { DividendEvent, OptionType } from "@/lib/types";
import { blackScholes } from "./pricing-model";

export type AssignmentRiskLevel = "none" | "low" | "moderate" | "high" | "very_high";

export interface AssignmentRiskResult {
  riskLevel: AssignmentRiskLevel;
  riskScore: number; // 0-1
  reasons: string[];
  daysToExDiv: number | null;
  dividendAmount: number | null;
  extrinsicValue: number;
  dividendVsExtrinsic: number | null; // dividend / extrinsic ratio
  earlyExerciseProbability: number; // 0-1
  recommendation: string;
}

/**
 * Assess early-assignment risk for a short option position.
 *
 * @param optionType - CALL or PUT
 * @param strike - option strike price
 * @param spot - current underlying price
 * @param daysToExpiration - DTE
 * @param impliedVolatility - current IV (decimal)
 * @param riskFreeRate - annual risk-free rate
 * @param dividends - upcoming dividend events
 * @param contracts - number of short contracts
 */
export function assessAssignmentRisk(
  optionType: OptionType,
  strike: number,
  spot: number,
  daysToExpiration: number,
  impliedVolatility: number,
  riskFreeRate: number = 0.05,
  dividends: DividendEvent[] = [],
): AssignmentRiskResult {
  const reasons: string[] = [];
  let riskScore = 0;
  const T = daysToExpiration / 365;

  // Compute theoretical option value and intrinsic/extrinsic
  const bs = blackScholes({
    spot,
    strike,
    timeToExpiry: T,
    riskFreeRate,
    volatility: impliedVolatility,
    optionType,
  });

  const intrinsic = optionType === "CALL"
    ? Math.max(0, spot - strike)
    : Math.max(0, strike - spot);
  const extrinsicValue = Math.max(0, bs.price - intrinsic);

  // Find next dividend within the option's lifetime
  const nextDiv = dividends.find((d) => {
    const daysToDiv = Math.round((new Date(d.exDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return daysToDiv >= 0 && daysToDiv <= daysToExpiration;
  });

  // Resolve dividend timing ONCE for both option types. Previously these were
  // only assigned inside the CALL branch, which made the put-side dividend
  // check below unreachable.
  let daysToExDiv: number | null = null;
  let dividendAmount: number | null = null;
  let dividendVsExtrinsic: number | null = null;

  if (nextDiv) {
    daysToExDiv = Math.round((new Date(nextDiv.exDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    dividendAmount = nextDiv.amount;
  }

  if (optionType === "CALL") {
    // Short call early-assignment risk: primarily driven by dividends
    if (nextDiv) {
      // If extrinsic < dividend, long call holder will exercise early to capture dividend
      if (extrinsicValue < nextDiv.amount && spot > strike) {
        dividendVsExtrinsic = nextDiv.amount / Math.max(extrinsicValue, 0.01);
        riskScore = Math.min(1, 0.5 + (nextDiv.amount - extrinsicValue) / nextDiv.amount * 0.5);
        reasons.push(`Extrinsic value ($${extrinsicValue.toFixed(2)}) < dividend ($${nextDiv.amount.toFixed(2)}): early exercise likely on day before ex-div.`);
      } else if (extrinsicValue < nextDiv.amount * 1.5) {
        riskScore = Math.max(riskScore, 0.3);
        reasons.push(`Extrinsic value close to dividend amount: moderate early exercise risk.`);
      }

      // Risk increases as ex-div date approaches
      if (daysToExDiv != null && daysToExDiv <= 3 && spot > strike) {
        riskScore = Math.max(riskScore, 0.7);
        reasons.push(`Ex-div date in ${daysToExDiv} days and call is ITM: high assignment risk.`);
      }
    }

    // Deep ITM call with very little extrinsic
    const moneyness = (spot - strike) / strike;
    if (moneyness > 0.15 && extrinsicValue < 0.10) {
      riskScore = Math.max(riskScore, 0.4);
      reasons.push("Call is deep ITM with minimal extrinsic value: assignment risk from early exercise.");
    }

    // Very short DTE + ITM
    if (daysToExpiration <= 2 && spot > strike) {
      riskScore = Math.max(riskScore, 0.6);
      reasons.push("Call is ITM with 2 or fewer DTE: near-certain assignment at expiration.");
    }
  } else {
    // Short put early-assignment risk
    // Puts are typically exercised early when deep ITM and interest on strike > extrinsic
    const moneyness = (strike - spot) / strike;
    if (moneyness > 0.15 && extrinsicValue < 0.10) {
      riskScore = Math.max(riskScore, 0.4);
      reasons.push("Put is deep ITM with minimal extrinsic value: early assignment risk.");
    }

    // Interest cost: if T-bill rate * strike * T > extrinsic, early exercise makes economic sense
    const interestOnStrike = strike * riskFreeRate * T;
    if (interestOnStrike > extrinsicValue && moneyness > 0.05) {
      riskScore = Math.max(riskScore, 0.35);
      reasons.push(`Interest on strike ($${interestOnStrike.toFixed(2)}) exceeds extrinsic ($${extrinsicValue.toFixed(2)}): early exercise economically rational.`);
    }

    // Very short DTE + ITM
    if (daysToExpiration <= 2 && spot < strike) {
      riskScore = Math.max(riskScore, 0.6);
      reasons.push("Put is ITM with 2 or fewer DTE: near-certain assignment at expiration.");
    }

    // Dividend reduces put assignment risk (stock drops by div amount, put becomes more ITM)
    // but if ex-div is before expiration, put holder might wait
    if (nextDiv && daysToExDiv != null && daysToExDiv < daysToExpiration) {
      reasons.push(`Dividend before expiration may increase put assignment risk (stock drops by ~$${nextDiv.amount.toFixed(2)} on ex-div).`);
      riskScore = Math.max(riskScore, 0.2);
    }
  }

  // Determine risk level
  let riskLevel: AssignmentRiskLevel;
  if (riskScore >= 0.75) riskLevel = "very_high";
  else if (riskScore >= 0.5) riskLevel = "high";
  else if (riskScore >= 0.3) riskLevel = "moderate";
  else if (riskScore >= 0.1) riskLevel = "low";
  else riskLevel = "none";

  if (reasons.length === 0) {
    reasons.push("No significant early-assignment risk factors detected.");
  }

  // Early exercise probability approximation
  const earlyExerciseProbability = riskScore;

  // Recommendation
  let recommendation: string;
  if (riskLevel === "very_high") {
    recommendation = optionType === "CALL"
      ? "Consider closing the position or rolling before ex-div date to avoid assignment."
      : "Consider closing or rolling the position. Assignment is likely imminent.";
  } else if (riskLevel === "high") {
    recommendation = "Monitor closely. Have a plan for assignment (buy shares or roll).";
  } else if (riskLevel === "moderate") {
    recommendation = "Be aware of assignment possibility. Ensure sufficient capital/margin for assignment.";
  } else if (riskLevel === "low") {
    recommendation = "Low risk. Standard monitoring sufficient.";
  } else {
    recommendation = "No action needed.";
  }

  return {
    riskLevel,
    riskScore,
    reasons,
    daysToExDiv,
    dividendAmount,
    extrinsicValue,
    dividendVsExtrinsic,
    earlyExerciseProbability,
    recommendation,
  };
}
