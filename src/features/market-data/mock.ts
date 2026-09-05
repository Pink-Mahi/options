/**
 * Mock market-data provider for offline/test use.
 *
 * Returns deterministic fixtures so the app can run end-to-end without a real
 * API key. Used by automated tests and as a fallback when no provider key is
 * configured. NEVER used to fabricate data in production paths — the service
 * only selects the mock when explicitly configured or when no key is present
 * AND the user has opted into demo mode.
 */

import type {
  CorporateEvents,
  HistoricalPriceSeries,
  OptionChain,
  OptionContract,
  OptionExpiration,
  Quote,
} from "@/lib/types";
import type {
  MarketDataResult,
  MarketDataProvider,
  QuoteParams,
  HistoricalPricesParams,
  ExpirationsParams,
  OptionChainParams,
  CorporateEventsParams,
} from "./provider";

const DEMO_PRICE = 175.42;

export class MockProvider implements MarketDataProvider {
  readonly name = "mock";

  async getQuote(params: QuoteParams): Promise<MarketDataResult<Quote>> {
    const symbol = params.symbol.toUpperCase();
    const quote: Quote = {
      symbol,
      companyName: `${symbol} Demo Corp`,
      price: DEMO_PRICE,
      bid: DEMO_PRICE - 0.05,
      ask: DEMO_PRICE + 0.05,
      previousClose: DEMO_PRICE - 1.2,
      open: DEMO_PRICE - 0.8,
      dayHigh: DEMO_PRICE + 0.6,
      dayLow: DEMO_PRICE - 0.9,
      change: 1.2,
      changePercent: 1.2 / (DEMO_PRICE - 1.2),
      volume: 48_000_000,
      marketCap: 2_700_000_000_000,
      timestamp: new Date().toISOString(),
      marketSession: "closed",
      isRealtime: false,
      dataQuality: "delayed",
      regularSessionClose: DEMO_PRICE - 1.2,
      extendedHoursPrice: null,
      extendedHoursChange: null,
      extendedHoursChangePercent: null,
      week52High: DEMO_PRICE + 12.0,
      week52Low: DEMO_PRICE - 28.0,
      averageVolume: 52_000_000,
    };
    return this.wrap(quote);
  }

  async getHistoricalPrices(
    params: HistoricalPricesParams,
  ): Promise<MarketDataResult<HistoricalPriceSeries>> {
    const days = rangeDays(params.range);
    const pts = [];
    let p = 120;
    const base = Date.now() - days * 86400000;
    for (let i = 0; i < days; i++) {
      const date = new Date(base + i * 86400000).toISOString().slice(0, 10);
      const drift = Math.sin(i / 18) * 1.5 + 0.05;
      p = Math.max(20, p + drift + (i % 7 === 0 ? -1.2 : 0));
      pts.push({
        date,
        open: p - 0.5,
        high: p + 1,
        low: p - 1,
        close: p,
        adjustedClose: p,
        volume: 40_000_000,
      });
    }
    return this.wrap({
      symbol: params.symbol.toUpperCase(),
      points: pts,
      fetchedAt: new Date().toISOString(),
      range: params.range,
    });
  }

  async getExpirations(
    params: ExpirationsParams,
  ): Promise<MarketDataResult<OptionExpiration[]>> {
    const today = new Date();
    const offsets = [7, 14, 21, 30, 45, 60, 90, 120, 180, 270, 365, 540, 730];
    const expirations: OptionExpiration[] = offsets.map((d) => {
      const exp = new Date(today.getTime() + d * 86400000);
      return {
        expirationDate: exp.toISOString().slice(0, 10),
        daysToExpiration: d,
        isWeekly: d <= 14,
        isMonthly: d === 30 || d === 60 || d === 90,
        isQuarterly: d === 90 || d === 180,
        isLEAP: d >= 365,
      };
    });
    return this.wrap(expirations);
  }

  async getOptionChain(
    params: OptionChainParams,
  ): Promise<MarketDataResult<OptionChain>> {
    const symbol = params.symbol.toUpperCase();
    const underlyingPrice = DEMO_PRICE;
    const exp = new Date(params.expiration + "T00:00:00Z");
    const dte = Math.max(
      1,
      Math.floor((exp.getTime() - Date.now()) / 86400000),
    );
    const strikes: number[] = [];
    for (let k = 0.6; k <= 2.0; k += 0.025) {
      strikes.push(Math.round(underlyingPrice * k * 100) / 100);
    }
    const calls: OptionContract[] = [];
    const puts: OptionContract[] = [];
    for (const strike of strikes) {
      calls.push(mockOption(symbol, "CALL", strike, params.expiration, dte, underlyingPrice));
      puts.push(mockOption(symbol, "PUT", strike, params.expiration, dte, underlyingPrice));
    }
    return this.wrap({
      underlyingSymbol: symbol,
      expiration: params.expiration,
      underlyingPrice,
      calls,
      puts,
      quoteTimestamp: new Date().toISOString(),
    });
  }

  async getCorporateEvents(
    params: CorporateEventsParams,
  ): Promise<MarketDataResult<CorporateEvents>> {
    const symbol = params.symbol.toUpperCase();
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const in60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    return this.wrap({
      symbol,
      dividends: [{ symbol, exDate: in60, payDate: in62(), amount: 0.24, frequency: "quarterly" }],
      earnings: [{ symbol, date: in30, timing: "post", confirmed: false }],
      fetchedAt: new Date().toISOString(),
    });
  }

  private wrap<T>(data: T): MarketDataResult<T> {
    return {
      data,
      fetchedAt: new Date().toISOString(),
      fromCache: false,
      provider: this.name,
      dataQuality: "delayed",
    };
  }
}

function in62(): string {
  return new Date(Date.now() + 62 * 86400000).toISOString().slice(0, 10);
}

function rangeDays(range: HistoricalPricesParams["range"]): number {
  switch (range) {
    case "1m": return 31;
    case "3m": return 91;
    case "6m": return 182;
    case "1y": return 252;
    case "3y": return 756;
    case "5y": return 1260;
    case "10y": return 2520;
    case "max": return 2520;
  }
}

function mockOption(
  symbol: string,
  type: "CALL" | "PUT",
  strike: number,
  expiration: string,
  dte: number,
  underlying: number,
): OptionContract {
  // Crude but deterministic pricing: distance-based + time value.
  const distance =
    type === "CALL"
      ? (strike - underlying) / underlying
      : (underlying - strike) / underlying;
  const intrinsic =
    type === "CALL"
      ? Math.max(0, underlying - strike)
      : Math.max(0, strike - underlying);
  const timeValue = Math.max(0.05, underlying * 0.04 * Math.sqrt(dte / 365) * Math.exp(-Math.max(0, distance) * 2));
  const price = intrinsic + timeValue;
  const bid = Math.round((price * 0.98) * 100) / 100;
  const ask = Math.round((price * 1.02) * 100) / 100;
  const mid = Math.round(((bid + ask) / 2) * 100) / 100;
  // Rough delta: call delta ~ N(d1-ish), simplified.
  const callDelta = clamp01(0.5 - distance * 2.2);
  const delta = type === "CALL" ? callDelta : -(1 - callDelta);
  return {
    symbol: `${symbol}${expiration.replace(/-/g, "")}${type === "CALL" ? "C" : "P"}${String(Math.round(strike * 1000)).padStart(8, "0")}`,
    underlyingSymbol: symbol,
    optionType: type,
    strike,
    expiration,
    daysToExpiration: dte,
    bid,
    ask,
    midpoint: mid,
    last: mid,
    volume: Math.round(1000 * Math.exp(-Math.abs(distance) * 4)),
    openInterest: Math.round(5000 * Math.exp(-Math.abs(distance) * 3)),
    impliedVolatility: 0.3 + Math.max(0, distance) * 0.5,
    greeks: {
      delta,
      gamma: 0.01,
      theta: -price / dte,
      vega: 0.1,
      rho: 0.01,
    },
    intrinsicValue: intrinsic,
    extrinsicValue: timeValue,
    inTheMoney: intrinsic > 0,
    underlyingPrice: underlying,
    quoteTimestamp: new Date().toISOString(),
    greeksProvenance: "calculated",
  };
}

function clamp01(x: number): number {
  return Math.max(0.001, Math.min(0.999, x));
}
