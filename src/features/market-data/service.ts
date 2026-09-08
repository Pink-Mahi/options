/**
 * Market-data service: provider selection + caching layer.
 *
 * Server-side only. Reads env vars and constructs the appropriate provider.
 * Wraps every call with the TTL cache and preserves the original fetchedAt
 * timestamp so the UI can always show data freshness.
 */

import "server-only";
import type {
  CorporateEvents,
  HistoricalPriceSeries,
  OptionChain,
  OptionExpiration,
  Quote,
} from "@/lib/types";
import { getCache } from "./cache";
import {
  MarketDataError,
  type MarketDataProvider,
  type MarketDataResult,
  type QuoteParams,
  type HistoricalPricesParams,
  type ExpirationsParams,
  type OptionChainParams,
  type CorporateEventsParams,
} from "./provider";
import { TradierProvider } from "./tradier";
import { MockProvider } from "./mock";
import { YahooFinanceProvider } from "./yahoo";
import {
  getStoredPrices,
  savePrices,
} from "@/lib/database/historical-price-repo";

let _provider: MarketDataProvider | null = null;
let _yahooProvider: YahooFinanceProvider | null = null;

export function getProvider(): MarketDataProvider {
  if (_provider) return _provider;
  const name = (process.env.MARKET_DATA_PROVIDER ?? "tradier").toLowerCase();
  const key = process.env.MARKET_DATA_API_KEY ?? "";
  if (name === "tradier" && key) {
    const entitlementEnv = process.env.TRADIER_ENTITLEMENT;
    const entitlement: "realtime" | "delayed" =
      entitlementEnv === "realtime" || entitlementEnv === "delayed" ? entitlementEnv : "delayed";
    _provider = new TradierProvider({
      apiKey: key,
      baseUrl: process.env.TRADIER_BASE_URL ?? "https://sandbox.tradier.com/v1",
      entitlement,
    });
  } else if (name === "mock") {
    _provider = new MockProvider();
  } else if (name === "tradier" && !key) {
    // No key configured — fall back to mock so the app runs in demo mode.
    // The UI surfaces a banner explaining this is demo data.
    _provider = new MockProvider();
  } else {
    _provider = new MockProvider();
  }
  return _provider;
}

/** Yahoo Finance provider (lazy singleton) — used as fallback for historical prices. */
function getYahooProvider(): YahooFinanceProvider {
  if (!_yahooProvider) _yahooProvider = new YahooFinanceProvider();
  return _yahooProvider;
}

/** True when the active provider is the mock/demo fallback. */
export function isDemoMode(): boolean {
  return getProvider().name === "mock";
}

async function cached<T>(
  key: string,
  kind: "quote" | "expirations" | "option_chain" | "historical" | "events",
  fn: () => Promise<MarketDataResult<T>>,
): Promise<MarketDataResult<T>> {
  const cache = getCache();
  return cache.getOrSet(key, kind, fn);
}

export async function getQuote(
  params: QuoteParams,
): Promise<MarketDataResult<Quote>> {
  const key = `quote:${params.symbol.toUpperCase()}`;
  return cached(key, "quote", async () => {
    const provider = getProvider();
    try {
      return await provider.getQuote(params);
    } catch (primaryError) {
      if (provider.name === "mock") throw primaryError;
      try {
        console.warn(`[market-data] Primary provider (${provider.name}) failed for quote: ${(primaryError as Error).message}. Falling back to Yahoo Finance.`);
        return await getYahooProvider().getQuote(params);
      } catch {
        throw primaryError;
      }
    }
  });
}

export async function getHistoricalPrices(
  params: HistoricalPricesParams,
): Promise<MarketDataResult<HistoricalPriceSeries>> {
  const key = `historical:${params.symbol.toUpperCase()}:${params.range}`;
  return cached(key, "historical", async () => {
    const symbol = params.symbol.toUpperCase();
    const provider = getProvider();

    // Skip DB cache in demo mode — mock data is deterministic and shouldn't persist.
    if (provider.name !== "mock") {
      try {
        // 1. Check if we have sufficient data in the DB already
        const rangeStart = rangeToStartDate(params.range);
        const stored = await getStoredPrices(symbol, rangeStart);

        if (stored.length > 0) {
          // Check freshness: is the last stored point recent enough?
          const lastDate = stored[stored.length - 1]?.date;
          if (lastDate) {
            const daysSinceLast = (Date.now() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24);

            if (daysSinceLast <= 4) {
              // DB data is fresh — return it without hitting the API
              const fetchedAt = new Date().toISOString();
              return {
                data: {
                  symbol,
                  points: stored,
                  fetchedAt,
                  range: params.range,
                },
                fetchedAt,
                fromCache: false,
                provider: "db-cache",
                dataQuality: provider.name === "tradier" ? "delayed" : "unknown",
              };
            }

            // DB data is stale — fetch only recent data from the API, merge & persist
            try {
              const freshResult = await fetchHistoricalFromApi(params, provider);
              // Merge: replace/append new points from the API onto stored data
              const freshPoints = freshResult.data.points;
              const storedMap = new Map(stored.map((p) => [p.date, p]));
              for (const p of freshPoints) storedMap.set(p.date, p);
              const merged = [...storedMap.values()].sort(
                (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
              );
              // Persist the fresh points to DB (non-blocking)
              savePrices(symbol, freshPoints, freshResult.provider).catch(() => {});

              return {
                data: {
                  symbol,
                  points: merged,
                  fetchedAt: freshResult.fetchedAt,
                  range: params.range,
                },
                fetchedAt: freshResult.fetchedAt,
                fromCache: false,
                provider: freshResult.provider,
                dataQuality: freshResult.dataQuality,
              };
            } catch {
              // API fetch failed — return stale DB data rather than failing
              const fetchedAt = new Date().toISOString();
              return {
                data: {
                  symbol,
                  points: stored,
                  fetchedAt,
                  range: params.range,
                },
                fetchedAt,
                fromCache: false,
                provider: "db-cache",
                dataQuality: "delayed",
              };
            }
          }
        }
      } catch (dbError) {
        // DB error — continue to API fetch (don't let DB issues break the app)
        console.warn(`[market-data] DB cache read failed for ${symbol}: ${(dbError as Error).message}`);
      }
    }

    // 2. Fetch from API (with Yahoo fallback)
    const apiResult = await fetchHistoricalFromApi(params, provider);

    // 3. Persist to DB (non-blocking, don't let DB issues break the response)
    if (provider.name !== "mock" && apiResult.data.points.length > 0) {
      savePrices(symbol, apiResult.data.points, apiResult.provider).catch((e) => {
        console.warn(`[market-data] DB cache write failed for ${symbol}: ${(e as Error).message}`);
      });
    }

    return apiResult;
  });
}

/** Fetch historical prices from the primary provider, falling back to Yahoo Finance. */
async function fetchHistoricalFromApi(
  params: HistoricalPricesParams,
  provider: MarketDataProvider,
): Promise<MarketDataResult<HistoricalPriceSeries>> {
  try {
    return await provider.getHistoricalPrices(params);
  } catch (primaryError) {
    if (provider.name === "mock") throw primaryError;
    try {
      console.warn(`[market-data] Primary provider (${provider.name}) failed for historical prices: ${(primaryError as Error).message}. Falling back to Yahoo Finance.`);
      return await getYahooProvider().getHistoricalPrices(params);
    } catch {
      throw primaryError;
    }
  }
}

/** Convert a range string to a start date string (YYYY-MM-DD). */
function rangeToStartDate(range: HistoricalPricesParams["range"]): string {
  const now = new Date();
  const dayMs = 86400000;
  switch (range) {
    case "1m": return new Date(now.getTime() - 31 * dayMs).toISOString().slice(0, 10);
    case "3m": return new Date(now.getTime() - 91 * dayMs).toISOString().slice(0, 10);
    case "6m": return new Date(now.getTime() - 182 * dayMs).toISOString().slice(0, 10);
    case "1y": return new Date(now.getTime() - 365 * dayMs).toISOString().slice(0, 10);
    case "3y": return new Date(now.getTime() - 365 * 3 * dayMs).toISOString().slice(0, 10);
    case "5y": return new Date(now.getTime() - 365 * 5 * dayMs).toISOString().slice(0, 10);
    case "10y": return new Date(now.getTime() - 365 * 10 * dayMs).toISOString().slice(0, 10);
    case "max": return new Date(now.getTime() - 365 * 20 * dayMs).toISOString().slice(0, 10);
    default: return new Date(now.getTime() - 365 * 3 * dayMs).toISOString().slice(0, 10);
  }
}

export async function getExpirations(
  params: ExpirationsParams,
): Promise<MarketDataResult<OptionExpiration[]>> {
  const key = `expirations:${params.symbol.toUpperCase()}`;
  return cached(key, "expirations", () => getProvider().getExpirations(params));
}

export async function getOptionChain(
  params: OptionChainParams,
): Promise<MarketDataResult<OptionChain>> {
  const key = `option_chain:${params.symbol.toUpperCase()}:${params.expiration}`;
  return cached(key, "option_chain", () => getProvider().getOptionChain(params));
}

export async function getCorporateEvents(
  params: CorporateEventsParams,
): Promise<MarketDataResult<CorporateEvents>> {
  const key = `events:${params.symbol.toUpperCase()}`;
  return cached(key, "events", () => getProvider().getCorporateEvents(params));
}

export { MarketDataError };
