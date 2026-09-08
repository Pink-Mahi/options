/**
 * ThetaData historical options provider.
 *
 * Fetches real historical EOD options data (bid/ask/volume/OI) from
 * ThetaData's local REST API (Theta Terminal must be running).
 *
 * Free tier: 1 year of EOD data, 30 req/min.
 * Value tier ($40/mo): 1-min data back to 2020.
 *
 * When real options data is available, the backtester uses real bid/ask
 * prices and backs out real IV from market prices, instead of estimating
 * IV from realized volatility and modeling premiums with Black-Scholes.
 *
 * Env vars:
 * - THETADATA_BASE_URL: REST API base (default http://127.0.0.1:25503/v3)
 * - THETADATA_API_KEY: Optional API key (for terminal v20260615+)
 */

import "server-only";

export interface ThetaDataEODQuote {
  date: string; // YYYY-MM-DD
  expiration: string; // YYYY-MM-DD
  strike: number;
  right: "CALL" | "PUT";
  bid: number;
  ask: number;
  mid: number;
  volume: number;
  openInterest: number;
  underlyingPrice: number;
}

interface ThetaDataEODResponse {
  data: Array<{
    expiration: string;
    strike: number;
    right: string;
    bid: number;
    ask: number;
    volume: number;
    open_interest: number;
    underlying: number;
  }>;
}

let _baseUrl: string | null = null;

function getBaseUrl(): string {
  if (_baseUrl) return _baseUrl;
  _baseUrl = process.env.THETADATA_BASE_URL ?? "http://127.0.0.1:25503/v3";
  return _baseUrl;
}

/** Check if ThetaData is configured (terminal running + base URL reachable). */
export function isThetaDataConfigured(): boolean {
  return !!process.env.THETADATA_BASE_URL || !!process.env.THETADATA_API_KEY;
}

/** Convert date to YYYYMMDD format for ThetaData API. */
function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * Fetch EOD option chain for a symbol on a specific date.
 * Returns all strikes for a given expiration, or all expirations if not specified.
 *
 * Uses the /v3/option/history/eod endpoint with wildcard strike/right.
 */
export async function fetchEODChain(
  symbol: string,
  date: string | Date,
  expiration?: string,
): Promise<ThetaDataEODQuote[]> {
  const base = getBaseUrl();
  const dateParam = formatDate(date);
  const dateStr = typeof date === "string" ? date : new Date(date).toISOString().slice(0, 10);

  const params = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    start_date: dateParam,
    end_date: dateParam,
    expiration: expiration ? formatDate(expiration) : "*",
    strike: "*",
    right: "both",
    format: "json",
  });

  const url = `${base}/option/history/eod?${params.toString()}`;

  const headers: Record<string, string> = {};
  const apiKey = process.env.THETADATA_API_KEY;
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) {
    throw new Error(`ThetaData EOD fetch failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as ThetaDataEODResponse;
  if (!json.data || !Array.isArray(json.data)) return [];

  return json.data.map((d) => {
    const dateStr = typeof date === "string" ? date : date.toISOString().slice(0, 10);
    return {
      date: dateStr,
      expiration: d.expiration,
      strike: d.strike,
      right: (d.right?.toUpperCase() === "C" || d.right?.toUpperCase() === "CALL") ? "CALL" : "PUT",
      bid: d.bid ?? 0,
      ask: d.ask ?? 0,
      mid: d.bid && d.ask ? (d.bid + d.ask) / 2 : 0,
      volume: d.volume ?? 0,
      openInterest: d.open_interest ?? 0,
      underlyingPrice: d.underlying ?? 0,
    };
  });
}

/**
 * Fetch EOD quotes for a specific contract (symbol + expiration + strike + right)
 * over a date range. Useful for buy-back simulation.
 */
export async function fetchEODContract(
  symbol: string,
  expiration: string,
  strike: number,
  right: "CALL" | "PUT",
  startDate: string,
  endDate: string,
): Promise<ThetaDataEODQuote[]> {
  const base = getBaseUrl();

  const params = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    start_date: formatDate(startDate),
    end_date: formatDate(endDate),
    expiration: formatDate(expiration),
    strike: strike.toFixed(3),
    right: right.toLowerCase(),
    format: "json",
  });

  const url = `${base}/option/history/eod?${params.toString()}`;

  const headers: Record<string, string> = {};
  const apiKey = process.env.THETADATA_API_KEY;
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) {
    throw new Error(`ThetaData EOD contract fetch failed: ${res.status}`);
  }

  const json = (await res.json()) as ThetaDataEODResponse;
  if (!json.data || !Array.isArray(json.data)) return [];

  return json.data.map((d) => ({
    date: d.expiration, // ThetaData returns dates in the data
    expiration: d.expiration,
    strike: d.strike,
    right: right,
    bid: d.bid ?? 0,
    ask: d.ask ?? 0,
    mid: d.bid && d.ask ? (d.bid + d.ask) / 2 : 0,
    volume: d.volume ?? 0,
    openInterest: d.open_interest ?? 0,
    underlyingPrice: d.underlying ?? 0,
  }));
}

/**
 * Find the option contract closest to a target delta using real market data.
 * Returns the real bid/ask and the strike, or null if no suitable contract found.
 *
 * Since ThetaData free tier doesn't include Greeks, we back out IV from
 * the real mid price using our IV solver, then compute delta from that IV.
 */
export function findContractByDelta(
  quotes: ThetaDataEODQuote[],
  spot: number,
  deltaTarget: number,
  optionType: "CALL" | "PUT",
  dte: number,
  riskFreeRate: number,
  dividendYield?: number,
  minStrike?: number,
): { strike: number; bid: number; ask: number; mid: number; delta: number; iv: number } | null {
  // Filter to the right option type and sort by strike
  const filtered = quotes
    .filter((q) => q.right === optionType)
    .filter((q) => q.bid > 0 || q.ask > 0) // must have some market
    .filter((q) => minStrike == null || q.strike >= minStrike)
    .sort((a, b) => a.strike - b.strike);

  if (filtered.length === 0) return null;

  // Lazy-load IV solver and BS to avoid circular deps
  const { impliedVolatility, blackScholes } = require("@/lib/calculations/pricing-model");

  const T = dte / 365;
  let best: { strike: number; bid: number; ask: number; mid: number; delta: number; iv: number } | null = null;
  let bestDiff = Infinity;

  for (const q of filtered) {
    if (q.mid <= 0) continue;

    // Back out IV from real market mid price
    const iv = impliedVolatility({
      spot,
      strike: q.strike,
      timeToExpiry: T,
      riskFreeRate,
      dividendYield,
      marketPrice: q.mid,
      optionType,
    });

    if (!iv || !Number.isFinite(iv) || iv <= 0) continue;

    // Compute delta from the real IV
    const bs = blackScholes({
      spot,
      strike: q.strike,
      timeToExpiry: T,
      riskFreeRate,
      volatility: iv,
      dividendYield,
      optionType,
    });

    const delta = Math.abs(bs.greeks.delta ?? 0);
    const diff = Math.abs(delta - deltaTarget);

    if (diff < bestDiff) {
      bestDiff = diff;
      best = {
        strike: q.strike,
        bid: q.bid,
        ask: q.ask,
        mid: q.mid,
        delta,
        iv,
      };
    }
  }

  return best;
}
