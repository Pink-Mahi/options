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
    const provider = getProvider();
    try {
      return await provider.getHistoricalPrices(params);
    } catch (primaryError) {
      // If the primary provider fails, try Yahoo Finance as a fallback.
      // This improves reliability for backtesting and historical analysis.
      // Skip fallback if the primary is mock (demo mode) — mock always succeeds.
      if (provider.name === "mock") throw primaryError;
      try {
        console.warn(`[market-data] Primary provider (${provider.name}) failed for historical prices: ${(primaryError as Error).message}. Falling back to Yahoo Finance.`);
        return await getYahooProvider().getHistoricalPrices(params);
      } catch (yahooError) {
        // Both providers failed — throw the original error.
        throw primaryError;
      }
    }
  });
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
