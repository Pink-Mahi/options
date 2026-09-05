/**
 * Opportunity-cost & "upside cap cost" metrics for covered-call comparison.
 *
 * These make the trade-off between premium and surrendered upside explicit,
 * which the spec calls a first-class metric.
 */

export interface UpsideCapComparison {
  optionA: { strike: number; premiumPerShare: number };
  optionB: { strike: number; premiumPerShare: number };
  extraPremiumPerShare: number; // A - B (signed)
  additionalUpsideSurrenderedPerShare: number; // B.strike - A.strike (signed, >0 means A gives up more)
  /** Premium received per $1 of additional upside surrendered. */
  premiumPerDollarOfUpsideSurrendered: number | null;
}

/**
 * Compare two covered-call candidates. Option A is the LOWER strike (more premium,
 * less upside). Returns the trade-off metrics.
 */
export function upsideCapCost(
  lowerStrikeOption: { strike: number; premiumPerShare: number },
  higherStrikeOption: { strike: number; premiumPerShare: number },
): UpsideCapComparison {
  const extraPremium =
    lowerStrikeOption.premiumPerShare - higherStrikeOption.premiumPerShare;
  const additionalUpsideSurrendered =
    higherStrikeOption.strike - lowerStrikeOption.strike;
  const premiumPerDollar =
    additionalUpsideSurrendered !== 0
      ? extraPremium / additionalUpsideSurrendered
      : null;
  return {
    optionA: lowerStrikeOption,
    optionB: higherStrikeOption,
    extraPremiumPerShare: extraPremium,
    additionalUpsideSurrenderedPerShare: additionalUpsideSurrendered,
    premiumPerDollarOfUpsideSurrendered: premiumPerDollar,
  };
}
