/**
 * Canonical domain models for the AI Options Income & Profit Calculator.
 *
 * These types are the SINGLE source of truth for financial objects across the
 * calculation engine, market-data providers, scanners, AI layer, and UI.
 *
 * Provider-specific response shapes must be normalized INTO these models.
 * The UI and calculation engine must never depend on a provider's raw format.
 */

/** ISO date string (YYYY-MM-DD) for calendar dates without time. */
export type DateString = string;

/** ISO timestamp string for instants. */
export type TimestampString = string;

export type OptionType = "CALL" | "PUT";

export type MarketSession = "pre" | "regular" | "post" | "closed";

/** Whether a value came directly from a provider or was calculated internally. */
export type Provenance = "provider" | "calculated" | "estimated" | "unknown";

export interface FieldMeta<T> {
  value: T;
  provenance: Provenance;
}

// ---------------------------------------------------------------------------
// Quote
// ---------------------------------------------------------------------------

export interface Quote {
  symbol: string;
  companyName: string;
  price: number;
  bid: number | null;
  ask: number | null;
  previousClose: number | null;
  open: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  marketCap: number | null;
  timestamp: TimestampString;
  marketSession: MarketSession;
  /** True only if the provider confirms real-time data. */
  isRealtime: boolean;
  /** "delayed" | "realtime" | "unknown" — affects how the UI labels freshness. */
  dataQuality: "realtime" | "delayed" | "unknown";
  /** Regular session close price (available after 4:00 PM ET; null during regular session). */
  regularSessionClose: number | null;
  /** Extended-hours last traded price (set when marketSession is "pre" or "post"). */
  extendedHoursPrice: number | null;
  /** Change from regular session close (or previous close in pre-market) to extended-hours price. */
  extendedHoursChange: number | null;
  /** Percent change for extended-hours move. */
  extendedHoursChangePercent: number | null;
  /** 52-week high price. */
  week52High: number | null;
  /** 52-week low price. */
  week52Low: number | null;
  /** 90-day average volume. */
  averageVolume: number | null;
}

// ---------------------------------------------------------------------------
// Historical prices
// ---------------------------------------------------------------------------

export interface HistoricalPricePoint {
  date: DateString;
  open: number;
  high: number;
  low: number;
  close: number;
  adjustedClose: number;
  volume: number | null;
}

export interface HistoricalPriceSeries {
  symbol: string;
  points: HistoricalPricePoint[];
  /** ISO timestamp when the series was fetched. */
  fetchedAt: TimestampString;
  /** Range requested, e.g. "5y", "max". */
  range: string;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface OptionExpiration {
  expirationDate: DateString;
  daysToExpiration: number;
  isWeekly: boolean;
  isMonthly: boolean;
  isQuarterly: boolean;
  isLEAP: boolean;
}

export interface Greeks {
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
}

export interface OptionContract {
  symbol: string; // OCC option symbol
  underlyingSymbol: string;
  optionType: OptionType;
  strike: number;
  expiration: DateString;
  daysToExpiration: number;
  bid: number | null;
  ask: number | null;
  midpoint: number | null;
  last: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
  greeks: Greeks;
  intrinsicValue: number | null;
  extrinsicValue: number | null;
  inTheMoney: boolean;
  underlyingPrice: number;
  quoteTimestamp: TimestampString;
  /** Per-provider provenance for Greeks/IV — were they provided or calculated? */
  greeksProvenance: Provenance;
}

export interface OptionChain {
  underlyingSymbol: string;
  expiration: DateString;
  underlyingPrice: number;
  calls: OptionContract[];
  puts: OptionContract[];
  quoteTimestamp: TimestampString;
}

// ---------------------------------------------------------------------------
// Corporate events
// ---------------------------------------------------------------------------

export interface DividendEvent {
  symbol: string;
  exDate: DateString;
  payDate: DateString | null;
  amount: number;
  frequency: string | null;
}

export interface EarningsEvent {
  symbol: string;
  date: DateString;
  timing: "pre" | "post" | "unspecified" | null;
  confirmed: boolean;
}

export interface CorporateEvents {
  symbol: string;
  dividends: DividendEvent[];
  earnings: EarningsEvent[];
  fetchedAt: TimestampString;
}

// ---------------------------------------------------------------------------
// News & sentiment
// ---------------------------------------------------------------------------

export interface NewsArticle {
  id: string;
  symbol: string;
  headline: string;
  summary: string | null;
  url: string;
  source: string;
  publishedAt: TimestampString;
  /** AI-generated sentiment if analyzed, null if not yet analyzed. */
  sentiment: NewsSentiment | null;
}

export interface NewsSentiment {
  /** Overall sentiment classification. */
  label: "bullish" | "bearish" | "neutral";
  /** Confidence 0-1. */
  confidence: number;
  /** Sentiment score -1 (very bearish) to +1 (very bullish). */
  score: number;
  /** Estimated price impact: "high", "medium", "low". */
  impact: "high" | "medium" | "low";
  /** Key topics/themes extracted from the article. */
  topics: string[];
  /** AI-generated summary of why this matters for the stock. */
  reasoning: string;
  /** How this affects options strategy (covered calls / CSPs). */
  optionsImplication: string;
}

export interface NewsSentimentReport {
  symbol: string;
  articles: NewsArticle[];
  aggregate: {
    totalArticles: number;
    bullishCount: number;
    bearishCount: number;
    neutralCount: number;
    averageScore: number; // -1 to +1
    overallSentiment: "bullish" | "bearish" | "neutral";
    confidence: number;
    highImpactArticles: NewsArticle[];
    keyTopics: { topic: string; count: number; sentiment: "bullish" | "bearish" | "neutral" }[];
  };
  aiAnalysis: string;
  aiPowered: boolean;
  warnings: string[];
  fetchedAt: TimestampString;
}

// ---------------------------------------------------------------------------
// Earnings analysis
// ---------------------------------------------------------------------------

export interface EarningsHistoricalReaction {
  date: string;
  actualEps: number | null;
  estimatedEps: number | null;
  surprise: number | null; // actual - estimated
  surprisePercent: number | null;
  /** Stock move from close before earnings to close after earnings. */
  priceMovePercent: number | null;
  /** Direction of the move. */
  direction: "up" | "down" | "flat" | null;
  preEarningsClose: number | null;
  postEarningsClose: number | null;
}

export interface EarningsAnalysis {
  symbol: string;
  nextEarnings: {
    date: string | null;
    timing: "pre" | "post" | "unspecified" | null;
    confirmed: boolean;
    daysUntil: number | null;
  };
  historicalReactions: EarningsHistoricalReaction[];
  statistics: {
    avgMovePercent: number | null;
    medianMovePercent: number | null;
    maxUpMove: number | null;
    maxDownMove: number | null;
    beatRate: number | null; // fraction where actual > estimated
    avgSurprisePercent: number | null;
    upMoveFrequency: number | null; // fraction that went up
    sampleSize: number;
  };
  /** Estimated expected move for next earnings based on historical avg. */
  expectedMove: {
    basedOnAvg: number | null;
    basedOnMedian: number | null;
    basedOnAtmIv: number | null;
    note: string;
  };
  /** IV crush estimate: typical IV drop after earnings. */
  ivCrush: {
    typicalPostEarningsIvDropPercent: number | null;
    note: string;
  };
  strategyImplications: string;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Sector & peer comparison
// ---------------------------------------------------------------------------

export interface PeerMetrics {
  symbol: string;
  name: string;
  price: number;
  marketCap: number | null;
  peRatio: number | null;
  dividendYield: number | null;
  beta: number | null;
  yearToDateReturn: number | null;
  oneYearReturn: number | null;
  volatility: number | null;
  /** ATM IV if available. */
  impliedVolatility: number | null;
}

export interface PeerComparison {
  symbol: string;
  sector: string | null;
  industry: string | null;
  targetMetrics: PeerMetrics;
  peers: PeerMetrics[];
  spyBenchmark: PeerMetrics | null;
  rankings: {
    metric: string;
    targetRank: number;
    totalPeers: number;
    targetValue: string;
  }[];
  analysis: string;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

export interface StockLot {
  id: string;
  portfolioId: string;
  symbol: string;
  shares: number;
  purchaseDate: DateString;
  costBasisPerShare: number;
  totalCostBasis: number;
  brokerAccount: string | null;
  notes: string | null;
  protectedFromCalls: boolean;
}

export type PositionStatus =
  | "OPEN"
  | "EXPIRED_WORTHLESS"
  | "ASSIGNED"
  | "BOUGHT_BACK"
  | "ROLLED"
  | "CLOSED";

export type StrategyType =
  | "COVERED_CALL"
  | "CASH_SECURED_PUT"
  | "NAKED"
  | "LONG"
  | "WHEEL"
  | "OTHER";

export interface OptionPosition {
  id: string;
  symbol: string;
  optionType: OptionType;
  strategyType: StrategyType;
  strike: number;
  expiration: DateString;
  contracts: number;
  openingPrice: number;
  openingCreditDebit: number;
  openDate: DateString;
  currentPrice: number | null;
  status: PositionStatus;
  relatedStockLotIds: string[];
  assignmentStatus: string | null;
  closeDate: DateString | null;
  closingPrice: number | null;
  realizedProfitLoss: number | null;
  deltaAtEntry: number | null;
  ivAtEntry: number | null;
  dteAtEntry: number | null;
  reasonForTrade: string | null;
  userGoal: string | null;
  closingNotes: string | null;
}

export type RiskProfile =
  | "conservative"
  | "balanced"
  | "income"
  | "max_total_return"
  | "leaps"
  | "put_entry";

export interface PortfolioGoal {
  id: string;
  portfolioId: string;
  symbol: string | null; // null = portfolio-wide default
  monthlyIncomeTarget: number | null;
  annualIncomeTarget: number | null;
  annualTotalReturnTarget: number | null;
  minimumOTMPercent: number | null;
  maximumDelta: number | null;
  preferredDteMin: number | null;
  preferredDteMax: number | null;
  minimumPremiumYield: number | null;
  maximumAssignmentProbability: number | null;
  minimumSharesUncovered: number | null;
  earningsPreference: "exclude" | "warn" | "include" | null;
  dividendPreference: "exclude" | "warn" | "include" | null;
  riskProfile: RiskProfile | null;
  strategyPreference: string | null;
}

export interface Portfolio {
  id: string;
  userId: string;
  name: string;
  cashAvailable: number;
  stockLots: StockLot[];
  optionPositions: OptionPosition[];
  goals: PortfolioGoal[];
  watchlist: WatchlistEntry[];
  alerts: AlertEntry[];
}

// ---------------------------------------------------------------------------
// Watchlist & alerts
// ---------------------------------------------------------------------------

export interface WatchlistEntry {
  id: string;
  portfolioId: string;
  symbol: string;
  notes: string | null;
  targetPrice: number | null;
  targetIv: number | null;
  targetYield: number | null;
  createdAt: string;
}

export type AlertRuleType =
  | "price_above"
  | "price_below"
  | "iv_above"
  | "iv_below"
  | "yield_above"
  | "yield_below"
  | "earnings_within_days"
  | "delta_above"
  | "delta_below"
  | "assignment_risk_above";

export interface AlertEntry {
  id: string;
  portfolioId: string;
  symbol: string | null;
  ruleType: AlertRuleType;
  parameters: {
    threshold?: number;
    expiration?: string;
    strike?: number;
  };
  enabled: boolean;
  lastFiredAt: string | null;
  createdAt: string;
}

export interface AlertEvaluation {
  alert: AlertEntry;
  currentValue: number | null;
  triggered: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Pricing assumptions
// ---------------------------------------------------------------------------

export type PriceAssumption = "bid" | "midpoint" | "ask" | "last" | "custom";

export interface OptionPriceAssumption {
  type: PriceAssumption;
  /** Resolved price per share actually used in calculations. */
  pricePerShare: number;
  bid: number | null;
  ask: number | null;
  midpoint: number | null;
  last: number | null;
}

// ---------------------------------------------------------------------------
// Scanner filters & candidates
// ---------------------------------------------------------------------------

export type ScannerObjective =
  | "max_immediate_income"
  | "max_annualized_premium"
  | "max_total_return"
  | "lowest_assignment_probability"
  | "max_upside_retained"
  | "balanced_income_upside"
  | "cash_secured_put_entry"
  | "long_term_tax_aware"
  | "leaps_income_growth";

export interface LiquidityFilters {
  minOpenInterest: number | null;
  minVolume: number | null;
  maxBidAskSpreadPercent: number | null;
}

export interface CoveredCallFilters {
  symbol: string;
  sharesAvailable: number;
  costBasisPerShare: number | null;
  minDte: number | null;
  maxDte: number | null;
  minOtmPercent: number | null;
  maxOtmPercent: number | null;
  minDelta: number | null;
  maxDelta: number | null;
  minPremiumPerContract: number | null;
  minPremiumYield: number | null;
  minAnnualizedPremiumYield: number | null;
  minMaxTotalReturn: number | null;
  minAnnualizedMaxTotalReturn: number | null;
  minHistoricalProbabilityBelowStrike: number | null;
  requireStrikeAboveCostBasis: boolean;
  requireStrikeAboveTargetPrice: number | null;
  excludeEarnings: boolean;
  excludeDividends: boolean;
  liquidity: LiquidityFilters;
  objective: ScannerObjective;
}

export interface CashSecuredPutFilters {
  symbol: string;
  cashAvailable: number;
  minDte: number | null;
  maxDte: number | null;
  maxDelta: number | null;
  minDelta: number | null;
  targetEffectivePurchasePrice: number | null;
  minDiscountPercent: number | null;
  minPremiumYield: number | null;
  minAnnualizedYield: number | null;
  maxCapitalRequired: number | null;
  minIvPercentile: number | null;
  excludeEarnings: boolean;
  liquidity: LiquidityFilters;
  objective: ScannerObjective;
}

// ---------------------------------------------------------------------------
// Calculated candidate results (produced by the calculation engine)
// ---------------------------------------------------------------------------

export interface CoveredCallCandidate {
  contract: OptionContract;
  priceAssumption: OptionPriceAssumption;
  // Core premium metrics
  premiumPerShare: number;
  premiumPerContract: number;
  premiumIncome: number; // for the chosen number of contracts
  contracts: number;
  // Returns
  premiumYield: number; // on current stock value
  premiumYieldOnCost: number | null; // on cost basis when provided
  annualizedPremiumYield: number; // simple
  compoundedAnnualizedPremiumYield: number;
  // Strike / upside
  strikeOtmPercent: number;
  potentialStockAppreciation: number;
  maxProfitPerShare: number;
  maxTotalReturn: number; // on current market value
  maxTotalReturnOnCost: number | null;
  annualizedMaxTotalReturn: number;
  // Risk
  breakEven: number;
  downsideProtectionPercent: number;
  delta: number | null;
  estimatedAssignmentProbability: number | null;
  // Greeks / IV
  theta: number | null;
  gamma: number | null;
  impliedVolatility: number | null;
  // Liquidity
  openInterest: number | null;
  volume: number | null;
  bidAskSpread: number | null;
  bidAskSpreadPercent: number | null;
  liquidityScore: number; // 0-100
  // Events
  earningsBeforeExpiration: boolean;
  exDividendBeforeExpiration: boolean;
  // Efficiency metrics
  premiumPerDay: number;
  premiumYieldPerDay: number;
  // Scoring
  score: CoveredCallScore;
}

export interface CoveredCallScore {
  total: number; // 0-100
  income: number;
  upsidePreservation: number;
  assignmentRisk: number;
  liquidity: number;
  volatilityPremium: number;
  historicalDistance: number;
  totalReturn: number;
}

export interface CashSecuredPutCandidate {
  contract: OptionContract;
  priceAssumption: OptionPriceAssumption;
  premiumPerShare: number;
  premiumPerContract: number;
  premiumIncome: number;
  contracts: number;
  grossCollateral: number;
  netCapitalAtRisk: number;
  returnOnGrossCollateral: number;
  returnOnNetCapital: number;
  annualizedReturnOnGross: number;
  annualizedReturnOnNet: number;
  effectivePurchasePrice: number;
  breakEven: number;
  discountToCurrentPrice: number;
  strikeDiscountPercent: number;
  delta: number | null;
  estimatedAssignmentProbability: number | null;
  impliedVolatility: number | null;
  openInterest: number | null;
  volume: number | null;
  bidAskSpread: number | null;
  bidAskSpreadPercent: number | null;
  liquidityScore: number;
  earningsBeforeExpiration: boolean;
  exDividendBeforeExpiration: boolean;
  premiumPerDay: number;
  score: CashSecuredPutScore;
}

export interface CashSecuredPutScore {
  total: number;
  income: number;
  entryQuality: number;
  assignmentRisk: number;
  liquidity: number;
  volatilityPremium: number;
}

// ---------------------------------------------------------------------------
// Historical analytics
// ---------------------------------------------------------------------------

export interface HistoricalReturns {
  oneMonthReturn: number | null;
  threeMonthReturn: number | null;
  sixMonthReturn: number | null;
  oneYearReturn: number | null;
  threeYearReturn: number | null;
  fiveYearReturn: number | null;
  annualizedVolatility: number | null;
  maxDrawdown: number | null;
  avgMonthlyReturn: number | null;
  avgAnnualReturn: number | null;
  high52Week: number | null;
  low52Week: number | null;
  distanceFrom52WeekHigh: number | null;
  distanceFrom52WeekLow: number | null;
}

export interface MovingAverage {
  period: number;
  value: number;
  priceAbove: boolean;
}

export interface RollingReturnDistribution {
  windowDays: number;
  sampleSize: number;
  median: number;
  mean: number;
  stdDev: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  percentExceedingThreshold: number; // threshold = strike return
  percentDecliningBelowBreakEven: number;
}

export interface ImpliedVolatilityContext {
  currentIv: number | null;
  ivPercentile: number | null;
  ivRank: number | null;
  hv30: number | null;
  hv90: number | null;
  hv1Year: number | null;
  ivRealizedSpread: number | null;
}

// ---------------------------------------------------------------------------
// Payoff graph
// ---------------------------------------------------------------------------

export interface PayoffPoint {
  stockPrice: number;
  stockOnlyPnl: number;
  optionPnl: number;
  combinedPnl: number;
  combinedReturnPercent: number;
}

export interface PayoffSeries {
  points: PayoffPoint[];
  breakEven: number;
  strike: number;
  currentPrice: number;
  maxProfit: number;
  costBasis: number | null;
}
