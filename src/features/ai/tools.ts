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
  {
    name: "priceOption",
    description:
      "Compute the theoretical option price and full Greeks using Black-Scholes (European) or the Cox-Ross-Rubinstein binomial model (American, allows early exercise). Also solves implied volatility from a market price and compares theoretical vs market value to show whether an option is rich or cheap. Use this when the provider does not supply Greeks, or to check if a premium is fairly priced.",
    parameters: {
      type: "object",
      properties: {
        spot: { type: "number", description: "Underlying price" },
        strike: { type: "number" },
        daysToExpiration: { type: "number" },
        volatility: { type: "number", description: "Implied volatility as a decimal, e.g. 0.30 for 30%" },
        optionType: { type: "string", description: "CALL or PUT" },
        model: { type: "string", description: "blackScholes or binomial (default blackScholes)" },
        riskFreeRate: { type: "number", description: "Annual rate as decimal, default 0.05" },
        dividendYield: { type: "number", description: "Annual dividend yield as decimal, default 0" },
        marketPrice: { type: "number", description: "Optional. If provided, solves implied volatility and reports the theoretical-vs-market edge." },
      },
      required: ["spot", "strike", "daysToExpiration", "optionType"],
    },
  },
  {
    name: "runBacktest",
    description:
      "Backtest a repeating options income strategy (covered call, cash-secured put, or wheel) over that symbol's real historical prices. Walks forward selecting strikes by delta target, prices premiums with Black-Scholes using trailing realized volatility, and reports win rate, total premium, assignment counts, Sharpe, max drawdown, and a buy-and-hold comparison. IMPORTANT: premiums are MODELED, not historical option quotes, so results are an approximation - always state this caveat.",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        strategy: { type: "string", description: "COVERED_CALL, CASH_SECURED_PUT, or WHEEL" },
        deltaTarget: { type: "number", description: "Target absolute delta for the short option, default 0.30" },
        dteTarget: { type: "number", description: "Days to expiration per cycle, default 45" },
        contracts: { type: "number", description: "Contracts per cycle, default 1" },
        range: { type: "string", description: "History window: 1y, 2y, 5y (default 2y)" },
      },
      required: ["symbol", "strategy"],
    },
  },
  {
    name: "analyzeMultiLegStrategy",
    description:
      "Analyze a multi-leg options strategy. Give it the legs and it auto-classifies the structure (bull put spread, bear call spread, iron condor, collar, poor man's covered call, etc.) and returns net premium (credit positive / debit negative), max profit, max loss, breakevens, risk-reward ratio, combined position Greeks, margin requirement, and the payoff curve.",
    parameters: {
      type: "object",
      properties: {
        underlyingPrice: { type: "number" },
        legs: {
          type: "array",
          description: "Each leg: { action: BUY|SELL, optionType: CALL|PUT, strike, pricePerShare, contracts, daysToExpiration, expiration }",
          items: {
            type: "object",
            properties: {
              action: { type: "string", description: "BUY or SELL" },
              optionType: { type: "string", description: "CALL or PUT" },
              strike: { type: "number" },
              pricePerShare: { type: "number", description: "Premium per share" },
              contracts: { type: "number" },
              daysToExpiration: { type: "number" },
              expiration: { type: "string", description: "YYYY-MM-DD" },
            },
            required: ["action", "optionType", "strike", "pricePerShare", "contracts", "daysToExpiration"],
          },
        },
      },
      required: ["underlyingPrice", "legs"],
    },
  },
  {
    name: "assessAssignmentRisk",
    description:
      "Assess early-assignment risk for a SHORT option position. Detects the dividend-capture case for short calls (long holder exercises early when extrinsic value is less than the upcoming dividend), the interest-cost case for deep-ITM short puts, and imminent expiration risk. Returns a risk level (none to very_high), the specific reasons, extrinsic value, days to ex-dividend, and a recommendation.",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Used to look up upcoming dividends" },
        optionType: { type: "string", description: "CALL or PUT" },
        strike: { type: "number" },
        daysToExpiration: { type: "number" },
        impliedVolatility: { type: "number", description: "Decimal, e.g. 0.30. Defaults to an estimate if omitted." },
      },
      required: ["symbol", "optionType", "strike", "daysToExpiration"],
    },
  },
  {
    name: "getPortfolioRisk",
    description:
      "Compute portfolio-level directional and concentration risk. Converts each holding's delta into SPY-equivalent beta-weighted delta (so exposure is comparable across names), and measures concentration via largest single position, top-3 weight, and the Herfindahl index. Returns a diversified/moderate/concentrated/highly_concentrated verdict with warnings.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "getMarketRegime",
    description:
      "Classify the current market regime from VIX and SPY's trend versus its 200-day moving average. Returns one of LOW_VOL_BULL, HIGH_VOL_BULL, LOW_VOL_SIDEWAYS, HIGH_VOL_SIDEWAYS, LOW_VOL_BEAR, HIGH_VOL_BEAR, CRISIS, plus a risk level and which options strategies suit that regime. Use this for context before recommending a strategy.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "estimateExecution",
    description:
      "Estimate a realistic fill price and fill probability for an option order, accounting for the bid-ask spread, slippage, and market impact from order size relative to volume. Compares MARKET, LIMIT, and MID order types and warns about wide spreads or thin open interest. Use this to show what a trade would ACTUALLY cost versus the quoted midpoint.",
    parameters: {
      type: "object",
      properties: {
        bid: { type: "number" },
        ask: { type: "number" },
        volume: { type: "number" },
        openInterest: { type: "number" },
        orderSize: { type: "number", description: "Number of contracts" },
        orderType: { type: "string", description: "MARKET, LIMIT, or MID" },
        limitPrice: { type: "number", description: "Required when orderType is LIMIT" },
      },
      required: ["bid", "ask", "orderSize", "orderType"],
    },
  },
];
