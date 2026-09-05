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
import type { CashSecuredPutCandidate, CoveredCallCandidate, ScannerObjective } from "@/lib/types";

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
