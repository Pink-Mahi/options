/**
 * Strategy Advisor — "Should I buy this house and rent it out?"
 *
 * Combines technical analysis, historical performance, and options chain data
 * into a single, plain-English recommendation for long-term buy-and-hold
 * investors who sell premium (covered calls / wheel).
 *
 * The metaphor: you find a stock you'd want to own for 10-15 years (the house),
 * then you sell covered calls at various DTEs (renting it out). This module:
 *   1. Scores stock quality (is this a good "neighborhood"?)
 *   2. Recommends which calls to sell (which DTE + strike)
 *   3. Explains assignment probability and income tradeoffs in plain English
 *
 * All functions are PURE and DETERMINISTIC. No IO, no randomness.
 */

import type { HistoricalPricePoint, OptionContract, OptionChain } from "@/lib/types";
import {
  annualizedVolatility,
  maxDrawdown,
  returnOverDays,
  movingAverage,
} from "./historical";
import { clamp } from "./core";
import { calculateCoveredCall } from "./covered-call";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StockQualityGrade = "A" | "B" | "C" | "D" | "F";

export interface StockQualityScore {
  /** 0-100 overall quality score */
  total: number;
  grade: StockQualityGrade;
  /** Component scores 0-100 */
  components: {
    trend: number;
    stability: number;
    growth: number;
    drawdownRisk: number;
    technicalBias: number;
  };
  /** Plain-English explanation of the score */
  explanation: string;
  /** Key reasons for the grade (positive) */
  strengths: string[];
  /** Key concerns (negative) */
  concerns: string[];
}

export interface CallRecommendation {
  contract: OptionContract;
  dte: number;
  strike: number;
  premiumPerShare: number;
  premiumYield: number;
  annualizedYield: number;
  assignmentProbability: number | null;
  /** Probability the call expires worthless (1 - assignment prob) */
  expireWorthlessProbability: number | null;
  upsideIfAssigned: number;
  totalReturnIfAssigned: number;
  /** "Sell this call if you want to keep the stock" vs "Sell this call if you're willing to sell" */
  strategy: "income_keep" | "income_sell" | "balanced";
  /** Plain-English explanation */
  explanation: string;
  /** Is this the best overall pick? */
  isBestPick: boolean;
}

export interface DTEComparison {
  dte: number;
  expiration: string;
  bestCall: CallRecommendation | null;
  callsAnalyzed: number;
  avgPremiumYield: number;
  avgAssignmentProb: number;
}

export interface StrategyAdvisorResult {
  symbol: string;
  currentPrice: number;
  quality: StockQualityScore;
  /** "Yes, this is a good stock to own and sell calls against" etc. */
  verdict: "strong_buy" | "buy" | "caution" | "avoid";
  verdictExplanation: string;
  /** Recommended DTE bucket and why */
  recommendedDTE: {
    dte: number;
    reason: string;
  };
  /** Side-by-side DTE comparison */
  dteComparisons: DTEComparison[];
  /** Best overall call pick across all DTEs */
  bestPick: CallRecommendation | null;
  /** Plain-English summary for the user */
  summary: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Stock Quality Scoring
// ---------------------------------------------------------------------------

export function scoreStockQuality(
  points: HistoricalPricePoint[],
  technicalBias: "bullish" | "bearish" | "neutral",
  technicalScore: number,
): StockQualityScore {
  const strengths: string[] = [];
  const concerns: string[] = [];

  // 1. Trend: long-term price above 200 SMA
  const currentPrice = points.length > 0 ? (points[points.length - 1]?.close ?? 0) : 0;
  const sma200Result = movingAverage(points, 200);
  const sma200 = sma200Result?.value ?? null;
  const aboveSMA200 = sma200 != null && currentPrice > sma200;
  const trendScore = aboveSMA200 ? 80 : sma200 != null ? 30 : 50;
  if (aboveSMA200) strengths.push("Price is above its 200-day moving average — long-term uptrend is intact");
  else if (sma200 != null) concerns.push("Price is below its 200-day moving average — long-term downtrend");

  // 2. Stability: low volatility = stable
  const vol = annualizedVolatility(points);
  const volScore = vol == null ? 50 : vol < 0.20 ? 90 : vol < 0.30 ? 70 : vol < 0.40 ? 50 : vol < 0.60 ? 30 : 15;
  if (vol != null && vol < 0.25) strengths.push(`Low volatility (${(vol * 100).toFixed(0)}% annualized) — stable, predictable`);
  else if (vol != null && vol > 0.45) concerns.push(`High volatility (${(vol * 100).toFixed(0)}% annualized) — unstable, wider swings`);

  // 3. Growth: positive returns over 1y, 3y, 5y
  const ret1y = returnOverDays(points, 252);
  const ret3y = returnOverDays(points, 252 * 3);
  const ret5y = returnOverDays(points, 252 * 5);
  let growthScore = 50;
  if (ret1y != null && ret1y > 0) growthScore += 10;
  if (ret3y != null && ret3y > 0) growthScore += 15;
  if (ret5y != null && ret5y > 0) growthScore += 15;
  if (ret1y != null && ret1y > 0.20) growthScore += 5;
  if (ret5y != null && ret5y > 0.50) growthScore += 5;
  growthScore = clamp(growthScore, 0, 100);
  if (ret5y != null && ret5y > 0.50) strengths.push(`5-year return of ${(ret5y * 100).toFixed(0)}% — strong long-term growth`);
  if (ret3y != null && ret3y < -0.20) concerns.push(`3-year return of ${(ret3y * 100).toFixed(0)}% — declining over recent years`);

  // 4. Drawdown risk: worst peak-to-trough
  const mdd = maxDrawdown(points);
  const ddScore = mdd == null ? 50 : Math.abs(mdd) < 0.20 ? 90 : Math.abs(mdd) < 0.35 ? 70 : Math.abs(mdd) < 0.50 ? 50 : Math.abs(mdd) < 0.70 ? 30 : 15;
  if (mdd != null && Math.abs(mdd) < 0.25) strengths.push(`Max historical drawdown only ${(Math.abs(mdd) * 100).toFixed(0)}% — relatively safe`);
  else if (mdd != null && Math.abs(mdd) > 0.50) concerns.push(`Max historical drawdown of ${(Math.abs(mdd) * 100).toFixed(0)}% — high risk of deep losses`);

  // 5. Technical bias: from the 15+ indicators
  const biasScore = technicalBias === "bullish" ? 80 : technicalBias === "bearish" ? 20 : 50;
  if (technicalBias === "bullish") strengths.push(`Technical indicators are net bullish (score: ${technicalScore.toFixed(0)})`);
  else if (technicalBias === "bearish") concerns.push(`Technical indicators are net bearish (score: ${technicalScore.toFixed(0)})`);

  // Weighted total
  const weights = { trend: 0.25, stability: 0.20, growth: 0.25, drawdownRisk: 0.15, technicalBias: 0.15 };
  const total = Math.round(
    trendScore * weights.trend +
    volScore * weights.stability +
    growthScore * weights.growth +
    ddScore * weights.drawdownRisk +
    biasScore * weights.technicalBias,
  );

  const grade: StockQualityGrade = total >= 80 ? "A" : total >= 65 ? "B" : total >= 50 ? "C" : total >= 35 ? "D" : "F";

  let explanation: string;
  if (grade === "A") {
    explanation = "This is a high-quality stock that has shown strong, stable growth with manageable drawdowns. It's a good candidate for a long-term buy-and-hold with covered call income — like buying a house in a great neighborhood.";
  } else if (grade === "B") {
    explanation = "This stock has solid fundamentals but has some weaknesses. It's a reasonable candidate for the wheel strategy, but monitor the concerns below. Like a house in a good but not perfect neighborhood.";
  } else if (grade === "C") {
    explanation = "This stock is mixed — some positive signals but also significant risks. You could sell premium against it, but be prepared for larger drawdowns. Like a house in an up-and-coming area that could go either way.";
  } else if (grade === "D") {
    explanation = "This stock has more red flags than green flags. Selling covered calls here means you might get assigned at a loss. Think carefully before committing long-term capital. Like a house in a declining neighborhood.";
  } else {
    explanation = "This stock shows poor quality across multiple dimensions. Avoid holding it long-term or selling premium against it. Like a house in a bad neighborhood — don't buy it.";
  }

  return {
    total,
    grade,
    components: {
      trend: trendScore,
      stability: volScore,
      growth: growthScore,
      drawdownRisk: ddScore,
      technicalBias: biasScore,
    },
    explanation,
    strengths,
    concerns,
  };
}

// ---------------------------------------------------------------------------
// Call Recommendation Engine
// ---------------------------------------------------------------------------

export function analyzeCall(
  contract: OptionContract,
  currentPrice: number,
  contracts: number,
): CallRecommendation {
  const cc = calculateCoveredCall({
    contract,
    contracts,
    currentPrice,
  });

  const assignmentProb = cc.estimatedAssignmentProbability;
  const expireWorthlessProb = assignmentProb != null ? 1 - assignmentProb : null;

  // Strategy classification based on OTM distance
  const otmPct = cc.strikeOtmPercent;
  let strategy: "income_keep" | "income_sell" | "balanced";
  if (otmPct > 0.05) {
    strategy = "income_keep";
  } else if (otmPct < 0.01 || contract.inTheMoney) {
    strategy = "income_sell";
  } else {
    strategy = "balanced";
  }

  // Plain-English explanation
  let explanation: string;
  const dte = contract.daysToExpiration;
  const strike = contract.strike;
  const premium = cc.premiumPerShare;
  const yieldPct = cc.premiumYield * 100;
  const assignPct = assignmentProb != null ? (assignmentProb * 100).toFixed(0) : "unknown";
  const worthlessPct = expireWorthlessProb != null ? (expireWorthlessProb * 100).toFixed(0) : "unknown";

  if (strategy === "income_keep") {
    explanation = `Sell the ${strike} strike call expiring in ${dte} days for ~$${premium.toFixed(2)}/share (${yieldPct.toFixed(1)}% premium yield). The strike is ${(otmPct * 100).toFixed(1)}% above the current price, so there's a ${worthlessPct}% chance it expires worthless (you keep the premium and your shares) and a ${assignPct}% chance you're assigned (you sell your shares at ${strike} — a profit, but you lose upside above that). This is the "rent out the house but don't sell it" approach.`;
  } else if (strategy === "income_sell") {
    explanation = `Sell the ${strike} strike call expiring in ${dte} days for ~$${premium.toFixed(2)}/share (${yieldPct.toFixed(1)}% premium yield). The strike is at or near the current price, so there's a ${assignPct}% chance you're assigned (you sell your shares at ${strike}). This is the "rent out the house and you're fine selling it at this price" approach — higher income, but more likely to lose the stock.`;
  } else {
    explanation = `Sell the ${strike} strike call expiring in ${dte} days for ~$${premium.toFixed(2)}/share (${yieldPct.toFixed(1)}% premium yield). The strike is ${(otmPct * 100).toFixed(1)}% above the current price — a balanced approach with a ${worthlessPct}% chance of keeping your shares and a ${assignPct}% chance of assignment at a profit.`;
  }

  return {
    contract,
    dte,
    strike,
    premiumPerShare: cc.premiumPerShare,
    premiumYield: cc.premiumYield,
    annualizedYield: cc.annualizedPremiumYield,
    assignmentProbability: assignmentProb,
    expireWorthlessProbability: expireWorthlessProb,
    upsideIfAssigned: cc.potentialStockAppreciation,
    totalReturnIfAssigned: cc.maxTotalReturn,
    strategy,
    explanation,
    isBestPick: false,
  };
}

export interface BestPickCriteria {
  /** Weight on income (premium yield) */
  incomeWeight: number;
  /** Weight on keeping the stock (expire worthless probability) */
  keepWeight: number;
  /** Weight on total return if assigned */
  totalReturnWeight: number;
}

/**
 * Select the best call from a list of candidates.
 * Default criteria: balanced between income, keeping the stock, and total return.
 */
export function selectBestCall(
  calls: CallRecommendation[],
  criteria: BestPickCriteria = { incomeWeight: 0.35, keepWeight: 0.35, totalReturnWeight: 0.30 },
): CallRecommendation | null {
  if (calls.length === 0) return null;

  let best: CallRecommendation | null = null;
  let bestScore = -Infinity;

  for (const call of calls) {
    const incomeN = clamp(call.premiumYield / 0.10, 0, 1);
    const keepN = call.expireWorthlessProbability != null ? call.expireWorthlessProbability : 0.5;
    const totalReturnN = clamp(call.totalReturnIfAssigned / 0.30, 0, 1);

    const score = incomeN * criteria.incomeWeight + keepN * criteria.keepWeight + totalReturnN * criteria.totalReturnWeight;

    if (score > bestScore) {
      bestScore = score;
      best = call;
    }
  }

  if (best) {
    best = { ...best, isBestPick: true };
  }

  return best;
}

// ---------------------------------------------------------------------------
// Full Strategy Advisor
// ---------------------------------------------------------------------------

export function runStrategyAdvisor(
  symbol: string,
  currentPrice: number,
  historical: HistoricalPricePoint[],
  chains: OptionChain[],
  technicalBias: "bullish" | "bearish" | "neutral",
  technicalScore: number,
  contracts = 1,
): StrategyAdvisorResult {
  const warnings: string[] = [];

  // 1. Score stock quality
  const quality = scoreStockQuality(historical, technicalBias, technicalScore);

  // 2. Analyze all calls across all chains
  const allCalls: CallRecommendation[] = [];
  const dteComparisons: DTEComparison[] = [];

  for (const chain of chains) {
    const dte = chain.calls[0]?.daysToExpiration ?? 0;
    const callsForChain: CallRecommendation[] = [];

    for (const call of chain.calls) {
      // Only analyze calls with valid bid/ask
      if (call.bid == null || call.ask == null) continue;
      // Skip deep ITM or far OTM (more than 20% OTM)
      const otmPct = (call.strike - currentPrice) / currentPrice;
      if (otmPct > 0.20) continue;

      const rec = analyzeCall(call, currentPrice, contracts);
      callsForChain.push(rec);
      allCalls.push(rec);
    }

    // Find best call for this DTE
    const bestForDte = selectBestCall(callsForChain);
    if (bestForDte) bestForDte.isBestPick = false; // Only global best gets the flag

    const avgYield = callsForChain.length > 0
      ? callsForChain.reduce((s, c) => s + c.premiumYield, 0) / callsForChain.length
      : 0;
    const avgAssign = callsForChain.length > 0
      ? callsForChain.filter(c => c.assignmentProbability != null).reduce((s, c) => s + (c.assignmentProbability ?? 0), 0) / callsForChain.length
      : 0;

    dteComparisons.push({
      dte,
      expiration: chain.expiration,
      bestCall: bestForDte,
      callsAnalyzed: callsForChain.length,
      avgPremiumYield: avgYield,
      avgAssignmentProb: avgAssign,
    });
  }

  // Sort DTE comparisons by DTE ascending
  dteComparisons.sort((a, b) => a.dte - b.dte);

  // 3. Select global best pick
  const bestPick = selectBestCall(allCalls);

  // 4. Recommend DTE bucket
  let recommendedDTE = { dte: 30, reason: "" };
  if (dteComparisons.length > 0) {
    // Prefer 30-45 DTE if available (best theta decay window)
    const preferred = dteComparisons.find(d => d.dte >= 25 && d.dte <= 60);
    if (preferred) {
      recommendedDTE = {
        dte: preferred.dte,
        reason: `The ${preferred.dte}-day expiration offers the best balance of time decay (theta) and income. Shorter DTEs have faster theta decay but less premium per trade; longer DTEs lock up capital longer and are more exposed to earnings/dividend risk.`,
      };
    } else {
      // Fall back to shortest available
      const shortest = dteComparisons[0];
      if (shortest) {
        recommendedDTE = {
          dte: shortest.dte,
          reason: `The ${shortest.dte}-day expiration is the shortest available. Shorter DTEs benefit from faster time decay, meaning you can roll more frequently and capture more income cycles per year.`,
        };
      }
    }
  }

  // 5. Verdict
  let verdict: StrategyAdvisorResult["verdict"];
  let verdictExplanation: string;

  if (quality.grade === "A" || quality.grade === "B") {
    verdict = quality.grade === "A" ? "strong_buy" : "buy";
    verdictExplanation = quality.grade === "A"
      ? "This is a high-quality stock worth owning for the long term. Selling covered calls against it is like renting out a house in a great neighborhood — you collect income while holding a quality asset. Use the recommended call below to start generating premium."
      : "This stock is good enough to own and sell calls against. It's not perfect, but the fundamentals support long-term ownership. Sell covered calls to generate income while you hold, but keep an eye on the concerns listed below.";
  } else if (quality.grade === "C") {
    verdict = "caution";
    verdictExplanation = "This stock is a mixed bag. You can sell premium against it, but be aware that the quality is mediocre. If you wouldn't want to own it for 10 years at this price, don't sell covered calls on it — assignment could leave you holding a declining asset.";
  } else {
    verdict = "avoid";
    verdictExplanation = "This stock does not meet quality thresholds for a long-term buy-and-hold with covered calls. The risk of holding it long-term outweighs the premium income. Find a better stock — there are plenty of quality names to sell calls against.";
  }

  // 6. Plain-English summary
  const summary: string[] = [];

  summary.push(`Stock Quality: Grade ${quality.grade} (${quality.total}/100). ${quality.explanation}`);

  if (quality.strengths.length > 0) {
    summary.push(`Strengths: ${quality.strengths.join("; ")}.`);
  }
  if (quality.concerns.length > 0) {
    summary.push(`Concerns: ${quality.concerns.join("; ")}.`);
  }

  if (bestPick) {
    const assignPct = bestPick.assignmentProbability != null ? (bestPick.assignmentProbability * 100).toFixed(0) : "unknown";
    const worthlessPct = bestPick.expireWorthlessProbability != null ? (bestPick.expireWorthlessProbability * 100).toFixed(0) : "unknown";
    summary.push(`Best call to sell: ${bestPick.strike} strike expiring in ${bestPick.dte} days, for ~$${bestPick.premiumPerShare.toFixed(2)}/share (${(bestPick.premiumYield * 100).toFixed(1)}% yield). There's a ${worthlessPct}% chance it expires worthless (you keep the premium and your shares) and a ${assignPct}% chance you get assigned (you sell shares at $${bestPick.strike} — a profit if you bought lower).`);
  } else {
    summary.push("No suitable calls found in the available option chains. Try a different expiration date or check back when liquidity improves.");
  }

  if (recommendedDTE.reason) {
    summary.push(`Recommended DTE: ${recommendedDTE.dte} days. ${recommendedDTE.reason}`);
  }

  if (warnings.length === 0 && historical.length < 252) {
    warnings.push(`Only ${historical.length} days of history available — quality score is less reliable with under 1 year of data.`);
  }

  return {
    symbol,
    currentPrice,
    quality,
    verdict,
    verdictExplanation,
    recommendedDTE,
    dteComparisons,
    bestPick,
    summary,
    warnings,
  };
}
