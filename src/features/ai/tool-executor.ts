/**
 * AI tool executor.
 *
 * When the AI requests a tool call, the chat orchestrator invokes this module
 * to actually run the deterministic scanner/calculator/market-data function
 * and return a JSON result the AI can cite. The AI never executes code itself.
 *
 * Every result includes a `dataQuality` note and the source timestamp so the
 * AI can label freshness. Results are deliberately compact (token-efficient).
 */

import "server-only";
import { getExpirations, getHistoricalPrices, getOptionChain, getQuote } from "@/features/market-data/service";
import { scanCashSecuredPuts, scanCoveredCalls } from "@/features/options/scanner";
import { calculateCashSecuredPut } from "@/lib/calculations/cash-secured-put";
import { calculateCoveredCall } from "@/lib/calculations/covered-call";
import { rollingReturnDistribution } from "@/lib/calculations/historical";
import { getPortfolio } from "@/lib/database/portfolio-repo";
import { analyzePortfolioIncome } from "@/features/portfolio/income-planner";
import { blackScholes, binomialAmerican, impliedVolatility } from "@/lib/calculations/pricing-model";
import { runBacktest, type BacktestStrategy } from "@/lib/calculations/backtester";
import { analyzeMultiLegStrategy, type StrategyLeg, type LegAction } from "@/lib/calculations/multi-leg";
import { assessAssignmentRisk } from "@/lib/calculations/assignment-risk";
import { computeBetaWeightedDelta, type PositionDelta } from "@/lib/calculations/beta-risk";
import { getMarketRegimeSnapshot } from "@/features/market-data/regime-service";
import { estimateExecution } from "@/lib/calculations/execution";
import { runWalkForward, DEFAULT_WALK_FORWARD_CONFIG } from "@/lib/quant/walk-forward";
import { computeCostAwareLevels, computeVolTargetSizing } from "@/lib/calculations/position-sizing";
import { runStrategyAdvisor } from "@/lib/calculations/strategy-advisor";
import { computeAllIndicators } from "@/lib/calculations/indicators";
import { getCorporateEvents } from "@/features/market-data/service";
import type { CashSecuredPutCandidate, CoveredCallCandidate, OptionType, ScannerObjective } from "@/lib/types";

export interface ToolExecutionResult {
  name: string;
  /** JSON-serializable payload returned to the AI. */
  result: unknown;
  /** Surfaces data-quality issues to the AI so it can caveat its answer. */
  warnings: string[];
  /** True if the tool call itself was malformed. */
  error?: string;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  userId?: string,
): Promise<ToolExecutionResult> {
  try {
    switch (name) {
      case "getQuote":
        return await execGetQuote(args);
      case "getExpirations":
        return await execGetExpirations(args);
      case "getOptionChain":
        return await execGetOptionChain(args);
      case "scanCoveredCalls":
        return await execScanCoveredCalls(args);
      case "scanCashSecuredPuts":
        return await execScanCashSecuredPuts(args);
      case "calculateCoveredCall":
        return await execCalculateCoveredCall(args);
      case "calculateCashSecuredPut":
        return await execCalculateCashSecuredPut(args);
      case "getPortfolio":
        return await execGetPortfolio(userId);
      case "analyzePortfolioIncome":
        return await execAnalyzePortfolioIncome(args, userId);
      case "calculateHistoricalMoveProbability":
        return await execHistoricalMoveProbability(args);
      case "getIVAnalytics":
        return await execIVAnalytics(args);
      case "runMonteCarlo":
        return await execMonteCarlo(args);
      case "getTechnicalIndicators":
        return await execTechnicalIndicators(args);
      case "analyzePattern":
        return await execPatternAnalysis(args);
      case "getNews":
        return await execNews(args);
      case "getEarningsAnalysis":
        return await execEarnings(args);
      case "getPeerComparison":
        return await execPeers(args);
      case "priceOption":
        return execPriceOption(args);
      case "runBacktest":
        return await execRunBacktest(args);
      case "analyzeMultiLegStrategy":
        return execMultiLeg(args);
      case "assessAssignmentRisk":
        return await execAssignmentRisk(args);
      case "getPortfolioRisk":
        return await execPortfolioRisk(userId);
      case "getMarketRegime":
        return await execMarketRegime();
      case "estimateExecution":
        return execEstimateExecution(args);
      case "runWalkForward":
        return await execWalkForward(args);
      case "getPositionSizing":
        return execPositionSizing(args);
      case "getStrategyAdvisor":
        return await execStrategyAdvisor(args);
      case "searchStock":
        return { name, result: { note: "Search by exact symbol is supported via getQuote.", symbol: String(args.query ?? "").toUpperCase() }, warnings: [] };
      default:
        return { name, result: null, warnings: [`Unknown tool: ${name}`], error: "unknown_tool" };
    }
  } catch (e) {
    return {
      name,
      result: null,
      warnings: [`Tool ${name} failed: ${(e as Error).message}`],
      error: (e as Error).message,
    };
  }
}

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

async function execGetQuote(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const symbol = str(args.symbol);
  const res = await getQuote({ symbol });
  const q = res.data;
  return {
    name: "getQuote",
    result: {
      symbol: q.symbol,
      company: q.companyName,
      price: q.price,
      bid: q.bid,
      ask: q.ask,
      change: q.change,
      changePercent: q.changePercent,
      volume: q.volume,
      marketSession: q.marketSession,
      regularSessionClose: q.regularSessionClose,
      extendedHoursPrice: q.extendedHoursPrice,
      extendedHoursChange: q.extendedHoursChange,
      extendedHoursChangePercent: q.extendedHoursChangePercent,
      previousClose: q.previousClose,
      week52High: q.week52High,
      week52Low: q.week52Low,
      timestamp: q.timestamp,
      dataQuality: q.dataQuality,
      fromCache: res.fromCache,
    },
    warnings: res.dataQuality === "delayed" ? ["Quote data is delayed."] : [],
  };
}

async function execGetExpirations(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const symbol = str(args.symbol);
  const res = await getExpirations({ symbol });
  return {
    name: "getExpirations",
    result: {
      symbol,
      expirations: res.data.slice(0, 20).map((e) => ({
        date: e.expirationDate,
        dte: e.daysToExpiration,
        isLEAP: e.isLEAP,
      })),
      total: res.data.length,
      fromCache: res.fromCache,
    },
    warnings: [],
  };
}

async function execGetOptionChain(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const symbol = str(args.symbol);
  const expiration = str(args.expiration);
  const res = await getOptionChain({ symbol, expiration });
  // Compact: only summary fields, top 30 each side by volume.
  const topCalls = [...res.data.calls].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)).slice(0, 30);
  const topPuts = [...res.data.puts].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)).slice(0, 30);
  return {
    name: "getOptionChain",
    result: {
      symbol,
      expiration,
      underlyingPrice: res.data.underlyingPrice,
      calls: topCalls.map(compactContract),
      puts: topPuts.map(compactContract),
      fromCache: res.fromCache,
      dataQuality: res.dataQuality,
    },
    warnings: res.dataQuality === "delayed" ? ["Option chain is delayed."] : [],
  };
}

async function execScanCoveredCalls(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const symbol = str(args.symbol);
  const sharesAvailable = num(args.sharesAvailable) ?? 100;
  const costBasis = args.costBasis != null ? num(args.costBasis) : null;
  const objective = (str(args.objective) as ScannerObjective) || "balanced_income_upside";
  const expirations = await getExpirations({ symbol });
  // Pick a representative near-term expiration (closest to 45 DTE) unless caller specified one.
  const targetDte = num(args.targetDte) ?? 45;
  const expiration = pickClosestExpiration(expirations.data, targetDte);
  if (!expiration) return { name: "scanCoveredCalls", result: { candidates: [], reason: "No expirations available" }, warnings: [] };

  const chain = await getOptionChain({ symbol, expiration: expiration.expirationDate });
  const earningsDate = await getEarningsDate(symbol);
  const candidates = scanCoveredCalls(
    chain.data,
    {
      symbol,
      sharesAvailable,
      costBasisPerShare: costBasis,
      minDte: num(args.minDte),
      maxDte: num(args.maxDte),
      minOtmPercent: num(args.minOtmPercent),
      maxOtmPercent: null,
      minDelta: num(args.minDelta),
      maxDelta: num(args.maxDelta),
      minPremiumPerContract: null,
      minPremiumYield: num(args.minPremiumYield),
      minAnnualizedPremiumYield: num(args.minAnnualizedPremiumYield),
      minMaxTotalReturn: null,
      minAnnualizedMaxTotalReturn: null,
      minHistoricalProbabilityBelowStrike: null,
      requireStrikeAboveCostBasis: Boolean(args.requireStrikeAboveCostBasis),
      requireStrikeAboveTargetPrice: num(args.requireStrikeAboveTargetPrice),
      excludeEarnings: args.excludeEarnings !== false,
      excludeDividends: false,
      liquidity: { minOpenInterest: num(args.minOpenInterest), minVolume: null, maxBidAskSpreadPercent: null },
      objective,
    },
    earningsDate,
    null,
  );
  return {
    name: "scanCoveredCalls",
    result: {
      symbol,
      expiration: expiration.expirationDate,
      underlyingPrice: chain.data.underlyingPrice,
      candidatesCount: candidates.length,
      topCandidates: candidates.slice(0, 8).map(compactCoveredCall),
      fromCache: chain.fromCache,
    },
    warnings: candidates.length === 0 ? ["No covered calls matched the filters. This is a valid no-trade result."] : [],
  };
}

async function execScanCashSecuredPuts(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const symbol = str(args.symbol);
  const cashAvailable = num(args.cashAvailable) ?? 10000;
  const objective = (str(args.objective) as ScannerObjective) || "cash_secured_put_entry";
  const expirations = await getExpirations({ symbol });
  const targetDte = num(args.targetDte) ?? 45;
  const expiration = pickClosestExpiration(expirations.data, targetDte);
  if (!expiration) return { name: "scanCashSecuredPuts", result: { candidates: [], reason: "No expirations available" }, warnings: [] };

  const chain = await getOptionChain({ symbol, expiration: expiration.expirationDate });
  const earningsDate = await getEarningsDate(symbol);
  const candidates = scanCashSecuredPuts(
    chain.data,
    {
      symbol,
      cashAvailable,
      minDte: num(args.minDte),
      maxDte: num(args.maxDte),
      maxDelta: num(args.maxDelta),
      minDelta: num(args.minDelta),
      targetEffectivePurchasePrice: num(args.targetEffectivePurchasePrice),
      minDiscountPercent: num(args.minDiscountPercent),
      minPremiumYield: num(args.minPremiumYield),
      minAnnualizedYield: num(args.minAnnualizedYield),
      maxCapitalRequired: num(args.maxCapitalRequired),
      minIvPercentile: null,
      excludeEarnings: args.excludeEarnings !== false,
      liquidity: { minOpenInterest: num(args.minOpenInterest), minVolume: null, maxBidAskSpreadPercent: null },
      objective,
    },
    earningsDate,
    null,
  );
  return {
    name: "scanCashSecuredPuts",
    result: {
      symbol,
      expiration: expiration.expirationDate,
      underlyingPrice: chain.data.underlyingPrice,
      candidatesCount: candidates.length,
      topCandidates: candidates.slice(0, 8).map(compactCsp),
      fromCache: chain.fromCache,
    },
    warnings: candidates.length === 0 ? ["No cash-secured puts matched the filters. This is a valid no-trade result."] : [],
  };
}

async function execCalculateCoveredCall(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const symbol = str(args.symbol);
  const expiration = str(args.expiration);
  const strike = num(args.strike);
  const contracts = num(args.contracts) ?? 1;
  const costBasis = args.costBasisPerShare != null ? num(args.costBasisPerShare) : null;
  if (strike == null) return { name: "calculateCoveredCall", result: null, warnings: ["strike required"], error: "missing_strike" };
  const chain = await getOptionChain({ symbol, expiration });
  const call = chain.data.calls.find((c) => Math.abs(c.strike - strike) < 1e-6);
  if (!call) return { name: "calculateCoveredCall", result: null, warnings: [`Strike ${strike} not found in chain`], error: "strike_not_found" };
  const earningsDate = await getEarningsDate(symbol);
  const c = calculateCoveredCall({ contract: call, contracts, currentPrice: chain.data.underlyingPrice, costBasisPerShare: costBasis, earningsDate });
  return { name: "calculateCoveredCall", result: compactCoveredCall(c), warnings: [] };
}

async function execCalculateCashSecuredPut(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const symbol = str(args.symbol);
  const expiration = str(args.expiration);
  const strike = num(args.strike);
  const contracts = num(args.contracts) ?? 1;
  if (strike == null) return { name: "calculateCashSecuredPut", result: null, warnings: ["strike required"], error: "missing_strike" };
  const chain = await getOptionChain({ symbol, expiration });
  const put = chain.data.puts.find((p) => Math.abs(p.strike - strike) < 1e-6);
  if (!put) return { name: "calculateCashSecuredPut", result: null, warnings: [`Strike ${strike} not found in chain`], error: "strike_not_found" };
  const earningsDate = await getEarningsDate(symbol);
  const c = calculateCashSecuredPut({ contract: put, contracts, currentPrice: chain.data.underlyingPrice, earningsDate });
  return { name: "calculateCashSecuredPut", result: compactCsp(c), warnings: [] };
}

async function execGetPortfolio(userId?: string): Promise<ToolExecutionResult> {
  if (!userId) return { name: "getPortfolio", result: { holdings: [], goals: null }, warnings: ["Not authenticated"] };
  const portfolio = await getPortfolio(userId).catch(() => null);
  if (!portfolio) return { name: "getPortfolio", result: { holdings: [], goals: null }, warnings: ["Portfolio unavailable"] };
  return {
    name: "getPortfolio",
    result: {
      holdings: portfolio.stockLots.map((l) => ({
        symbol: l.symbol,
        shares: l.shares,
        costBasis: l.costBasisPerShare,
        purchaseDate: l.purchaseDate,
        protectedFromCalls: l.protectedFromCalls,
      })),
      openOptions: portfolio.optionPositions.filter((o) => o.status === "OPEN").map((o) => ({
        type: o.optionType,
        symbol: o.symbol,
        strike: o.strike,
        expiration: o.expiration,
        contracts: o.contracts,
      })),
      goals: portfolio.goals[0] ?? null,
    },
    warnings: [],
  };
}

async function execAnalyzePortfolioIncome(args: Record<string, unknown>, userId?: string): Promise<ToolExecutionResult> {
  const monthlyTarget = num(args.monthlyIncomeTarget) ?? 0;
  if (!userId) return { name: "analyzePortfolioIncome", result: null, warnings: ["Not authenticated"], error: "not_authenticated" };
  const analysis = await analyzePortfolioIncome(monthlyTarget, userId);
  return {
    name: "analyzePortfolioIncome",
    result: analysis,
    warnings: analysis.feasibility === "not_supported" ? ["Income target not supported by current opportunities under constraints."] : [],
  };
}

async function execHistoricalMoveProbability(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const symbol = str(args.symbol);
  const windowDays = num(args.windowDays) ?? 45;
  const thresholdReturn = num(args.thresholdReturn) ?? 0.15;
  const hist = await getHistoricalPrices({ symbol, range: "5y" });
  const dist = rollingReturnDistribution(hist.data.points, windowDays, thresholdReturn);
  if (!dist) return { name: "calculateHistoricalMoveProbability", result: null, warnings: ["Insufficient history"] };
  return {
    name: "calculateHistoricalMoveProbability",
    result: {
      symbol,
      windowDays,
      thresholdReturn,
      sampleSize: dist.sampleSize,
      percentExceedingThreshold: dist.percentExceedingThreshold,
      percentDecliningBelowBreakEven: dist.percentDecliningBelowBreakEven,
      median: dist.median,
      p10: dist.p10,
      p90: dist.p90,
      note: "Historical description, NOT a prediction.",
    },
    warnings: ["Historical results do not predict future results."],
  };
}

async function execIVAnalytics(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const symbol = str(args.symbol);
  const { getExpirations: getExps, getOptionChain: getChain, getHistoricalPrices: getHist } = await import("@/features/market-data/service");
  const { computeIVAnalytics } = await import("@/lib/calculations/iv-analytics");
  const expirations = await getExps({ symbol });
  const exp = expirations.data[0]?.expirationDate;
  if (!exp) return { name: "getIVAnalytics", result: null, warnings: ["No expirations available"] };
  const [chain, hist] = await Promise.all([
    getChain({ symbol, expiration: exp }),
    getHist({ symbol, range: "5y" }).catch(() => ({ data: { points: [] }, fromCache: false, dataQuality: "unknown" as const, fetchedAt: "" })),
  ]);
  const a = computeIVAnalytics(chain.data, hist.data.points);
  return {
    name: "getIVAnalytics",
    result: {
      symbol,
      currentAtmIv: a.currentAtmIv,
      ivPercentile: a.ivPercentile,
      ivRank: a.ivRank,
      expectedMove: a.expectedMove,
      warnings: a.warnings,
    },
    warnings: a.warnings,
  };
}

async function execMonteCarlo(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const symbol = str(args.symbol);
  const paths = Math.min(1000, Math.max(100, num(args.paths) ?? 500));
  const horizonDays = Math.min(756, Math.max(30, num(args.horizonDays) ?? 252));
  const periodDte = Math.min(180, Math.max(7, num(args.periodDte) ?? 30));
  const strikeOtmPercent = Math.min(0.5, Math.max(0, num(args.strikeOtmPercent) ?? 0.05));
  const premiumYieldPerPeriod = Math.min(0.2, Math.max(0, num(args.premiumYieldPerPeriod) ?? 0.01));
  const { getHistoricalPrices: getHist, getQuote } = await import("@/features/market-data/service");
  const { runMonteCarlo } = await import("@/lib/calculations/monte-carlo");
  const [hist, quote] = await Promise.all([getHist({ symbol, range: "5y" }), getQuote({ symbol })]);
  const r = runMonteCarlo(hist.data.points, {
    paths, horizonDays, periodDte, strikeOtmPercent, premiumYieldPerPeriod,
    initialPrice: quote.data.price, seed: 42,
  });
  return {
    name: "runMonteCarlo",
    result: {
      symbol,
      paths: r.paths,
      horizonDays: r.horizonDays,
      buyAndHold: r.buyAndHold,
      coveredCall: r.coveredCall,
      comparison: r.comparison,
      warnings: r.warnings,
    },
    warnings: r.warnings,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function execTechnicalIndicators(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const symbol = str(args.symbol);
  const { getHistoricalPrices: getHist } = await import("@/features/market-data/service");
  const { computeAllIndicators } = await import("@/lib/calculations/indicators");
  const hist = await getHist({ symbol, range: "1y" });
  const indicators = computeAllIndicators(hist.data.points, symbol);
  return {
    name: "getTechnicalIndicators",
    result: {
      symbol,
      currentPrice: indicators.currentPrice,
      rsi: { current: indicators.rsi.current, signal: indicators.rsi.signal },
      macd: { current: indicators.macd.current, crossover: indicators.macd.crossover },
      bollinger: { current: indicators.bollinger.current, squeeze: indicators.bollinger.squeeze },
      stochastic: { current: indicators.stochastic.current, signal: indicators.stochastic.signal },
      atr: { current: indicators.atr.current, currentAsPercent: indicators.atr.currentAsPercent, volatilityRegime: indicators.atr.volatilityRegime },
      obv: { trend: indicators.obv.trend, divergence: indicators.obv.divergence },
      adx: { current: indicators.adx.current, trendStrength: indicators.adx.trendStrength, trendDirection: indicators.adx.trendDirection },
      vwap: { current: indicators.vwap.current, priceVsVwap: indicators.vwap.priceVsVwap },
      ichimoku: { signal: indicators.ichimoku.signal, cloudColor: indicators.ichimoku.cloudColor },
      parabolicSAR: { current: indicators.parabolicSAR.current, trend: indicators.parabolicSAR.trend },
      ttmSqueeze: { signal: indicators.ttmSqueeze.signal, squeezeActive: indicators.ttmSqueeze.current.squeezeActive, squeezeFired: indicators.ttmSqueeze.current.squeezeFired, histogram: indicators.ttmSqueeze.current.histogram },
      williamsR: { current: indicators.williamsR.current, signal: indicators.williamsR.signal },
      cci: { current: indicators.cci.current, signal: indicators.cci.signal },
      mfi: { current: indicators.mfi.current, signal: indicators.mfi.signal },
      keltner: indicators.keltner.current,
      donchian: indicators.donchian.current,
      signalScore: indicators.signalScore,
      tradeLevels: indicators.tradeLevels,
      movingAverages: indicators.movingAverages,
      summary: indicators.summary,
      warnings: indicators.warnings,
    },
    warnings: indicators.warnings,
  };
}

async function execPatternAnalysis(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const symbol = str(args.symbol);
  const horizon = Math.min(90, Math.max(7, num(args.horizon) ?? 30));
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/stock/${encodeURIComponent(symbol)}/pattern-analysis`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ horizon }),
    cache: "no-store",
  });
  if (!res.ok) {
    return { name: "analyzePattern", result: null, warnings: [`Pattern analysis failed: HTTP ${res.status}`] };
  }
  const body = await res.json() as { analysis: string; aiPowered: boolean; warnings: string[] };
  return {
    name: "analyzePattern",
    result: { symbol, analysis: body.analysis, aiPowered: body.aiPowered, horizon },
    warnings: body.warnings ?? [],
  };
}

async function execNews(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const symbol = str(args.symbol);
  const { fetchNews, analyzeNewsSentiment } = await import("@/features/news/sentiment-service");
  const articles = await fetchNews(symbol);
  if (articles.length === 0) {
    return {
      name: "getNews",
      result: { symbol, articles: [], message: "No news articles found. Configure NEWS_API_KEY or ALPHA_VANTAGE_API_KEY." },
      warnings: ["No news API configured — no articles available."],
    };
  }
  const report = await analyzeNewsSentiment(symbol, articles);
  return {
    name: "getNews",
    result: {
      symbol,
      totalArticles: report.aggregate.totalArticles,
      overallSentiment: report.aggregate.overallSentiment,
      averageScore: report.aggregate.averageScore,
      bullishCount: report.aggregate.bullishCount,
      bearishCount: report.aggregate.bearishCount,
      neutralCount: report.aggregate.neutralCount,
      keyTopics: report.aggregate.keyTopics,
      highImpactHeadlines: report.aggregate.highImpactArticles.map((a) => ({
        headline: a.headline,
        sentiment: a.sentiment?.label,
        impact: a.sentiment?.impact,
        optionsImplication: a.sentiment?.optionsImplication,
      })),
      aiAnalysis: report.aiAnalysis,
      aiPowered: report.aiPowered,
    },
    warnings: report.warnings,
  };
}

async function execEarnings(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const symbol = str(args.symbol);
  const { analyzeEarnings } = await import("@/features/options/earnings-analyzer");
  const analysis = await analyzeEarnings(symbol);
  return {
    name: "getEarningsAnalysis",
    result: {
      symbol,
      nextEarnings: analysis.nextEarnings,
      statistics: analysis.statistics,
      expectedMove: analysis.expectedMove,
      ivCrush: analysis.ivCrush,
      strategyImplications: analysis.strategyImplications,
      historicalReactions: analysis.historicalReactions.slice(-5),
    },
    warnings: analysis.warnings,
  };
}

async function execPeers(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const symbol = str(args.symbol);
  const { comparePeers } = await import("@/features/options/peer-comparison");
  const comparison = await comparePeers(symbol);
  return {
    name: "getPeerComparison",
    result: {
      symbol,
      sector: comparison.sector,
      industry: comparison.industry,
      targetMetrics: comparison.targetMetrics,
      peers: comparison.peers.map((p) => ({
        symbol: p.symbol,
        price: p.price,
        oneYearReturn: p.oneYearReturn,
        yearToDateReturn: p.yearToDateReturn,
        volatility: p.volatility,
      })),
      spyBenchmark: comparison.spyBenchmark ? {
        symbol: comparison.spyBenchmark.symbol,
        oneYearReturn: comparison.spyBenchmark.oneYearReturn,
        volatility: comparison.spyBenchmark.volatility,
      } : null,
      rankings: comparison.rankings,
      analysis: comparison.analysis,
    },
    warnings: comparison.warnings,
  };
}

async function getEarningsDate(symbol: string): Promise<string | null> {
  try {
    const events = await getOptionChain({ symbol, expiration: (await getExpirations({ symbol })).data[0]?.expirationDate ?? "" });
    void events;
    return null;
  } catch {
    return null;
  }
}

function pickClosestExpiration(
  expirations: { expirationDate: string; daysToExpiration: number }[],
  targetDte: number,
): { expirationDate: string; daysToExpiration: number } | null {
  if (expirations.length === 0) return null;
  let best = expirations[0];
  let bestDist = Infinity;
  for (const e of expirations) {
    const d = Math.abs(e.daysToExpiration - targetDte);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best ?? null;
}

function compactContract(c: { strike: number; bid: number | null; ask: number | null; midpoint: number | null; volume: number | null; openInterest: number | null; impliedVolatility: number | null; greeks: { delta: number | null }; daysToExpiration: number; expiration: string; inTheMoney: boolean }) {
  return {
    strike: c.strike,
    bid: c.bid,
    ask: c.ask,
    mid: c.midpoint,
    vol: c.volume,
    oi: c.openInterest,
    iv: c.impliedVolatility,
    delta: c.greeks.delta,
    dte: c.daysToExpiration,
    expiration: c.expiration,
    itm: c.inTheMoney,
  };
}

function compactCoveredCall(c: CoveredCallCandidate) {
  return {
    strike: c.contract.strike,
    expiration: c.contract.expiration,
    dte: c.contract.daysToExpiration,
    premiumPerContract: round(c.premiumPerContract),
    premiumYield: pct(c.premiumYield),
    annualizedPremiumYield: pct(c.annualizedPremiumYield),
    otmPercent: pct(c.strikeOtmPercent),
    potentialStockAppreciation: pct(c.potentialStockAppreciation),
    maxTotalReturn: pct(c.maxTotalReturn),
    annualizedMaxTotalReturn: pct(c.annualizedMaxTotalReturn),
    delta: c.delta,
    assignmentProbability: c.estimatedAssignmentProbability,
    iv: c.impliedVolatility,
    liquidityScore: c.liquidityScore,
    score: c.score.total,
    earningsBeforeExpiration: c.earningsBeforeExpiration,
    breakEven: round(c.breakEven),
  };
}

function compactCsp(c: CashSecuredPutCandidate) {
  return {
    strike: c.contract.strike,
    expiration: c.contract.expiration,
    dte: c.contract.daysToExpiration,
    premiumPerContract: round(c.premiumPerContract),
    effectivePurchasePrice: round(c.effectivePurchasePrice),
    discountToCurrentPrice: pct(c.discountToCurrentPrice),
    returnOnNetCapital: pct(c.returnOnNetCapital),
    annualizedReturnOnNet: pct(c.annualizedReturnOnNet),
    grossCollateral: round(c.grossCollateral),
    delta: c.delta,
    assignmentProbability: c.estimatedAssignmentProbability,
    iv: c.impliedVolatility,
    liquidityScore: c.liquidityScore,
    score: c.score.total,
    earningsBeforeExpiration: c.earningsBeforeExpiration,
  };
}

// ---------------------------------------------------------------------------
// Phase 13 engines
// ---------------------------------------------------------------------------

function execPriceOption(args: Record<string, unknown>): ToolExecutionResult {
  const spot = num(args.spot);
  const strike = num(args.strike);
  const dte = num(args.daysToExpiration);
  const optionType = str(args.optionType) === "PUT" ? "PUT" : "CALL";
  const model = String(args.model ?? "blackScholes").toLowerCase();
  const riskFreeRate = num(args.riskFreeRate) ?? 0.05;
  const dividendYield = num(args.dividendYield) ?? 0;
  const marketPrice = num(args.marketPrice);
  let volatility = num(args.volatility);

  if (spot == null || strike == null || dte == null) {
    return { name: "priceOption", result: null, warnings: ["spot, strike and daysToExpiration are required."], error: "bad_args" };
  }

  const warnings: string[] = [];
  const timeToExpiry = dte / 365;
  let solvedIv: number | null = null;

  // If a market price is supplied, back out IV and prefer it over any guess.
  if (marketPrice != null && marketPrice > 0) {
    solvedIv = impliedVolatility(
      marketPrice,
      spot,
      strike,
      timeToExpiry,
      riskFreeRate,
      optionType as OptionType,
      dividendYield,
    );
    if (solvedIv == null) {
      warnings.push("Implied volatility did not converge for the supplied market price.");
    } else {
      volatility = solvedIv;
    }
  }

  if (volatility == null || volatility <= 0) {
    return {
      name: "priceOption",
      result: null,
      warnings: ["Provide either volatility or a marketPrice so implied volatility can be solved."],
      error: "bad_args",
    };
  }

  const input = { spot, strike, timeToExpiry, riskFreeRate, volatility, dividendYield, optionType: optionType as OptionType };
  const priced = model === "binomial" ? binomialAmerican(input) : blackScholes(input);

  const intrinsic = optionType === "CALL" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);

  return {
    name: "priceOption",
    result: {
      model: model === "binomial" ? "binomialCRR(American)" : "blackScholes(European)",
      optionType,
      spot,
      strike,
      daysToExpiration: dte,
      volatilityUsed: volatility,
      impliedVolatilitySolved: solvedIv,
      theoreticalPrice: round(priced.price),
      marketPrice,
      edgeVsMarket: marketPrice != null ? round(priced.price - marketPrice) : null,
      verdict:
        marketPrice == null
          ? null
          : priced.price > marketPrice
            ? "market price is BELOW theoretical (option looks cheap)"
            : priced.price < marketPrice
              ? "market price is ABOVE theoretical (option looks rich)"
              : "market price matches theoretical",
      intrinsicValue: round(intrinsic),
      extrinsicValue: round(Math.max(0, priced.price - intrinsic)),
      greeks: priced.greeks,
      note: "Theoretical values assume constant volatility and no transaction costs. Compare against the live bid/ask, not the midpoint alone.",
    },
    warnings,
  };
}

async function execRunBacktest(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const symbol = str(args.symbol);
  const rawStrategy = str(args.strategy).replace(/[\s-]/g, "_");
  const allowed: BacktestStrategy[] = ["COVERED_CALL", "CASH_SECURED_PUT", "WHEEL"];
  const strategy = (allowed as string[]).includes(rawStrategy)
    ? (rawStrategy as BacktestStrategy)
    : null;

  if (!strategy) {
    return {
      name: "runBacktest",
      result: null,
      warnings: [`strategy must be one of ${allowed.join(", ")}.`],
      error: "bad_args",
    };
  }

  // getHistoricalPrices accepts a fixed set of range tokens.
  const allowedRanges = ["1m", "3m", "6m", "1y", "3y", "5y", "10y", "max"] as const;
  type HistRange = (typeof allowedRanges)[number];
  const requestedRange = String(args.range ?? "3y").toLowerCase();
  const range: HistRange = (allowedRanges as readonly string[]).includes(requestedRange)
    ? (requestedRange as HistRange)
    : "3y";
  const hist = await getHistoricalPrices({ symbol, range });
  const quote = await getQuote({ symbol });
  const spot = quote.data.price;

  const contracts = num(args.contracts) ?? 1;
  const shares = strategy === "CASH_SECURED_PUT" ? 0 : contracts * 100;
  // Fund the comparison with enough capital to actually hold the position.
  const startingCapital = Math.max(spot * Math.max(shares, contracts * 100), 1);

  const result = runBacktest(hist.data.points, {
    strategy,
    symbol,
    deltaTarget: num(args.deltaTarget) ?? 0.3,
    dteTarget: num(args.dteTarget) ?? 45,
    contracts,
    riskFreeRate: 0.05,
    startingCapital,
    shares,
    strikeInterval: spot >= 200 ? 5 : spot >= 50 ? 2.5 : 1,
    fillAssumption: "bid",
  });

  const warnings = [...result.warnings];
  warnings.push(
    "Premiums are MODELED with Black-Scholes using trailing 30-day realized volatility, not historical option quotes. Treat results as an approximation, not an achievable track record.",
  );

  return {
    name: "runBacktest",
    result: {
      symbol,
      strategy,
      period: { start: result.startDate, end: result.endDate },
      totalCycles: result.totalCycles,
      winRate: pct(result.winRate),
      totalPremiumIncome: round(result.totalPremiumIncome),
      avgPremiumPerCycle: round(result.avgPremiumPerCycle),
      expiredWorthless: result.expiredWorthlessCount,
      assigned: result.assignmentCount,
      calledAway: result.calledAwayCount,
      strategyReturn: pct(result.strategyReturn),
      strategyAnnualized: pct(result.strategyAnnualizedReturn),
      buyHoldReturn: pct(result.buyHoldReturn),
      buyHoldAnnualized: pct(result.buyHoldAnnualizedReturn),
      outperformance: pct(result.outperformance),
      maxDrawdown: pct(result.maxDrawdown),
      sharpeRatio: result.sharpeRatio != null ? round(result.sharpeRatio) : null,
      startingCapital: round(startingCapital),
      // Trim the trade log so we do not blow the context window.
      recentTrades: result.trades.slice(-8).map((t) => ({
        open: t.openDate,
        close: t.closeDate,
        type: t.optionType,
        strike: t.strike,
        premium: round(t.premiumIncome),
        outcome: t.outcome,
        cyclePnl: round(t.cyclePnl),
      })),
    },
    warnings,
  };
}

function execMultiLeg(args: Record<string, unknown>): ToolExecutionResult {
  const underlyingPrice = num(args.underlyingPrice);
  const rawLegs = Array.isArray(args.legs) ? args.legs : [];

  if (underlyingPrice == null || rawLegs.length === 0) {
    return { name: "analyzeMultiLegStrategy", result: null, warnings: ["underlyingPrice and at least one leg are required."], error: "bad_args" };
  }

  const legs: StrategyLeg[] = [];
  for (const raw of rawLegs) {
    const l = raw as Record<string, unknown>;
    const action = str(l.action) === "SELL" ? "SELL" : "BUY";
    const optionType = str(l.optionType) === "PUT" ? "PUT" : "CALL";
    const strike = num(l.strike);
    const pricePerShare = num(l.pricePerShare);
    const contracts = num(l.contracts) ?? 1;
    const daysToExpiration = num(l.daysToExpiration) ?? 30;
    if (strike == null || pricePerShare == null) continue;
    legs.push({
      action: action as LegAction,
      optionType: optionType as OptionType,
      strike,
      pricePerShare,
      contracts,
      daysToExpiration,
      expiration: String(l.expiration ?? ""),
    });
  }

  if (legs.length === 0) {
    return { name: "analyzeMultiLegStrategy", result: null, warnings: ["No valid legs: each leg needs a strike and pricePerShare."], error: "bad_args" };
  }

  const r = analyzeMultiLegStrategy(legs, underlyingPrice);

  return {
    name: "analyzeMultiLegStrategy",
    result: {
      kind: r.kind,
      underlyingPrice,
      legs: r.legs.map((l) => ({
        action: l.action,
        type: l.optionType,
        strike: l.strike,
        premium: l.pricePerShare,
        contracts: l.contracts,
        dte: l.daysToExpiration,
      })),
      netPremiumPerShare: round(r.netPremiumPerShare),
      netPremiumTotal: round(r.netPremiumTotal),
      creditOrDebit: r.netPremiumTotal >= 0 ? "CREDIT" : "DEBIT",
      maxProfit: r.maxProfit != null ? round(r.maxProfit) : null,
      maxLoss: r.maxLoss != null ? round(r.maxLoss) : null,
      breakevens: r.breakevens.map((b) => round(b)),
      riskRewardRatio: r.riskRewardRatio != null ? round(r.riskRewardRatio) : null,
      marginRequirement: r.marginRequirement != null ? round(r.marginRequirement) : null,
      combinedGreeks: r.combinedGreeks,
      notes: r.notes,
    },
    warnings: r.maxLoss == null ? ["This structure has undefined risk - max loss is theoretically unbounded."] : [],
  };
}

async function execAssignmentRisk(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const symbol = str(args.symbol);
  const optionType = str(args.optionType) === "PUT" ? "PUT" : "CALL";
  const strike = num(args.strike);
  const dte = num(args.daysToExpiration);

  if (strike == null || dte == null) {
    return { name: "assessAssignmentRisk", result: null, warnings: ["strike and daysToExpiration are required."], error: "bad_args" };
  }

  const quote = await getQuote({ symbol });
  const spot = quote.data.price;

  const warnings: string[] = [];
  let iv = num(args.impliedVolatility);
  if (iv == null || iv <= 0) {
    iv = 0.3;
    warnings.push("No implied volatility supplied; assumed 30% which changes the extrinsic-value estimate.");
  }

  let dividends: Awaited<ReturnType<typeof getCorporateEvents>>["data"]["dividends"] = [];
  try {
    const events = await getCorporateEvents({ symbol });
    dividends = events.data.dividends;
  } catch {
    warnings.push("Could not fetch dividend calendar; dividend-driven early exercise was not evaluated.");
  }

  const r = assessAssignmentRisk(optionType as OptionType, strike, spot, dte, iv, 0.05, dividends);

  return {
    name: "assessAssignmentRisk",
    result: {
      symbol,
      optionType,
      strike,
      spot,
      daysToExpiration: dte,
      inTheMoney: optionType === "CALL" ? spot > strike : spot < strike,
      riskLevel: r.riskLevel,
      riskScore: round(r.riskScore),
      earlyExerciseProbability: pct(r.earlyExerciseProbability),
      extrinsicValue: round(r.extrinsicValue),
      daysToExDividend: r.daysToExDiv,
      dividendAmount: r.dividendAmount,
      reasons: r.reasons,
      recommendation: r.recommendation,
    },
    warnings,
  };
}

async function execPortfolioRisk(userId?: string): Promise<ToolExecutionResult> {
  if (!userId) {
    return { name: "getPortfolioRisk", result: null, warnings: ["No authenticated user; cannot read the portfolio."], error: "no_user" };
  }

  const portfolio = await getPortfolio(userId);
  const warnings: string[] = [];

  // Aggregate share lots per symbol.
  const bySymbol = new Map<string, number>();
  for (const lot of portfolio.stockLots) {
    bySymbol.set(lot.symbol, (bySymbol.get(lot.symbol) ?? 0) + lot.shares);
  }

  if (bySymbol.size === 0) {
    return {
      name: "getPortfolioRisk",
      result: { note: "Portfolio has no stock holdings, so there is no directional or concentration exposure to measure." },
      warnings: [],
    };
  }

  // Beta is not available from the market-data provider, so use 1.0 and say so.
  warnings.push(
    "Beta is not supplied by the market-data provider, so every holding is beta-weighted at 1.0. Beta-weighted delta therefore equals raw delta and understates high-beta names.",
  );

  const positions: PositionDelta[] = [];
  let spyPrice = 500;
  try {
    const spy = await getQuote({ symbol: "SPY" });
    spyPrice = spy.data.price;
  } catch {
    warnings.push("Could not fetch SPY; used a $500 placeholder for SPY-equivalent dollar exposure.");
  }

  for (const [symbol, shares] of bySymbol) {
    try {
      const q = await getQuote({ symbol });
      positions.push({
        symbol,
        delta: shares, // one share = 1.0 delta
        marketValue: shares * q.data.price,
        beta: 1.0,
      });
    } catch {
      warnings.push(`Could not fetch a quote for ${symbol}; it was excluded.`);
    }
  }

  const r = computeBetaWeightedDelta(positions, spyPrice);

  return {
    name: "getPortfolioRisk",
    result: {
      totalMarketValue: round(r.totalMarketValue),
      netDelta: round(r.netDelta),
      betaWeightedDelta: round(r.totalBetaWeightedDelta),
      spyEquivalentExposure: round(r.spyEquivalentExposure),
      directionalBias: r.directionalBias,
      concentration: {
        riskLevel: r.concentrationRisk.riskLevel,
        largestPosition: pct(r.concentrationRisk.maxSinglePosition),
        top3: pct(r.concentrationRisk.top3Concentration),
        herfindahlIndex: round(r.concentrationRisk.herfindahlIndex),
        warnings: r.concentrationRisk.warnings,
      },
      positions: r.weightedDeltaBySymbol.map((w) => ({
        symbol: w.symbol,
        marketValue: round(w.marketValue),
        percentOfPortfolio: pct(w.percentOfPortfolio),
        betaWeightedDelta: round(w.betaWeightedDelta),
      })),
    },
    warnings,
  };
}

async function execMarketRegime(): Promise<ToolExecutionResult> {
  const r = await getMarketRegimeSnapshot();

  return {
    name: "getMarketRegime",
    result: {
      regime: r.regime,
      description: r.description,
      riskLevel: r.riskLevel,
      vix: round(r.vix),
      vixSource: r.vixSource,
      spyTrend: r.spyTrend,
      spyAbove200sma: r.spyAbove200sma,
      spyRealizedVol30: pct(r.realizedVol30),
      strategyImplications: r.strategyImplications,
    },
    warnings: r.warnings,
  };
}

function execEstimateExecution(args: Record<string, unknown>): ToolExecutionResult {
  const bid = num(args.bid);
  const ask = num(args.ask);
  const orderSize = num(args.orderSize) ?? 1;
  const rawType = str(args.orderType);
  const orderType = rawType === "MARKET" || rawType === "LIMIT" || rawType === "MID" ? rawType : "MID";

  if (bid == null || ask == null) {
    return { name: "estimateExecution", result: null, warnings: ["bid and ask are required."], error: "bad_args" };
  }
  if (ask < bid) {
    return { name: "estimateExecution", result: null, warnings: ["ask cannot be lower than bid."], error: "bad_args" };
  }

  const r = estimateExecution({
    bid,
    ask,
    volume: num(args.volume),
    openInterest: num(args.openInterest),
    orderSize,
    orderType,
    limitPrice: num(args.limitPrice) ?? undefined,
  });

  const mid = (bid + ask) / 2;

  return {
    name: "estimateExecution",
    result: {
      bid,
      ask,
      midpoint: round(mid),
      spread: round(r.effectiveSpread),
      spreadPercentOfMid: mid > 0 ? pct(r.effectiveSpread / mid) : null,
      orderType,
      orderSize,
      estimatedFillPrice: round(r.estimatedFillPrice),
      slippageVsMid: round(r.slippage),
      slippageCostTotal: round(r.slippage * 100 * orderSize),
      fillProbability: pct(r.fillProbability),
      marketImpact: round(r.marketImpact),
      liquidityWarning: r.warning,
      note: "MARKET-order pricing assumes you are BUYING (paying the ask). For a sell order the slippage works against you symmetrically from the bid.",
    },
    warnings: r.warning ? [r.warning] : [],
  };
}

function str(x: unknown): string {
  return String(x ?? "").toUpperCase().trim();
}
function num(x: unknown): number | null {
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function pct(x: number | null): number | null {
  return x == null ? null : Math.round(x * 10000) / 100; // 12.34 (%) form
}
function round(x: number): number {
  return Math.round(x * 100) / 100;
}

async function execWalkForward(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const symbol = str(args.symbol);
  if (!symbol) {
    return { name: "runWalkForward", result: null, warnings: ["symbol is required"], error: "missing_symbol" };
  }

  const range = String(args.range ?? "10y").toLowerCase();
  const validRanges = ["3y", "5y", "10y", "max"];
  const histRange = validRanges.includes(range) ? range : "10y";

  const hist = await getHistoricalPrices({ symbol, range: histRange as any });

  if (hist.data.points.length < 300) {
    return {
      name: "runWalkForward",
      result: { error: `Only ${hist.data.points.length} bars available — need 300+ for walk-forward validation.` },
      warnings: [`Insufficient history for ${symbol}: ${hist.data.points.length} bars.`],
    };
  }

  const config = {
    ...DEFAULT_WALK_FORWARD_CONFIG,
    folds: Math.min(Math.max(Number(args.folds) || 4, 2), 8),
    costBps: Number(args.costBps) >= 0 ? Number(args.costBps) : DEFAULT_WALK_FORWARD_CONFIG.costBps,
    signalThreshold: Number(args.signalThreshold) > 0 ? Number(args.signalThreshold) : DEFAULT_WALK_FORWARD_CONFIG.signalThreshold,
  };

  const r = runWalkForward(hist.data.points, symbol, config);

  return {
    name: "runWalkForward",
    result: {
      symbol: r.symbol,
      folds: r.folds.length,
      candidatesPerFold: r.candidatesPerFold,
      totalTrials: r.totalTrials,
      oosSharpe: r.oosSharpe != null ? round(r.oosSharpe) : null,
      oosSortino: r.oosSortino != null ? round(r.oosSortino) : null,
      oosTotalReturn: pct(r.oosTotalReturn),
      oosMaxDrawdown: pct(r.oosMaxDrawdown),
      oosHitRate: pct(r.oosHitRate),
      oosTimeInMarket: pct(r.oosTimeInMarket),
      totalTrades: r.totalTrades,
      meanTrainSharpe: r.meanTrainSharpe != null ? round(r.meanTrainSharpe) : null,
      sharpeDegradation: r.sharpeDegradation != null ? round(r.sharpeDegradation) : null,
      deflatedSharpe: r.deflated.deflatedSharpe != null ? round(r.deflated.deflatedSharpe) : null,
      deflatedVerdict: r.deflated.verdict,
      deflatedTrials: r.deflated.trials,
      buyHoldReturn: pct(r.buyHoldReturn),
      buyHoldSharpe: r.buyHoldSharpe != null ? round(r.buyHoldSharpe) : null,
      excessReturn: pct(r.excessReturn),
      warnings: r.warnings,
    },
    warnings: [
      "Signal weights are selected on training folds and frozen for OOS testing. The Deflated Sharpe Ratio corrects for multiple testing.",
      "Past performance does not predict future results — these factors are well-known and heavily arbitraged.",
    ],
  };
}

function execPositionSizing(args: Record<string, unknown>): ToolExecutionResult {
  const spot = num(args.spot);
  const volatility = num(args.volatility);
  const holdingDays = num(args.holdingDays);
  const signalScore = num(args.signalScore);
  const costBps = num(args.costBps);
  const capital = num(args.capital);
  const targetVol = num(args.targetVol);

  if (spot == null || volatility == null || holdingDays == null || signalScore == null || costBps == null) {
    return { name: "getPositionSizing", result: null, warnings: ["Missing required parameters for entry/exit levels"], error: "missing_params" };
  }

  const levels = computeCostAwareLevels({
    spot,
    volatility,
    holdingDays,
    signalScore,
    costBps,
    stopMultiplier: num(args.stopMultiplier) ?? undefined,
    targetMultiplier: num(args.targetMultiplier) ?? undefined,
  });

  let sizing = null;
  if (capital != null && targetVol != null) {
    sizing = computeVolTargetSizing({
      capital,
      assetVol: volatility,
      targetVol,
      price: spot,
      maxLeverage: num(args.maxLeverage) ?? undefined,
      kellyFraction: num(args.kellyFraction) ?? undefined,
      expectedReturn: num(args.expectedReturn) ?? undefined,
    });
  }

  return {
    name: "getPositionSizing",
    result: {
      levels: {
        direction: levels.direction,
        entryPrice: levels.entryPrice,
        stopLoss: levels.stopLoss,
        takeProfit: levels.takeProfit,
        expectedMove: levels.expectedMove,
        expectedMovePct: pct(levels.expectedMovePct),
        riskPerShare: levels.riskPerShare,
        rewardPerShare: levels.rewardPerShare,
        riskRewardRatio: levels.riskRewardRatio,
        breakevenMove: levels.breakevenMove,
        costDragPct: pct(levels.costDragPct),
      },
      sizing: sizing ? {
        weight: sizing.weight,
        units: sizing.units,
        positionValue: sizing.positionValue,
        leverage: sizing.leverage,
        actualVolContribution: pct(sizing.actualVolContribution),
        kellyWeight: Number.isFinite(sizing.kellyWeight) ? sizing.kellyWeight : null,
        kellyCapped: sizing.kellyCapped,
        leverageCapped: sizing.leverageCapped,
        warnings: sizing.warnings,
      } : null,
    },
    warnings: [
      "Entry/exit levels are derived from expected move bands and transaction costs, not AI-generated price targets.",
      "Volatility-targeted sizing assumes the input volatility is representative — regime shifts will change the optimal size.",
    ],
  };
}

async function execStrategyAdvisor(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const symbol = str(args.symbol);
  if (!symbol) {
    return { name: "getStrategyAdvisor", result: null, warnings: ["symbol is required"], error: "missing_symbol" };
  }

  const contracts = num(args.contracts) ?? 1;

  const [hist, quoteRes, expRes] = await Promise.all([
    getHistoricalPrices({ symbol, range: "5y" as any }),
    getQuote({ symbol }),
    getExpirations({ symbol }),
  ]);

  const currentPrice = quoteRes.data.price;
  const points = hist.data.points;

  if (points.length < 60) {
    return {
      name: "getStrategyAdvisor",
      result: { error: `Only ${points.length} bars available — need 60+ for strategy advisor.` },
      warnings: [`Insufficient history for ${symbol}: ${points.length} bars.`],
    };
  }

  const indicators = computeAllIndicators(points, symbol);
  const technicalBias = indicators.summary.overallBias;
  const technicalScore = indicators.signalScore.score;

  const expirations = expRes.data ?? [];
  const targetDTEs = [30, 45, 60, 90, 180];
  const selectedExpirations: string[] = [];

  for (const targetDTE of targetDTEs) {
    let closest: typeof expirations[number] | null = null;
    for (const exp of expirations) {
      if (selectedExpirations.includes(exp.expirationDate)) continue;
      if (closest == null || Math.abs(exp.daysToExpiration - targetDTE) < Math.abs(closest.daysToExpiration - targetDTE)) {
        closest = exp;
      }
    }
    if (closest) selectedExpirations.push(closest.expirationDate);
  }

  const chainResults = await Promise.all(
    selectedExpirations.map(exp => getOptionChain({ symbol, expiration: exp }).catch(() => null)),
  );

  const chains = chainResults
    .filter((c): c is NonNullable<typeof c> => c != null)
    .map(c => c.data);

  const r = runStrategyAdvisor(symbol, currentPrice, points, chains, technicalBias, technicalScore, contracts);

  return {
    name: "getStrategyAdvisor",
    result: {
      symbol: r.symbol,
      currentPrice: r.currentPrice,
      verdict: r.verdict,
      verdictExplanation: r.verdictExplanation,
      quality: {
        grade: r.quality.grade,
        total: r.quality.total,
        components: r.quality.components,
        strengths: r.quality.strengths,
        concerns: r.quality.concerns,
      },
      bestPick: r.bestPick ? {
        strike: r.bestPick.strike,
        dte: r.bestPick.dte,
        premiumPerShare: r.bestPick.premiumPerShare,
        premiumYield: r.bestPick.premiumYield,
        annualizedYield: r.bestPick.annualizedYield,
        assignmentProbability: r.bestPick.assignmentProbability,
        expireWorthlessProbability: r.bestPick.expireWorthlessProbability,
        totalReturnIfAssigned: r.bestPick.totalReturnIfAssigned,
        strategy: r.bestPick.strategy,
        explanation: r.bestPick.explanation,
      } : null,
      recommendedDTE: r.recommendedDTE,
      dteComparisons: r.dteComparisons.map(d => ({
        dte: d.dte,
        callsAnalyzed: d.callsAnalyzed,
        avgPremiumYield: d.avgPremiumYield,
        avgAssignmentProb: d.avgAssignmentProb,
        bestStrike: d.bestCall?.strike ?? null,
        bestYield: d.bestCall?.premiumYield ?? null,
      })),
      summary: r.summary,
      warnings: r.warnings,
    },
    warnings: [
      "Stock quality is based on historical data — past performance does not guarantee future results.",
      "Assignment probability is estimated from delta — actual assignment depends on market conditions and holder behavior.",
    ],
  };
}
