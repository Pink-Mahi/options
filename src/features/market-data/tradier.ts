/**
 * Tradier market-data provider.
 *
 * Implements the MarketDataProvider interface and normalizes Tradier's raw
 * responses into the canonical domain models. Provider-specific field names
 * never leak beyond this file.
 *
 * Tradier API docs: https://documentation.tradier.com/brokerage-api/
 * Sandbox base: https://sandbox.tradier.com/v1
 * Production base: https://api.tradier.com/v1
 *
 * Requires TRADIER_API_KEY (passed as MARKET_DATA_API_KEY) server-side only.
 */

import type {
  CorporateEvents,
  DateString,
  HistoricalPricePoint,
  HistoricalPriceSeries,
  OptionChain,
  OptionContract,
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

export interface TradierConfig {
  apiKey: string;
  baseUrl: string;
  /** "realtime" | "delayed" depending on subscription entitlement. */
  entitlement: "realtime" | "delayed";
}

interface TradierQuoteResponse {
  quotes?: {
    quote?: TradierQuoteRaw | TradierQuoteRaw[];
  };
}

interface TradierQuoteRaw {
  symbol: string;
  description?: string;
  last?: number | null;
  bid?: number | null;
  ask?: number | null;
  prevclose?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  change?: number | null;
  change_percentage?: number | null;
  volume?: number | null;
  market_cap?: number | null;
  average_volume?: number | null;
  week_52_high?: number | null;
  week_52_low?: number | null;
  trade_date?: number | null;
  timestamp?: string;
  type?: string;
}

interface TradierHistoryResponse {
  history?: {
    day?: TradierDayRaw[] | TradierDayRaw;
  };
}

interface TradierDayRaw {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TradierExpirationsResponse {
  expirations?: {
    date?: string | string[];
  };
}

interface TradierChainResponse {
  // Sandbox format: optionchain.underlying + optionchain.options[].option[]
  optionchain?: {
    underlying?: { symbol: string; last: number };
    options?: {
      option?: TradierOptionRaw[] | TradierOptionRaw;
    }[];
  };
  // Production format: options.option[] (no wrapper)
  options?: {
    option?: TradierOptionRaw[] | TradierOptionRaw;
  };
}

interface TradierOptionRaw {
  symbol: string;
  option_type: "call" | "put";
  strike: number;
  expiry_date?: string; // sandbox format
  expiration_date?: string; // production format
  bid: number | null;
  ask: number | null;
  mid?: number | null;
  last: number | null;
  volume: number | null;
  open_interest: number | null;
  greeks?: {
    delta?: number | null;
    gamma?: number | null;
    theta?: number | null;
    vega?: number | null;
    rho?: number | null;
    mid_iv?: number | null;
    bid_iv?: number | null;
    ask_iv?: number | null;
  } | null;
  underlying_price?: number;
  timestamp?: string;
}

export class TradierProvider implements MarketDataProvider {
  readonly name = "tradier";
  private config: TradierConfig;

  constructor(config: TradierConfig) {
    this.config = config;
  }

  // -------------------------------------------------------------------------
  // HTTP
  // -------------------------------------------------------------------------

  private async request<T>(path: string): Promise<T> {
    if (!this.config.apiKey) {
      throw new MarketDataError(
        "UNAUTHORIZED",
        this.name,
        "TRADIER_API_KEY is not configured. Set MARKET_DATA_API_KEY in .env.local",
      );
    }
    const url = `${this.config.baseUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: "application/json",
        },
        // Next.js fetch caching off — we manage our own cache.
        cache: "no-store",
      });
    } catch (e) {
      throw new MarketDataError(
        "PROVIDER_UNAVAILABLE",
        this.name,
        `Network error contacting Tradier: ${(e as Error).message}`,
      );
    }

    if (res.status === 401 || res.status === 403) {
      throw new MarketDataError("UNAUTHORIZED", this.name, "Tradier rejected the API key.");
    }
    if (res.status === 429) {
      throw new MarketDataError("RATE_LIMITED", this.name, "Tradier rate limit reached.");
    }
    if (res.status === 404) {
      throw new MarketDataError("NOT_FOUND", this.name, `Tradier returned 404 for ${path}`);
    }
    if (!res.ok) {
      throw new MarketDataError(
        "PROVIDER_UNAVAILABLE",
        this.name,
        `Tradier returned HTTP ${res.status}`,
      );
    }
    return (await res.json()) as T;
  }

  private quality(): MarketDataResult<unknown>["dataQuality"] {
    return this.config.entitlement === "realtime" ? "realtime" : "delayed";
  }

  // -------------------------------------------------------------------------
  // Quote
  // -------------------------------------------------------------------------

  async getQuote(params: QuoteParams): Promise<MarketDataResult<Quote>> {
    const symbol = sanitizeSymbol(params.symbol);
    const raw = await this.request<TradierQuoteResponse>(
      `/markets/quotes?symbols=${encodeURIComponent(symbol)}`,
    );
    const q = unwrapArray(raw.quotes?.quote)[0];
    if (!q) {
      throw new MarketDataError("NOT_FOUND", this.name, `No quote for ${symbol}`);
    }

    // Tradier returns trade_date as epoch milliseconds; fall back to timestamp string.
    const fetchedAt = q.trade_date != null
      ? new Date(q.trade_date).toISOString()
      : q.timestamp ?? new Date().toISOString();

    const last = num(q.last);
    const prev = num(q.prevclose);
    const regularClose = num(q.close);
    const change = num(q.change) ?? (last != null && prev != null ? last - prev : null);
    const changePct =
      num(q.change_percentage) ??
      (last != null && prev != null && prev !== 0 ? (last - prev) / prev : null);

    const session = inferSession(fetchedAt);

    // Extended-hours logic:
    // - After-hours (post): close is set, last != close → extended hours price is `last`
    // - Pre-market (pre): close is null, last != prevclose → extended hours price is `last`
    let extPrice: number | null = null;
    let extChange: number | null = null;
    let extChangePct: number | null = null;

    if (session === "post" && regularClose != null && last != null) {
      if (last !== regularClose) {
        extPrice = last;
        extChange = last - regularClose;
        extChangePct = regularClose !== 0 ? extChange / regularClose : null;
      }
    } else if (session === "pre" && last != null && prev != null) {
      extPrice = last;
      extChange = last - prev;
      extChangePct = prev !== 0 ? extChange / prev : null;
    }

    const quote: Quote = {
      symbol: q.symbol,
      companyName: q.description ?? q.symbol,
      price: last ?? 0,
      bid: num(q.bid),
      ask: num(q.ask),
      previousClose: prev,
      open: num(q.open),
      dayHigh: num(q.high),
      dayLow: num(q.low),
      change,
      changePercent: changePct,
      volume: num(q.volume),
      marketCap: num(q.market_cap),
      timestamp: fetchedAt,
      marketSession: session,
      isRealtime: this.config.entitlement === "realtime",
      dataQuality: this.quality(),
      regularSessionClose: regularClose,
      extendedHoursPrice: extPrice,
      extendedHoursChange: extChange,
      extendedHoursChangePercent: extChangePct,
      week52High: num(q.week_52_high),
      week52Low: num(q.week_52_low),
      averageVolume: num(q.average_volume),
    };
    return this.wrap(quote, fetchedAt);
  }

  // -------------------------------------------------------------------------
  // Historical prices
  // -------------------------------------------------------------------------

  async getHistoricalPrices(
    params: HistoricalPricesParams,
  ): Promise<MarketDataResult<HistoricalPriceSeries>> {
    const symbol = sanitizeSymbol(params.symbol);
    // Tradier history endpoint takes explicit start/end dates.
    const { start, end } = rangeToDates(params.range);
    const raw = await this.request<TradierHistoryResponse>(
      `/markets/history?symbol=${encodeURIComponent(symbol)}&start=${start}&end=${end}`,
    );
    const days = unwrapArray(raw.history?.day) ?? [];
    const points: HistoricalPricePoint[] = days.map((d) => ({
      date: d.date as DateString,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      // Tradier does not provide adjusted close; use close. A second provider
      // can later supply split/dividend-adjusted prices via the same interface.
      adjustedClose: d.close,
      volume: d.volume ?? null,
    }));
    const fetchedAt = new Date().toISOString();
    return this.wrap(
      { symbol, points, fetchedAt, range: params.range },
      fetchedAt,
    );
  }

  // -------------------------------------------------------------------------
  // Expirations
  // -------------------------------------------------------------------------

  async getExpirations(
    params: ExpirationsParams,
  ): Promise<MarketDataResult<OptionExpiration[]>> {
    const symbol = sanitizeSymbol(params.symbol);
    const raw = await this.request<TradierExpirationsResponse>(
      `/markets/options/expirations?symbol=${encodeURIComponent(symbol)}`,
    );
    const dates = unwrapArray(raw.expirations?.date) ?? [];
    const today = new Date();
    const expirations: OptionExpiration[] = dates.map((d) => {
      const exp = new Date(d + "T00:00:00Z");
      const dte = Math.max(
        0,
        Math.floor((exp.getTime() - today.getTime()) / 86400000),
      );
      return {
        expirationDate: d as DateString,
        daysToExpiration: dte,
        isWeekly: false,
        isMonthly: isMonthlyExpiration(exp),
        isQuarterly: isQuarterlyExpiration(exp),
        isLEAP: dte >= 365,
      };
    });
    const fetchedAt = new Date().toISOString();
    return this.wrap(expirations, fetchedAt);
  }

  // -------------------------------------------------------------------------
  // Option chain
  // -------------------------------------------------------------------------

  async getOptionChain(
    params: OptionChainParams,
  ): Promise<MarketDataResult<OptionChain>> {
    const symbol = sanitizeSymbol(params.symbol);
    const raw = await this.request<TradierChainResponse>(
      `/markets/options/chains?symbol=${encodeURIComponent(symbol)}&expiration=${params.expiration}&greeks=true`,
    );

    // Handle both sandbox (optionchain wrapper) and production (options wrapper) formats.
    let underlyingPrice = 0;
    let rawOptions: TradierOptionRaw[] = [];

    if (raw.optionchain) {
      // Sandbox format.
      underlyingPrice = raw.optionchain.underlying?.last ?? 0;
      const optionsBlocks = unwrapArray(raw.optionchain.options) ?? [];
      for (const block of optionsBlocks) {
        const opts = unwrapArray(block.option) ?? [];
        rawOptions.push(...opts);
      }
    } else if (raw.options) {
      // Production format.
      rawOptions = unwrapArray(raw.options.option) ?? [];
      // Underlying price not included in production chain response — fetch from first option.
      underlyingPrice = 0; // Will be resolved from quote cache.
    }

    // If we still don't have the underlying price, fetch it from the quote endpoint.
    if (underlyingPrice === 0 && rawOptions.length > 0) {
      try {
        const quoteRaw = await this.request<TradierQuoteResponse>(
          `/markets/quotes?symbols=${encodeURIComponent(symbol)}`,
        );
        const q = unwrapArray(quoteRaw.quotes?.quote)[0];
        underlyingPrice = num(q?.last) ?? 0;
      } catch {
        // If quote fetch fails, use 0 — the UI will handle it.
      }
    }

    const calls: OptionContract[] = [];
    const puts: OptionContract[] = [];
    const quoteTimestamp = new Date().toISOString();

    for (const o of rawOptions) {
      const contract = normalizeOption(o, symbol, underlyingPrice, quoteTimestamp);
      if (o.option_type === "call") calls.push(contract);
      else puts.push(contract);
    }

    calls.sort((a, b) => a.strike - b.strike);
    puts.sort((a, b) => a.strike - b.strike);

    const fetchedAt = new Date().toISOString();
    return this.wrap(
      {
        underlyingSymbol: symbol,
        expiration: params.expiration,
        underlyingPrice,
        calls,
        puts,
        quoteTimestamp,
      },
      fetchedAt,
    );
  }

  // -------------------------------------------------------------------------
  // Corporate events (earnings + dividends)
  // -------------------------------------------------------------------------

  async getCorporateEvents(
    params: CorporateEventsParams,
  ): Promise<MarketDataResult<CorporateEvents>> {
    const symbol = sanitizeSymbol(params.symbol);
    // Tradier corporate-calendar endpoint.
    // Note: This endpoint may not be available on all Tradier plans.
    // If it returns 404, we gracefully return empty events.
    let events: TradierEventRaw[] = [];
    try {
      const raw = await this.request<{
        events?: { data?: TradierEventRaw[] };
      }>(`/markets/calendars?symbols=${encodeURIComponent(symbol)}`);
      events = raw.events?.data ?? [];
    } catch {
      // Endpoint not available — return empty events.
    }
    const fetchedAt = new Date().toISOString();
    return this.wrap(
      {
        symbol,
        dividends: events
          .filter((e) => e.type === "dividend")
          .map((e) => ({
            symbol,
            exDate: e.ex_date ?? e.date,
            payDate: e.pay_date ?? null,
            amount: num(e.amount) ?? 0,
            frequency: e.frequency ?? null,
          })),
        earnings: events
          .filter((e) => e.type === "earnings")
          .map((e) => ({
            symbol,
            date: e.date,
            timing:
              e.earnings_type === "pre" || e.earnings_type === "post"
                ? e.earnings_type
                : "unspecified",
            confirmed: Boolean(e.confirmed),
          })),
        fetchedAt,
      },
      fetchedAt,
    );
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private wrap<T>(data: T, fetchedAt: TimestampString): MarketDataResult<T> {
    return {
      data,
      fetchedAt,
      fromCache: false,
      provider: this.name,
      dataQuality: this.quality(),
    };
  }
}

interface TradierEventRaw {
  type: string;
  date: string;
  ex_date?: string;
  pay_date?: string;
  amount?: number | null;
  frequency?: string | null;
  earnings_type?: string | null;
  confirmed?: boolean;
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function normalizeOption(
  o: TradierOptionRaw,
  underlying: string,
  underlyingPrice: number,
  quoteTimestamp: TimestampString,
): OptionContract {
  const strike = o.strike;
  const expiry = o.expiry_date ?? o.expiration_date ?? "";
  const today = new Date();
  const exp = new Date(expiry + "T00:00:00Z");
  const dte = Math.max(0, Math.floor((exp.getTime() - today.getTime()) / 86400000));
  const bid = num(o.bid);
  const ask = num(o.ask);
  const mid = num(o.mid) ?? (bid != null && ask != null ? (bid + ask) / 2 : null);
  const last = num(o.last);
  const price = mid ?? last ?? bid ?? ask ?? 0;
  const iv = o.greeks?.mid_iv ?? o.greeks?.bid_iv ?? o.greeks?.ask_iv ?? null;
  const optionType = o.option_type === "call" ? "CALL" : "PUT";
  const intrinsic =
    optionType === "CALL"
      ? Math.max(0, underlyingPrice - strike)
      : Math.max(0, strike - underlyingPrice);
  const inTheMoney = intrinsic > 0;
  const extrinsic = Math.max(0, price - intrinsic);

  return {
    symbol: o.symbol,
    underlyingSymbol: underlying,
    optionType,
    strike,
    expiration: expiry as DateString,
    daysToExpiration: dte,
    bid,
    ask,
    midpoint: mid,
    last,
    volume: num(o.volume),
    openInterest: num(o.open_interest),
    impliedVolatility: iv,
    greeks: {
      delta: num(o.greeks?.delta) ?? null,
      gamma: num(o.greeks?.gamma) ?? null,
      theta: num(o.greeks?.theta) ?? null,
      vega: num(o.greeks?.vega) ?? null,
      rho: num(o.greeks?.rho) ?? null,
    },
    intrinsicValue: intrinsic,
    extrinsicValue: extrinsic,
    inTheMoney,
    underlyingPrice,
    quoteTimestamp,
    greeksProvenance: o.greeks ? "provider" : "unknown",
  };
}

function num(x: number | null | undefined): number | null {
  if (x == null) return null;
  if (typeof x === "number" && Number.isFinite(x)) return x;
  return null;
}

function unwrapArray<T>(x: T | T[] | undefined | null): T[] {
  if (x == null) return [];
  if (Array.isArray(x)) return x;
  return [x];
}

function sanitizeSymbol(s: string): string {
  const cleaned = s.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
  if (!cleaned) {
    throw new MarketDataError("INVALID_RESPONSE", "tradier", "Empty symbol");
  }
  return cleaned;
}

function rangeToDates(range: HistoricalPricesParams["range"]): {
  start: string;
  end: string;
} {
  const end = new Date();
  let start = new Date();
  switch (range) {
    case "1m": start = subDays(end, 31); break;
    case "3m": start = subDays(end, 91); break;
    case "6m": start = subDays(end, 182); break;
    case "1y": start = subDays(end, 365); break;
    case "3y": start = subDays(end, 365 * 3); break;
    case "5y": start = subDays(end, 365 * 5); break;
    case "10y": start = subDays(end, 365 * 10); break;
    case "max": start = subDays(end, 365 * 20); break;
  }
  return { start: isoDate(start), end: isoDate(end) };
}

function subDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - n);
  return x;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function inferSession(ts: TimestampString): Quote["marketSession"] {
  const d = new Date(ts);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(get("minute"), 10);
  const totalMinutes = hour * 60 + minute;

  if (weekday === "Sat" || weekday === "Sun") return "closed";
  // Pre-market: 4:00 AM – 9:30 AM ET
  if (totalMinutes >= 240 && totalMinutes < 570) return "pre";
  // Regular: 9:30 AM – 4:00 PM ET
  if (totalMinutes >= 570 && totalMinutes < 960) return "regular";
  // After-hours: 4:00 PM – 8:00 PM ET
  if (totalMinutes >= 960 && totalMinutes < 1200) return "post";
  return "closed";
}

function isMonthlyExpiration(d: Date): boolean {
  // Third Friday of the month.
  if (d.getUTCDay() !== 5) return false;
  const date = d.getUTCDate();
  return date >= 15 && date <= 21;
}

function isQuarterlyExpiration(d: Date): boolean {
  if (!isMonthlyExpiration(d)) return false;
  const m = d.getUTCMonth();
  return m === 2 || m === 5 || m === 8 || m === 11; // Mar/Jun/Sep/Dec
}
