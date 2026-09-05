/**
 * AI tool contracts — the structured function schemas the AI calls to retrieve
 * data and calculations. The server executes these; the AI only interprets.
 *
 * These are defined now (Phase 4) so the scanner/calculator APIs are shaped
 * correctly for Phase 5 function calling. The AI never fabricates financial
 * inputs — it always goes through these tools.
 */

import type { AIToolDefinition } from "./provider";

export const AI_TOOLS: AIToolDefinition[] = [
  {
    name: "searchStock",
    description: "Search for a stock by ticker or company name. Returns matching symbols.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "getQuote",
    description: "Get the current normalized quote for a symbol.",
    parameters: {
      type: "object",
      properties: { symbol: { type: "string" } },
      required: ["symbol"],
    },
  },
  {
    name: "getExpirations",
    description: "List available option expiration dates for a symbol.",
    parameters: {
      type: "object",
      properties: { symbol: { type: "string" } },
      required: ["symbol"],
    },
  },
  {
    name: "getOptionChain",
    description: "Get the full normalized option chain for a symbol and expiration.",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        expiration: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["symbol", "expiration"],
    },
  },
  {
    name: "scanCoveredCalls",
    description:
      "Scan covered-call candidates for a symbol using deterministic filters. Returns ranked candidates with all calculated metrics.",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        sharesAvailable: { type: "number" },
        costBasis: { type: "number" },
        targetDte: { type: "number", description: "Target days to expiration for expiration selection (default 45)" },
        minDte: { type: "number" },
        maxDte: { type: "number" },
        minOtmPercent: { type: "number" },
        maxDelta: { type: "number" },
        minDelta: { type: "number" },
        minPremiumYield: { type: "number" },
        minAnnualizedPremiumYield: { type: "number" },
        requireStrikeAboveCostBasis: { type: "boolean" },
        requireStrikeAboveTargetPrice: { type: "number" },
        excludeEarnings: { type: "boolean" },
        minOpenInterest: { type: "number" },
        objective: { type: "string" },
      },
      required: ["symbol", "sharesAvailable", "objective"],
    },
  },
  {
    name: "scanCashSecuredPuts",
    description:
      "Scan cash-secured-put candidates using deterministic filters. Returns ranked candidates with effective entry prices.",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        cashAvailable: { type: "number" },
        targetEffectivePurchasePrice: { type: "number" },
        targetDte: { type: "number", description: "Target days to expiration for expiration selection (default 45)" },
        minDte: { type: "number" },
        maxDte: { type: "number" },
        maxDelta: { type: "number" },
        minDelta: { type: "number" },
        minDiscountPercent: { type: "number" },
        minPremiumYield: { type: "number" },
        minAnnualizedYield: { type: "number" },
        maxCapitalRequired: { type: "number" },
        excludeEarnings: { type: "boolean" },
        minOpenInterest: { type: "number" },
        objective: { type: "string" },
      },
      required: ["symbol", "cashAvailable", "objective"],
    },
  },
  {
    name: "calculateCoveredCall",
    description: "Calculate full covered-call metrics for a specific contract.",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        expiration: { type: "string" },
        strike: { type: "number" },
        contracts: { type: "number" },
        costBasisPerShare: { type: "number" },
      },
      required: ["symbol", "expiration", "strike", "contracts"],
    },
  },
  {
    name: "calculateCashSecuredPut",
    description: "Calculate full cash-secured-put metrics for a specific contract.",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        expiration: { type: "string" },
        strike: { type: "number" },
        contracts: { type: "number" },
      },
      required: ["symbol", "expiration", "strike", "contracts"],
    },
  },
  {
    name: "getPortfolio",
    description: "Get the user's portfolio holdings, option positions, and goals.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "analyzePortfolioIncome",
    description:
      "Analyze whether the portfolio can meet a monthly income target under constraints. Returns feasibility, gap, and candidate trades.",
    parameters: {
      type: "object",
      properties: {
        portfolioId: { type: "string" },
        monthlyIncomeTarget: { type: "number" },
      },
      required: ["portfolioId", "monthlyIncomeTarget"],
    },
  },
  {
    name: "calculateHistoricalMoveProbability",
    description:
      "Calculate the historical frequency with which the stock exceeded a given return over rolling windows matching the option DTE.",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        windowDays: { type: "number" },
        thresholdReturn: { type: "number" },
      },
      required: ["symbol", "windowDays", "thresholdReturn"],
    },
  },
  {
    name: "getIVAnalytics",
    description:
      "Get current ATM implied volatility, IV percentile, IV rank, and the expected move (1 standard deviation) for a symbol.",
    parameters: {
      type: "object",
      properties: { symbol: { type: "string" } },
      required: ["symbol"],
    },
  },
  {
    name: "runMonteCarlo",
    description:
      "Run a Monte Carlo simulation comparing covered-call strategy vs buy-and-hold using bootstrapped historical returns. Returns distribution statistics. NOT a prediction.",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        paths: { type: "number" },
        horizonDays: { type: "number" },
        periodDte: { type: "number" },
        strikeOtmPercent: { type: "number" },
        premiumYieldPerPeriod: { type: "number" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "getTechnicalIndicators",
    description:
      "Get all technical indicators (RSI, MACD, Bollinger Bands, Stochastic, ATR, OBV, ADX, VWAP, Ichimoku, Parabolic SAR, moving averages) with a bullish/bearish signal summary for a symbol.",
    parameters: {
      type: "object",
      properties: { symbol: { type: "string" } },
      required: ["symbol"],
    },
  },
  {
    name: "analyzePattern",
    description:
      "AI-powered pattern analysis: examines all technical indicators and recent price/volume action to identify what historical pattern the current configuration resembles, with a probabilistic outlook. NOT a prediction.",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        horizon: { type: "number", description: "Outlook horizon in days (7-90)" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "getNews",
    description:
      "Fetch recent news articles for a stock and analyze sentiment (bullish/bearish/neutral) with impact scores and options strategy implications. Returns aggregate sentiment + per-article analysis.",
    parameters: {
      type: "object",
      properties: { symbol: { type: "string" } },
      required: ["symbol"],
    },
  },
  {
    name: "getEarningsAnalysis",
    description:
      "Analyze historical earnings reactions (avg move, max up/down, beat rate), next earnings date, expected move, IV crush estimate, and optimal options strategy for earnings season.",
    parameters: {
      type: "object",
      properties: { symbol: { type: "string" } },
      required: ["symbol"],
    },
  },
  {
    name: "getPeerComparison",
    description:
      "Compare a stock's metrics (return, volatility, yield) against sector peers and SPY benchmark. Returns rankings and analysis.",
    parameters: {
      type: "object",
      properties: { symbol: { type: "string" } },
      required: ["symbol"],
    },
  },
];
