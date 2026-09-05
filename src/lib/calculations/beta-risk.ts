/**
 * Beta-weighted delta & concentration risk analysis.
 *
 * Beta-weighting converts each position's delta to SPY-equivalent delta,
 * giving a portfolio-level view of directional risk relative to the market.
 *
 * Concentration risk measures how exposed the portfolio is to any single
 * symbol or sector.
 *
 * All functions are PURE and DETERMINISTIC. Unit-tested in ./beta-risk.test.ts.
 */

export interface PositionDelta {
  symbol: string;
  delta: number; // raw position delta (shares * delta per share)
  marketValue: number;
  beta: number; // stock beta vs SPY
}

export interface BetaWeightedResult {
  totalBetaWeightedDelta: number; // SPY-equivalent shares
  totalMarketValue: number;
  netDelta: number; // raw sum of deltas
  weightedDeltaBySymbol: { symbol: string; betaWeightedDelta: number; marketValue: number; percentOfPortfolio: number }[];
  concentrationRisk: ConcentrationRisk;
  directionalBias: "bullish" | "bearish" | "neutral";
  spyEquivalentExposure: number; // $ in SPY equivalents
}

export interface ConcentrationRisk {
  maxSinglePosition: number; // percent
  top3Concentration: number; // percent
  herfindahlIndex: number; // 0-1, higher = more concentrated
  riskLevel: "diversified" | "moderate" | "concentrated" | "highly_concentrated";
  warnings: string[];
}

/**
 * Compute beta-weighted delta for a portfolio of positions.
 *
 * @param positions - array of position deltas with betas
 * @param spyPrice - current SPY price for dollar exposure conversion
 */
export function computeBetaWeightedDelta(
  positions: PositionDelta[],
  spyPrice: number,
): BetaWeightedResult {
  const totalMarketValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const netDelta = positions.reduce((s, p) => s + p.delta, 0);

  const weighted = positions.map((p) => {
    const betaWeightedDelta = p.delta * p.beta;
    const percentOfPortfolio = totalMarketValue > 0 ? p.marketValue / totalMarketValue : 0;
    return {
      symbol: p.symbol,
      betaWeightedDelta,
      marketValue: p.marketValue,
      percentOfPortfolio,
    };
  });

  const totalBetaWeightedDelta = weighted.reduce((s, w) => s + w.betaWeightedDelta, 0);
  const spyEquivalentExposure = totalBetaWeightedDelta * spyPrice;

  // Concentration risk
  const weights = positions.map((p) => totalMarketValue > 0 ? p.marketValue / totalMarketValue : 0);
  const sortedWeights = [...weights].sort((a, b) => b - a);
  const maxSinglePosition = sortedWeights[0] ?? 0;
  const top3Concentration = (sortedWeights[0] ?? 0) + (sortedWeights[1] ?? 0) + (sortedWeights[2] ?? 0);
  const herfindahlIndex = weights.reduce((s, w) => s + w * w, 0);

  const warnings: string[] = [];
  let riskLevel: ConcentrationRisk["riskLevel"];
  if (maxSinglePosition > 0.40) {
    riskLevel = "highly_concentrated";
    warnings.push("Single position exceeds 40% of portfolio — extreme concentration risk.");
  } else if (maxSinglePosition > 0.25) {
    riskLevel = "concentrated";
    warnings.push("Single position exceeds 25% of portfolio — high concentration risk.");
  } else if (herfindahlIndex > 0.25) {
    riskLevel = "concentrated";
    warnings.push("Herfindahl index above 0.25 — portfolio is concentrated in a few positions.");
  } else if (top3Concentration > 0.60) {
    riskLevel = "moderate";
    warnings.push("Top 3 positions exceed 60% of portfolio — moderate concentration risk.");
  } else if (herfindahlIndex > 0.15) {
    riskLevel = "moderate";
  } else {
    riskLevel = "diversified";
  }

  if (top3Concentration > 0.80) {
    warnings.push("Top 3 positions exceed 80% of portfolio — consider diversifying.");
  }

  const directionalBias = totalBetaWeightedDelta > 50 ? "bullish" : totalBetaWeightedDelta < -50 ? "bearish" : "neutral";

  return {
    totalBetaWeightedDelta,
    totalMarketValue,
    netDelta,
    weightedDeltaBySymbol: weighted.sort((a, b) => Math.abs(b.betaWeightedDelta) - Math.abs(a.betaWeightedDelta)),
    concentrationRisk: {
      maxSinglePosition,
      top3Concentration,
      herfindahlIndex,
      riskLevel,
      warnings,
    },
    directionalBias,
    spyEquivalentExposure,
  };
}
