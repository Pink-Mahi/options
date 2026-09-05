/**
 * Tax awareness — classifies gains as short-term vs long-term, detects wash sales.
 *
 * Short-term: held <= 1 year, taxed at ordinary income rate
 * Long-term: held > 1 year, taxed at preferential rates (0/15/20%)
 * Wash sale: repurchased within 30 days of a loss → loss disallowed
 *
 * All functions are PURE and DETERMINISTIC. Unit-tested in ./tax.test.ts.
 */

export interface TaxLot {
  symbol: string;
  shares: number;
  purchaseDate: string; // ISO
  costBasis: number; // per share
  saleDate: string; // ISO
  salePrice: number; // per share
}

export type TermType = "short_term" | "long_term";

export interface TaxAnalysisResult {
  symbol: string;
  shares: number;
  proceeds: number;
  costBasis: number;
  gainLoss: number;
  term: TermType;
  holdingDays: number;
  estimatedTax: number;
  washSaleDisallowed: number;
  netAfterTax: number;
}

export interface TaxSummary {
  totalProceeds: number;
  totalCostBasis: number;
  totalGainLoss: number;
  shortTermGains: number;
  longTermGains: number;
  shortTermLosses: number;
  longTermLosses: number;
  totalEstimatedTax: number;
  washSaleDisallowed: number;
  lots: TaxAnalysisResult[];
}

const SHORT_TERM_DAYS = 365;
const SHORT_TERM_RATE = 0.32; // approximate marginal rate
const LONG_TERM_RATE = 0.15;

/**
 * Analyze a single tax lot for holding period and tax impact.
 */
export function analyzeTaxLot(
  lot: TaxLot,
  recentPurchases: TaxLot[] = [],
): TaxAnalysisResult {
  const purchaseDate = new Date(lot.purchaseDate);
  const saleDate = new Date(lot.saleDate);
  const holdingDays = Math.round((saleDate.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24));

  const term: TermType = holdingDays > SHORT_TERM_DAYS ? "long_term" : "short_term";
  const proceeds = lot.salePrice * lot.shares;
  const costBasis = lot.costBasis * lot.shares;
  const gainLoss = proceeds - costBasis;

  // Check wash sale: was there a repurchase within 30 days after the sale?
  // Or was this lot itself purchased within 30 days of a prior sale at a loss?
  let washSaleDisallowed = 0;
  if (gainLoss < 0) {
    for (const purchase of recentPurchases) {
      if (purchase.symbol !== lot.symbol) continue;
      const purchaseDate2 = new Date(purchase.purchaseDate);
      const daysFromSale = Math.round((purchaseDate2.getTime() - saleDate.getTime()) / (1000 * 60 * 60 * 24));
      // Repurchase within 30 days before or after the sale
      if (Math.abs(daysFromSale) <= 30) {
        washSaleDisallowed = Math.abs(gainLoss);
        break;
      }
    }
  }

  const taxableGain = gainLoss > 0 ? gainLoss : 0;
  const rate = term === "long_term" ? LONG_TERM_RATE : SHORT_TERM_RATE;
  const estimatedTax = taxableGain * rate;

  return {
    symbol: lot.symbol,
    shares: lot.shares,
    proceeds,
    costBasis,
    gainLoss,
    term,
    holdingDays,
    estimatedTax,
    washSaleDisallowed,
    netAfterTax: gainLoss - estimatedTax,
  };
}

/**
 * Build a tax summary across multiple lots.
 */
export function buildTaxSummary(lots: TaxAnalysisResult[]): TaxSummary {
  const totalProceeds = lots.reduce((s, l) => s + l.proceeds, 0);
  const totalCostBasis = lots.reduce((s, l) => s + l.costBasis, 0);
  const totalGainLoss = lots.reduce((s, l) => s + l.gainLoss, 0);

  const shortTerm = lots.filter((l) => l.term === "short_term");
  const longTerm = lots.filter((l) => l.term === "long_term");

  const shortTermGains = shortTerm.filter((l) => l.gainLoss > 0).reduce((s, l) => s + l.gainLoss, 0);
  const shortTermLosses = shortTerm.filter((l) => l.gainLoss < 0).reduce((s, l) => s + Math.abs(l.gainLoss), 0);
  const longTermGains = longTerm.filter((l) => l.gainLoss > 0).reduce((s, l) => s + l.gainLoss, 0);
  const longTermLosses = longTerm.filter((l) => l.gainLoss < 0).reduce((s, l) => s + Math.abs(l.gainLoss), 0);

  const totalEstimatedTax = lots.reduce((s, l) => s + l.estimatedTax, 0);
  const washSaleDisallowed = lots.reduce((s, l) => s + l.washSaleDisallowed, 0);

  return {
    totalProceeds,
    totalCostBasis,
    totalGainLoss,
    shortTermGains,
    longTermGains,
    shortTermLosses,
    longTermLosses,
    totalEstimatedTax,
    washSaleDisallowed,
    lots,
  };
}
