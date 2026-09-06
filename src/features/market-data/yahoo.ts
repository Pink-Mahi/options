/**
 * Yahoo Finance market-data provider.
 *
 * Provides historical prices and quotes from Yahoo Finance's unofficial API.
 * No API key required. Used as a fallback when the primary provider (Tradier)
 * fails or is not configured, and for cross-validation of price data.
 *
 * Yahoo Finance API endpoints:
 *   History: https://query1.finance.yahoo.com/v8/finance/chart/{symbol}
 *   Quote:   https://query1.finance.yahoo.com/v7/finance/quote?symbols={symbols}
 *
 * Note: This is an unofficial API and may change or rate-limit without notice.
 * We handle failures gracefully and fall back to other providers.
 */

import type {
  CorporateEvents,
  DateString,
  HistoricalPricePoint,
  HistoricalPriceSeries,
  OptionChain,
  OptionExpiration,
  Quote,
  TimestampString,
} from "@/lib/types";
import {
  MarketDataError,
  type MarketDataResult,
  type MarketDataProvider,
  type QuoteParams,
  type HistoricalPricesParams,
  type ExpirationsParams,
  type OptionChainParams,
  type CorporateEventsParams,
} from "./provider";

const YF_BASE = "https://query1.finance.yahoo.com";

export class YahooFinanceProvider implements MarketDataProvider {
  readonly name = "yahoo";

  // -------------------------------------------------------------------------
  // Historical prices
  // -------------------------------------------------------------------------

  async getHistoricalPrices(
    params: HistoricalPricesParams,
  ): Promise<MarketDataResult<HistoricalPriceSeries>> {
    const symbol = toYahooSymbol(params.symbol);
    const { period1, period2 } = rangeToPeriods(params.range);

    const url = `${YF_BASE}/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=div,split`;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; OptionProfitCalculator/1.0)",
        },
        cache: "no-store",
      });
    } catch (e) {
      throw new MarketDataError(
        "PROVIDER_UNAVAILABLE",
        this.name,
        `Network error contacting Yahoo Finance: ${(e as Error).message}`,
      );
    }

    if (res.status === 404) {
      throw new MarketDataError("NOT_FOUND", this.name, `Yahoo Finance has no data for ${symbol}`);
    }
    if (res.status === 429) {
      throw new MarketDataError("RATE_LIMITED", this.name, "Yahoo Finance rate limit reached.");
    }
    if (!res.ok) {
      throw new MarketDataError(
        "PROVIDER_UNAVAILABLE",
        this.name,
        `Yahoo Finance returned HTTP ${res.status}`,
      );
    }

    const raw = (await res.json()) as YahooChartResponse;
    const result = raw.chart?.result?.[0];
    if (!result) {
      throw new MarketDataError(
        "NOT_FOUND",
        this.name,
        `No historical data returned for ${symbol}`,
      );
    }

    const timestamps = result.timestamp ?? [];
    const quote = result.indicators?.quote?.[0];
    const adjClose = result.indicators?.adjclose?.[0]?.adjclose ?? [];
    const splits = result.events?.split ?? {};

    const points: HistoricalPricePoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      if (ts == null) continue;
      const o = quote?.open?.[i];
      const h = quote?.high?.[i];
      const l = quote?.low?.[i];
      const c = quote?.close?.[i];
      const v = quote?.volume?.[i];
      // Skip null entries (holidays, non-trading days)
      if (c == null) continue;
      const date = new Date(ts * 1000).toISOString().slice(0, 10) as DateString;
      points.push({
        date,
        open: o ?? c,
        high: h ?? c,
        low: l ?? c,
        close: c,
        adjustedClose: adjClose[i] ?? c,
        volume: v ?? null,
      });
    }

    if (points.length === 0) {
      throw new MarketDataError(
        "NOT_FOUND",
        this.name,
        `Yahoo Finance returned empty price series for ${symbol}`,
      );
    }

    const fetchedAt = new Date().toISOString();
    return {
      data: { symbol: params.symbol.toUpperCase(), points, fetchedAt, range: params.range },
      fetchedAt,
      fromCache: false,
      provider: this.name,
      dataQuality: "delayed",
    };
  }

  // -------------------------------------------------------------------------
  // Quote (basic — Yahoo quote endpoint)
  // -------------------------------------------------------------------------

  async getQuote(params: QuoteParams): Promise<MarketDataResult<Quote>> {
    const symbol = toYahooSymbol(params.symbol);
    const url = `${YF_BASE}/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; OptionProfitCalculator/1.0)",
        },
        cache: "no-store",
      });
    } catch (e) {
      throw new MarketDataError(
        "PROVIDER_UNAVAILABLE",
        this.name,
        `Network error contacting Yahoo Finance: ${(e as Error).message}`,
      );
    }

    if (!res.ok) {
      throw new MarketDataError(
        "PROVIDER_UNAVAILABLE",
        this.name,
        `Yahoo Finance returned HTTP ${res.status}`,
      );
    }

    const raw = (await res.json()) as YahooQuoteResponse;
    const q = raw.quoteResponse?.result?.[0];
    if (!q) {
      throw new MarketDataError("NOT_FOUND", this.name, `No quote for ${symbol}`);
    }

    const fetchedAt = new Date().toISOString();
    const quote: Quote = {
      symbol: params.symbol.toUpperCase(),
      companyName: q.longName ?? q.shortName ?? q.symbol,
      price: q.regularMarketPrice ?? 0,
      bid: q.bid ?? null,
      ask: q.ask ?? null,
      previousClose: q.regularMarketPreviousClose ?? null,
      open: q.regularMarketOpen ?? null,
      dayHigh: q.regularMarketDayHigh ?? null,
      dayLow: q.regularMarketDayLow ?? null,
      change: q.regularMarketChange ?? null,
      changePercent: q.regularMarketChangePercent ?? null,
      volume: q.regularMarketVolume ?? null,
      marketCap: q.marketCap ?? null,
      timestamp: fetchedAt,
      marketSession: "regular",
      isRealtime: false,
      dataQuality: "delayed",
      week52High: q.fiftyTwoWeekHigh ?? null,
      week52Low: q.fiftyTwoWeekLow ?? null,
      averageVolume: q.averageDailyVolume3Month ?? null,
      regularSessionClose: q.regularMarketPrice ?? null,
      extendedHoursPrice: null,
      extendedHoursChange: null,
      extendedHoursChangePercent: null,
    };

    return {
      data: quote,
      fetchedAt,
      fromCache: false,
      provider: this.name,
      dataQuality: "delayed",
    };
  }

  // -------------------------------------------------------------------------
  // Unsupported endpoints — Yahoo doesn't provide options data
  // -------------------------------------------------------------------------

  async getExpirations(
    _params: ExpirationsParams,
  ): Promise<MarketDataResult<OptionExpiration[]>> {
    throw new MarketDataError(
      "PROVIDER_UNAVAILABLE",
      this.name,
      "Yahoo Finance does not provide option expiration data",
    );
  }

  async getOptionChain(
    _params: OptionChainParams,
  ): Promise<MarketDataResult<OptionChain>> {
    throw new MarketDataError(
      "PROVIDER_UNAVAILABLE",
      this.name,
      "Yahoo Finance does not provide option chain data",
    );
  }

  async getCorporateEvents(
    _params: CorporateEventsParams,
  ): Promise<MarketDataResult<CorporateEvents>> {
    throw new MarketDataError(
      "PROVIDER_UNAVAILABLE",
      this.name,
      "Yahoo Finance does not provide corporate events data",
    );
  }
}

// ---------------------------------------------------------------------------
// Yahoo Finance response types
// ---------------------------------------------------------------------------

interface YahooChartResponse {
  chart?: {
    result?: YahooChartResult[];
    error?: { code: string; description: string };
  };
}

interface YahooChartResult {
  meta?: {
    symbol: string;
    regularMarketPrice: number;
    chartPreviousClose: number;
  };
  timestamp: number[];
  events?: {
    dividends?: Record<number, { date: string; amount: number }>;
    split?: Record<number, { date: string; numerator: number; denominator: number }>;
  };
  indicators: {
    quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }[];
    adjclose?: { adjclose: (number | null)[] }[];
  };
}

interface YahooQuoteResponse {
  quoteResponse?: {
    result: YahooQuoteRaw[];
    error?: string;
  };
}

interface YahooQuoteRaw {
  symbol: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  regularMarketOpen?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  regularMarketChange?: number;
  regularMarketChangePercent?: number;
  marketCap?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  averageDailyVolume3Month?: number;
  bid?: number;
  ask?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert broker-style symbols to Yahoo Finance format. */
function toYahooSymbol(s: string): string {
  const cleaned = s.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
  // Yahoo uses dashes for share classes (e.g. BRK.B → BRK-B)
  return cleaned.replace(/\./g, "-");
}

function rangeToPeriods(range: HistoricalPricesParams["range"]): {
  period1: number;
  period2: number;
} {
  const now = Math.floor(Date.now() / 1000);
  const daySec = 86400;
  switch (range) {
    case "1m": return { period1: now - 31 * daySec, period2: now };
    case "3m": return { period1: now - 91 * daySec, period2: now };
    case "6m": return { period1: now - 182 * daySec, period2: now };
    case "1y": return { period1: now - 365 * daySec, period2: now };
    case "3y": return { period1: now - 365 * 3 * daySec, period2: now };
    case "5y": return { period1: now - 365 * 5 * daySec, period2: now };
    case "10y": return { period1: now - 365 * 10 * daySec, period2: now };
    case "max": return { period1: now - 365 * 20 * daySec, period2: now };
    default: return { period1: now - 365 * 3 * daySec, period2: now };
  }
}
