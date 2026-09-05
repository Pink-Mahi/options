/**
 * Market-data provider abstraction.
 *
 * Every provider (Tradier, Polygon, Tiingo, ...) implements this interface and
 * normalizes its raw response into the canonical domain models in `@/lib/types`.
 *
 * The calculation engine, scanners, AI layer, and UI depend ONLY on this
 * interface — never on a provider's raw response format.
 */

import type {
  CorporateEvents,
  DateString,
  HistoricalPriceSeries,
  OptionChain,
  OptionExpiration,
  Quote,
  TimestampString,
} from "@/lib/types";

export interface MarketDataResult<T> {
  data: T;
  fetchedAt: TimestampString;
  /** Whether the underlying provider call hit the network or was served from cache. */
  fromCache: boolean;
  /** Provider that produced this data. */
  provider: string;
  /** Data-quality label surfaced to the UI. */
  dataQuality: "realtime" | "delayed" | "unknown";
}

export interface QuoteParams {
  symbol: string;
}

export interface HistoricalPricesParams {
  symbol: string;
  range: "1m" | "3m" | "6m" | "1y" | "3y" | "5y" | "10y" | "max";
}

export interface ExpirationsParams {
  symbol: string;
}

export interface OptionChainParams {
  symbol: string;
  expiration: DateString;
}

export interface CorporateEventsParams {
  symbol: string;
}

export interface MarketDataProvider {
  /** Stable identifier, e.g. "tradier". */
  readonly name: string;

  getQuote(params: QuoteParams): Promise<MarketDataResult<Quote>>;
  getHistoricalPrices(
    params: HistoricalPricesParams,
  ): Promise<MarketDataResult<HistoricalPriceSeries>>;
  getExpirations(
    params: ExpirationsParams,
  ): Promise<MarketDataResult<OptionExpiration[]>>;
  getOptionChain(
    params: OptionChainParams,
  ): Promise<MarketDataResult<OptionChain>>;
  getCorporateEvents(
    params: CorporateEventsParams,
  ): Promise<MarketDataResult<CorporateEvents>>;
}

/**
 * Error thrown when a provider returns no data or an invalid response.
 * Distinct from network errors so the UI can show "ticker not found" vs
 * "provider unavailable".
 */
export class MarketDataError extends Error {
  readonly code:
    | "NOT_FOUND"
    | "PROVIDER_UNAVAILABLE"
    | "INVALID_RESPONSE"
    | "RATE_LIMITED"
    | "UNAUTHORIZED";
  readonly provider: string;
  constructor(
    code: MarketDataError["code"],
    provider: string,
    message: string,
  ) {
    super(message);
    this.code = code;
    this.provider = provider;
    this.name = "MarketDataError";
  }
}
