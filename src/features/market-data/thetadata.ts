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
import { impliedVolatility, blackScholes } from "@/lib/calculations/pricing-model";

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

/** Actual ThetaData v3 EOD response format. */
interface ThetaDataEODResponse {
  data: Array<{
    contract: {
      expiration: string;
      symbol: string;
      strike: number;
      right: string; // "CALL" or "PUT"
    };
    data: Array<{
      bid: number;
      ask: number;
      volume: number;
      open_interest?: number;
      close: number;
      open: number;
      high: number;
      low: number;
      count: number;
      created: string;
      last_trade: string;
    }>;
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

/** Parse ThetaData right field to our canonical type. */
function parseRight(right: string): "CALL" | "PUT" {
  const upper = right.toUpperCase();
  if (upper === "C" || upper === "CALL") return "CALL";
  return "PUT";
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

  const quotes: ThetaDataEODQuote[] = [];
  for (const entry of json.data) {
    const contract = entry.contract;
    const eodData = entry.data?.[0];
    if (!contract || !eodData) continue;

    const bid = eodData.bid ?? 0;
    const ask = eodData.ask ?? 0;

    quotes.push({
      date: dateStr,
      expiration: contract.expiration,
      strike: contract.strike,
      right: parseRight(contract.right),
      bid,
      ask,
      mid: bid > 0 && ask > 0 ? (bid + ask) / 2 : 0,
      volume: eodData.volume ?? 0,
      openInterest: eodData.open_interest ?? 0,
      underlyingPrice: 0,
    });
  }

  return quotes;
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

  const quotes: ThetaDataEODQuote[] = [];
  for (const entry of json.data) {
    const contract = entry.contract;
    const eodData = entry.data?.[0];
    if (!contract || !eodData) continue;

    const bid = eodData.bid ?? 0;
    const ask = eodData.ask ?? 0;
    const createdDate = eodData.created?.slice(0, 10) ?? "";

    quotes.push({
      date: createdDate,
      expiration: contract.expiration,
      strike: contract.strike,
      right: right,
      bid,
      ask,
      mid: bid > 0 && ask > 0 ? (bid + ask) / 2 : 0,
      volume: eodData.volume ?? 0,
      openInterest: eodData.open_interest ?? 0,
      underlyingPrice: 0,
    });
  }

  return quotes;
}

/**
 * Pre-fetch EOD chain data for multiple dates (used by the backtester).
 * Processes sequentially with a configurable delay between requests.
 *
 * @param symbol Stock ticker
 * @param dates Array of date strings (YYYY-MM-DD) to fetch chains for
 * @returns Map of date -> quotes array (all strikes, all expirations)
 */
export async function prefetchEODChains(
  symbol: string,
  dates: string[],
): Promise<Map<string, ThetaDataEODQuote[]>> {
  const cache = new Map<string, ThetaDataEODQuote[]>();
  const base = getBaseUrl();
  // Free tier: 30 req/min = ~2s between requests. Paid tiers can lower this
  // via THETADATA_REQ_DELAY_MS (e.g. 200 for Pro).
  const delayMs = Number(process.env.THETADATA_REQ_DELAY_MS ?? 2100);

  for (const date of dates) {
    const dateParam = formatDate(date);

    const params = new URLSearchParams({
      symbol: symbol.toUpperCase(),
      start_date: dateParam,
      end_date: dateParam,
      expiration: "*",
      strike: "*",
      right: "both",
      format: "json",
    });

    const url = `${base}/option/history/eod?${params.toString()}`;

    const headers: Record<string, string> = {};
    const apiKey = process.env.THETADATA_API_KEY;
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    try {
      const res = await fetch(url, { headers, cache: "no-store" });
      if (!res.ok) {
        console.warn(`ThetaData fetch failed for ${symbol} on ${date}: ${res.status}`);
        cache.set(date, []);
        continue;
      }

      const json = (await res.json()) as ThetaDataEODResponse;
      if (!json.data || !Array.isArray(json.data)) {
        cache.set(date, []);
        continue;
      }

      const quotes: ThetaDataEODQuote[] = [];
      for (const entry of json.data) {
        const contract = entry.contract;
        const eodData = entry.data?.[0];
        if (!contract || !eodData) continue;

        const bid = eodData.bid ?? 0;
        const ask = eodData.ask ?? 0;

        quotes.push({
          date,
          expiration: contract.expiration,
          strike: contract.strike,
          right: parseRight(contract.right),
          bid,
          ask,
          mid: bid > 0 && ask > 0 ? (bid + ask) / 2 : 0,
          volume: eodData.volume ?? 0,
          openInterest: eodData.open_interest ?? 0,
          underlyingPrice: 0,
        });
      }

      cache.set(date, quotes);
    } catch (err) {
      console.warn(`ThetaData fetch error for ${symbol} on ${date}:`, err);
      cache.set(date, []);
    }

    // Rate limit delay between requests (see THETADATA_REQ_DELAY_MS)
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return cache;
}

/**
 * Find the option contract closest to a target delta using real market data.
 * Returns the real bid/ask and the strike, or null if no suitable contract found.
 *
 * The fetched chain contains contracts across ALL expirations, so this first
 * selects the expiration whose DTE (expiration - quote date) is closest to the
 * requested dte, then searches strikes within that single expiration. Without
 * this filter, a 7-DTE and a 180-DTE contract at the same strike would both be
 * priced as if they were the same DTE.
 *
 * Since ThetaData doesn't include Greeks on EOD quotes, we back out IV from
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
  // Filter to the right option type with some market
  const withMarket = quotes
    .filter((q) => q.right === optionType)
    .filter((q) => q.bid > 0 || q.ask > 0)
    .filter((q) => minStrike == null || q.strike >= minStrike);

  if (withMarket.length === 0) return null;

  // --- Select the expiration closest to the target DTE ---
  // Each quote carries its own date + expiration; compute actual DTE per
  // expiration and pick the closest match to the requested dte.
  const expDte = new Map<string, number>();
  for (const q of withMarket) {
    if (expDte.has(q.expiration)) continue;
    const d =
      (new Date(q.expiration).getTime() - new Date(q.date).getTime()) /
      (1000 * 60 * 60 * 24);
    expDte.set(q.expiration, d);
  }
  let bestExp: string | null = null;
  let bestExpDiff = Infinity;
  for (const [exp, d] of expDte) {
    const diff = Math.abs(d - dte);
    if (diff < bestExpDiff) {
      bestExpDiff = diff;
      bestExp = exp;
    }
  }
  if (bestExp == null) return null;

  const filtered = withMarket
    .filter((q) => q.expiration === bestExp)
    .sort((a, b) => a.strike - b.strike);

  if (filtered.length === 0) return null;

  // Use the ACTUAL DTE of the chosen expiration (not the requested target)
  const T = (expDte.get(bestExp) ?? dte) / 365;
  let best: { strike: number; bid: number; ask: number; mid: number; delta: number; iv: number } | null = null;
  let bestDiff = Infinity;

  for (const q of filtered) {
    if (q.mid <= 0) continue;

    // Back out IV from real market mid price
    const iv = impliedVolatility(
      q.mid,
      spot,
      q.strike,
      T,
      riskFreeRate,
      optionType,
      dividendYield ?? 0,
    );

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
