/**
 * Server-side data assembly for stock pages.
 * Combines market data + calculations into a single payload for the UI.
 */

import "server-only";
import {
  getCorporateEvents,
  getExpirations,
  getHistoricalPrices,
  getOptionChain,
  getQuote,
  MarketDataError,
} from "@/features/market-data/service";
import {
  calculateHistoricalReturns,
  historicalVolatility,
  movingAverage,
  rollingReturnDistribution,
} from "@/lib/calculations/historical";
import type {
  CorporateEvents,
  HistoricalReturns,
  HistoricalPriceSeries,
  MovingAverage,
  OptionChain,
  OptionExpiration,
  Quote,
  RollingReturnDistribution,
} from "@/lib/types";

export interface StockData {
  symbol: string;
  quote: Quote;
  expirations: OptionExpiration[];
  historical: HistoricalPriceSeries;
  historicalReturns: HistoricalReturns;
  movingAverages: MovingAverage[];
  events: CorporateEvents;
  fetchedAt: string;
  errors: string[];
}

export async function loadStockData(symbol: string): Promise<StockData> {
  const errors: string[] = [];
  const sym = symbol.toUpperCase().trim();

  const [quoteRes, expRes, histRes, eventsRes] = await Promise.all([
    getQuote({ symbol: sym }).catch((e) => {
      errors.push(formatError(e));
      return null;
    }),
    getExpirations({ symbol: sym }).catch((e) => {
      errors.push(formatError(e));
      return null;
    }),
    getHistoricalPrices({ symbol: sym, range: "5y" }).catch((e) => {
      errors.push(formatError(e));
      return null;
    }),
    getCorporateEvents({ symbol: sym }).catch((e) => {
      errors.push(formatError(e));
      return null;
    }),
  ]);

  if (!quoteRes) {
    throw new MarketDataError("NOT_FOUND", "service", `No data for ${sym}. ${errors.join("; ")}`);
  }

  const points = histRes?.data.points ?? [];
  const historicalReturns = calculateHistoricalReturns(points);
  const movingAverages: MovingAverage[] = [20, 50, 100, 200]
    .map((p) => movingAverage(points, p))
    .filter((m): m is MovingAverage => m != null);

  return {
    symbol: sym,
    quote: quoteRes.data,
    expirations: expRes?.data ?? [],
    historical: histRes?.data ?? { symbol: sym, points: [], fetchedAt: new Date().toISOString(), range: "5y" },
    historicalReturns,
    movingAverages,
    events: eventsRes?.data ?? { symbol: sym, dividends: [], earnings: [], fetchedAt: new Date().toISOString() },
    fetchedAt: quoteRes.fetchedAt,
    errors,
  };
}

export async function loadOptionChain(symbol: string, expiration: string) {
  return getOptionChain({ symbol: symbol.toUpperCase().trim(), expiration });
}

export async function loadRollingDistribution(
  symbol: string,
  windowDays: number,
  thresholdReturn: number,
): Promise<RollingReturnDistribution | null> {
  const hist = await getHistoricalPrices({ symbol: symbol.toUpperCase().trim(), range: "5y" });
  return rollingReturnDistribution(hist.data.points, windowDays, thresholdReturn);
}

export async function loadVolatilityContext(symbol: string) {
  const hist = await getHistoricalPrices({ symbol: symbol.toUpperCase().trim(), range: "1y" });
  return {
    hv30: historicalVolatility(hist.data.points, 30),
    hv90: historicalVolatility(hist.data.points, 90),
    hv1Year: historicalVolatility(hist.data.points, 252),
  };
}

function formatError(e: unknown): string {
  if (e instanceof MarketDataError) return `${e.code}: ${e.message}`;
  return (e as Error).message;
}
