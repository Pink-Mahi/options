/**
 * Sector & peer comparison.
 *
 * Compares a stock's key metrics against sector peers and the SPY benchmark.
 * Uses the market data provider for quotes and historical returns.
 *
 * Peer lists are hardcoded by sector for now. A production version would
 * use a sector classification API.
 */

import "server-only";
import { getQuote, getHistoricalPrices } from "@/features/market-data/service";
import { calculateHistoricalReturns } from "@/lib/calculations/historical";
import type { PeerComparison, PeerMetrics } from "@/lib/types";

// Common sector peer groups. In production, this would come from a
// sector classification API (GICS, ICB).
const SECTOR_PEERS: Record<string, string[]> = {
  AAPL: ["MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA", "Samsung"],
  MSFT: ["AAPL", "GOOGL", "AMZN", "META", "NVDA", "ORCL", "CRM"],
  GOOGL: ["MSFT", "META", "AMZN", "AAPL", "BIDU", "SNAP", "PINS"],
  AMZN: ["MSFT", "GOOGL", "META", "AAPL", "BABA", "EBAY", "SHOP"],
  META: ["GOOGL", "SNAP", "PINS", "AAPL", "AMZN", "MSFT", "TWTR"],
  NVDA: ["AMD", "INTC", "TSM", "QCOM", "AVGO", "TXN", "MU"],
  TSLA: ["F", "GM", "RIVN", "LCID", "NIO", "XPEV", "TM"],
  JPM: ["BAC", "WFC", "C", "GS", "MS", "USB", "PNC"],
  BAC: ["JPM", "WFC", "C", "GS", "MS", "USB", "PNC"],
  WMT: ["COST", "TGT", "HD", "LOW", "AMZN", "BJ", "DG"],
  XOM: ["CVX", "COP", "SHEL", "BP", "TOT", "MPC", "PSX"],
  JNJ: ["PFE", "MRK", "ABT", "LLY", "BMY", "AMGN", "GILD"],
  SPY: ["QQQ", "IWM", "DIA", "VTI", "VOO", "IVV", "SPLG"],
};

const SECTOR_MAP: Record<string, { sector: string; industry: string }> = {
  AAPL: { sector: "Technology", industry: "Consumer Electronics" },
  MSFT: { sector: "Technology", industry: "Software" },
  GOOGL: { sector: "Communication Services", industry: "Internet Content" },
  AMZN: { sector: "Consumer Discretionary", industry: "Internet Retail" },
  META: { sector: "Communication Services", industry: "Internet Content" },
  NVDA: { sector: "Technology", industry: "Semiconductors" },
  TSLA: { sector: "Consumer Discretionary", industry: "Auto Manufacturers" },
  JPM: { sector: "Financials", industry: "Banks - Diversified" },
  BAC: { sector: "Financials", industry: "Banks - Diversified" },
  WMT: { sector: "Consumer Staples", industry: "Discount Stores" },
  XOM: { sector: "Energy", industry: "Oil & Gas Integrated" },
  JNJ: { sector: "Healthcare", industry: "Drug Manufacturers" },
};

export async function comparePeers(symbol: string): Promise<PeerComparison> {
  const warnings: string[] = [];
  const peerSymbols = SECTOR_PEERS[symbol.toUpperCase()] ?? [];
  const sectorInfo = SECTOR_MAP[symbol.toUpperCase()] ?? { sector: null, industry: null };

  if (peerSymbols.length === 0) {
    warnings.push(`No peer group defined for ${symbol}. Add peers manually or use a sector classification API.`);
  }

  // Fetch metrics for target + peers + SPY.
  const allSymbols = [symbol, ...peerSymbols.filter((s) => s !== symbol), "SPY"];
  const metricsPromises = allSymbols.map((s) => fetchPeerMetrics(s).catch(() => null));
  const metricsResults = await Promise.all(metricsPromises);

  const targetMetrics = metricsResults[0];
  if (!targetMetrics) {
    warnings.push(`Could not fetch metrics for ${symbol}.`);
  }

  const peers = metricsResults.slice(1, 1 + peerSymbols.length).filter((m): m is PeerMetrics => m != null);
  const spyBenchmark = metricsResults[metricsResults.length - 1] ?? null;

  if (peers.length === 0 && !targetMetrics) {
    warnings.push("Could not fetch any peer metrics — market data may be unavailable.");
  }

  // Rankings: where does the target rank vs peers for each metric?
  const rankings: PeerComparison["rankings"] = [];
  if (targetMetrics && peers.length > 0) {
    const all = [targetMetrics, ...peers];

    const rankBy = (metric: keyof PeerMetrics, label: string, formatFn: (v: number | null) => string, higherIsBetter = true) => {
      const sorted = [...all].sort((a, b) => {
        const av = a[metric] as number | null;
        const bv = b[metric] as number | null;
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return higherIsBetter ? bv - av : av - bv;
      });
      const targetRank = sorted.findIndex((m) => m.symbol === targetMetrics.symbol) + 1;
      if (targetRank > 0) {
        rankings.push({
          metric: label,
          targetRank,
          totalPeers: all.length,
          targetValue: formatFn(targetMetrics[metric] as number | null),
        });
      }
    };

    rankBy("oneYearReturn", "1-Year Return", (v) => v != null ? `${(v * 100).toFixed(1)}%` : "—");
    rankBy("yearToDateReturn", "YTD Return", (v) => v != null ? `${(v * 100).toFixed(1)}%` : "—");
    rankBy("dividendYield", "Dividend Yield", (v) => v != null ? `${(v * 100).toFixed(2)}%` : "—");
    rankBy("volatility", "Volatility (lower = better)", (v) => v != null ? `${(v * 100).toFixed(1)}%` : "—", false);
    rankBy("peRatio", "P/E Ratio (lower = better)", (v) => v != null ? v.toFixed(1) : "—", false);
    rankBy("impliedVolatility", "Implied Volatility (lower = better)", (v) => v != null ? `${(v * 100).toFixed(1)}%` : "—", false);
  }

  // Analysis text.
  const analysis = generateAnalysis(symbol, targetMetrics ?? null, peers, spyBenchmark ?? null, rankings, warnings);

  return {
    symbol,
    sector: sectorInfo.sector,
    industry: sectorInfo.industry,
    targetMetrics: targetMetrics ?? { symbol, name: symbol, price: 0, marketCap: null, peRatio: null, dividendYield: null, beta: null, yearToDateReturn: null, oneYearReturn: null, volatility: null, impliedVolatility: null },
    peers,
    spyBenchmark,
    rankings,
    analysis,
    warnings,
  };
}

async function fetchPeerMetrics(symbol: string): Promise<PeerMetrics | null> {
  try {
    const [quoteRes, histRes] = await Promise.all([
      getQuote({ symbol }),
      getHistoricalPrices({ symbol, range: "1y" }).catch(() => null),
    ]);

    const price = quoteRes.data.price;
    const returns = histRes ? calculateHistoricalReturns(histRes.data.points) : null;

    // YTD return: from Jan 1 to now.
    let ytdReturn: number | null = null;
    if (histRes && histRes.data.points.length > 0) {
      const yearStart = new Date(new Date().getFullYear(), 0, 1);
      const startPoint = histRes.data.points.find((p) => new Date(p.date) >= yearStart) ?? histRes.data.points[0];
      const lastPoint = histRes.data.points[histRes.data.points.length - 1];
      if (startPoint && lastPoint) {
        // Use adjustedClose to account for splits and dividends.
        const startPx = startPoint.adjustedClose ?? startPoint.close;
        const lastPx = lastPoint.adjustedClose ?? lastPoint.close;
        ytdReturn = (lastPx - startPx) / startPx;
      }
    }

    return {
      symbol,
      name: quoteRes.data.companyName ?? symbol,
      price,
      marketCap: null, // Not available from quote
      peRatio: null, // Not available from quote
      dividendYield: null, // Not available from quote
      beta: null, // Not available from quote
      yearToDateReturn: ytdReturn,
      oneYearReturn: returns?.oneYearReturn ?? null,
      volatility: returns?.annualizedVolatility ?? null,
      impliedVolatility: null, // Would need to fetch option chain
    };
  } catch {
    return null;
  }
}

function generateAnalysis(
  symbol: string,
  target: PeerMetrics | null,
  peers: PeerMetrics[],
  spy: PeerMetrics | null,
  rankings: PeerComparison["rankings"],
  warnings: string[],
): string {
  const lines: string[] = [];
  if (!target) {
    lines.push(`Unable to fetch metrics for ${symbol}. Market data may be unavailable.`);
    return lines.join("\n");
  }

  lines.push(`## Peer Comparison — ${symbol}`);
  lines.push("");
  lines.push(`Comparing ${symbol} against ${peers.length} sector peers${spy ? " and SPY benchmark" : ""}.`);
  lines.push("");

  if (rankings.length > 0) {
    lines.push(`**Rankings:**`);
    for (const r of rankings) {
      const percentile = ((r.totalPeers - r.targetRank + 1) / r.totalPeers) * 100;
      lines.push(`- ${r.metric}: rank ${r.targetRank}/${r.totalPeers} (${percentile.toFixed(0)}th percentile) — ${r.targetValue}`);
    }
    lines.push("");
  }

  // Compare to SPY.
  if (spy && target.oneYearReturn != null && spy.oneYearReturn != null) {
    const excess = target.oneYearReturn - spy.oneYearReturn;
    lines.push(`**vs SPY (1-year):** ${symbol} ${excess >= 0 ? "outperformed" : "underperformed"} by ${Math.abs(excess * 100).toFixed(1)}%`);
  }
  if (spy && target.volatility != null && spy.volatility != null) {
    const volRatio = target.volatility / spy.volatility;
    lines.push(`**Volatility vs SPY:** ${(volRatio * 100).toFixed(0)}% of SPY volatility (beta-like measure)`);
  }

  lines.push("");
  lines.push(`**Options income implications:**`);
  if (target.volatility != null && spy?.volatility != null) {
    if (target.volatility > spy.volatility * 1.3) {
      lines.push(`- ${symbol} is significantly more volatile than the market — premium opportunities are richer but assignment risk is higher.`);
    } else if (target.volatility < spy.volatility * 0.8) {
      lines.push(`- ${symbol} is less volatile than the market — lower premium but more stable income stream.`);
    } else {
      lines.push(`- ${symbol} has market-like volatility — standard covered call / CSP strategy applies.`);
    }
  }

  return lines.join("\n");
}
