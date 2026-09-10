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
import { prisma } from "@/lib/database/prisma";

export interface ThetaDataEODQuote {
  date: string; // YYYY-MM-DD
  expiration: string; // YYYY-MM-DD
  strike: number;
  right: "CALL" | "PUT";
  bid: number;
  ask: number;
  mid: number;
  /** Traded high for the day (0 when the contract did not trade) */
  high: number;
  /** Traded low for the day (0 when the contract did not trade) */
  low: number;
  /** Option closing print */
  close: number;
  volume: number;
  openInterest: number;
  underlyingPrice: number;
}

/**
 * Actual ThetaData v3 EOD response format. The terminal wraps the payload
 * array in "response" (verified by smoke test on the bundled JAR); older
 * docs use "data" — accept both.
 */
interface ThetaDataEODEntry {
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
}

interface ThetaDataEODResponse {
  response?: ThetaDataEODEntry[];
  data?: ThetaDataEODEntry[];
}

/** The v3 terminal returns the payload under "response"; fall back to "data". */
function extractEntries(json: ThetaDataEODResponse): ThetaDataEODEntry[] {
  return json.response ?? json.data ?? [];
}

let _baseUrl: string | null = null;

function getBaseUrl(): string {
  if (_baseUrl) return _baseUrl;
  _baseUrl = process.env.THETADATA_BASE_URL ?? "http://127.0.0.1:25503/v3";
  return _baseUrl;
}

/**
 * Check if ThetaData is configured.
 * True when: an explicit base URL is set (local dev), an API key is set
 * (portal mode), or terminal credentials are set (Docker/Coolify mode —
 * the start script launches the terminal with these creds).
 */
export function isThetaDataConfigured(): boolean {
  return (
    !!process.env.THETADATA_BASE_URL ||
    !!process.env.THETADATA_API_KEY ||
    (!!process.env.THETADATA_EMAIL && !!process.env.THETADATA_PASSWORD)
  );
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
  const entries = extractEntries(json);
  if (entries.length === 0) return [];

  const quotes: ThetaDataEODQuote[] = [];
  for (const entry of entries) {
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
      high: eodData.high ?? 0,
      low: eodData.low ?? 0,
      close: eodData.close ?? 0,
      volume: eodData.volume ?? 0,
      openInterest: eodData.open_interest ?? 0,
      underlyingPrice: 0,
    });
  }

  return quotes;
}

/**
 * Fetch EOD quotes for a specific contract (symbol + expiration + strike + right)
 * over a date range. Returns one row per trading day — used for GTC
 * touch simulation (a resting order fills the day the price trades
 * through its limit, which daily high/low captures).
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
  const entries = extractEntries(json);
  if (entries.length === 0) return [];

  const quotes: ThetaDataEODQuote[] = [];
  for (const entry of entries) {
    const contract = entry.contract;
    if (!contract) continue;

    // A ranged request returns one row per trading day in entry.data —
    // iterate all of them, not just the first.
    for (const eodData of entry.data ?? []) {
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
        high: eodData.high ?? 0,
        low: eodData.low ?? 0,
        close: eodData.close ?? 0,
        volume: eodData.volume ?? 0,
        openInterest: eodData.open_interest ?? 0,
        underlyingPrice: 0,
      });
    }
  }

  return quotes;
}

/**
 * Fetch daily EOD rows for a specific contract, keyed by date (YYYY-MM-DD).
 * Backtester hook for GTC touch simulation. Empty map = no data available
 * (caller should fall back to modeled checks).
 */
export async function fetchContractDailyRows(
  symbol: string,
  expiration: string,
  strike: number,
  right: "CALL" | "PUT",
  startDate: string,
  endDate: string,
): Promise<Map<string, ThetaDataEODQuote>> {
  const rows = await fetchEODContract(symbol, expiration, strike, right, startDate, endDate);
  const map = new Map<string, ThetaDataEODQuote>();
  for (const row of rows) {
    if (row.date) map.set(row.date, row);
  }
  return map;
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
  onProgress?: (done: number, total: number, cachedCount: number) => void,
): Promise<Map<string, ThetaDataEODQuote[]>> {
  const cache = new Map<string, ThetaDataEODQuote[]>();
  const sym = symbol.toUpperCase();

  // --- Phase 1: Load cached chains from the database ---
  // Each date's chain is stored as a MarketDataCache row with kind "eod_chain".
  // The payload is the array of ThetaDataEODQuote objects for that date.
  // We only fetch dates that are NOT already in the DB.
  const cacheKeys = dates.map((d) => `eod_chain:${sym}:${d}`);
  let cachedRows: { cacheKey: string; payload: unknown }[] = [];
  try {
    cachedRows = await prisma.marketDataCache.findMany({
      where: { cacheKey: { in: cacheKeys } },
      select: { cacheKey: true, payload: true },
    });
  } catch (err) {
    console.warn("[thetadata] DB cache read failed, will fetch all dates:", err);
  }

  const cachedMap = new Map<string, ThetaDataEODQuote[]>();
  for (const row of cachedRows) {
    const date = row.cacheKey.split(":").slice(2).join(":");
    const quotes = row.payload as ThetaDataEODQuote[];
    if (Array.isArray(quotes)) {
      cachedMap.set(date, quotes);
      cache.set(date, quotes);
    }
  }

  const datesToFetch = dates.filter((d) => !cachedMap.has(d));
  const cachedCount = dates.length - datesToFetch.length;
  if (cachedCount > 0) {
    console.log(`[thetadata] DB cache hit: ${cachedCount}/${dates.length} dates already cached for ${sym}`);
  }

  if (datesToFetch.length === 0) {
    console.log(`[thetadata] All ${dates.length} dates served from DB cache — no ThetaData requests needed.`);
    return cache;
  }

  // --- Phase 2: Fetch missing dates from ThetaData ---
  const base = getBaseUrl();
  const delayMs = Number(process.env.THETADATA_REQ_DELAY_MS ?? 200);
  const concurrency = Math.max(1, Number(process.env.THETADATA_CONCURRENCY ?? 1));
  let consecutiveFailures = 0;
  let done = cachedCount;
  let loggedEmptySample = false;
  const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const SAVE_BATCH = 10;
  let pendingSave: { cacheKey: string; payload: ThetaDataEODQuote[] }[] = [];
  let totalSaved = 0;

  async function flushSave() {
    if (pendingSave.length === 0) return;
    const batch = pendingSave;
    pendingSave = [];
    try {
      await prisma.marketDataCache.createMany({
        data: batch.map((row) => ({
          cacheKey: row.cacheKey,
          kind: "eod_chain",
          symbol: sym,
          payload: row.payload as unknown as import("@prisma/client").Prisma.InputJsonValue,
          expiresAt: farFuture,
        })),
        skipDuplicates: true,
      });
      totalSaved += batch.length;
    } catch (err) {
      console.warn(`[thetadata] DB cache write failed for ${sym} (batch of ${batch.length}):`, err);
    }
  }

  const headers: Record<string, string> = {};
  const apiKey = process.env.THETADATA_API_KEY;
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  async function fetchOneDate(date: string): Promise<void> {
    if (consecutiveFailures >= 3) return;

    const dateParam = formatDate(date);
    const params = new URLSearchParams({
      symbol: sym,
      start_date: dateParam,
      end_date: dateParam,
      expiration: "*",
      strike: "*",
      right: "both",
      format: "json",
    });
    const url = `${base}/option/history/eod?${params.toString()}`;

    try {
      const res = await fetch(url, { headers, cache: "no-store" });
      if (!res.ok) {
        console.warn(`ThetaData fetch failed for ${sym} on ${date}: ${res.status}`);
        cache.set(date, []);
        consecutiveFailures++;
        return;
      }
      consecutiveFailures = 0;

      const text = await res.text();
      let json: ThetaDataEODResponse;
      try {
        json = JSON.parse(text) as ThetaDataEODResponse;
      } catch {
        console.warn(`ThetaData returned non-JSON for ${sym} on ${date} (HTTP ${res.status}): ${text.slice(0, 300)}`);
        cache.set(date, []);
        return;
      }
      const entries = json.response ?? json.data;
      if (!entries || !Array.isArray(entries)) {
        console.warn(`ThetaData unexpected response shape for ${sym} on ${date}: ${text.slice(0, 300)}`);
        cache.set(date, []);
        return;
      }

      const quotes: ThetaDataEODQuote[] = [];
      for (const entry of entries) {
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
          high: eodData.high ?? 0,
          low: eodData.low ?? 0,
          close: eodData.close ?? 0,
          volume: eodData.volume ?? 0,
          openInterest: eodData.open_interest ?? 0,
          underlyingPrice: 0,
        });
      }

      if (quotes.length === 0 && !loggedEmptySample) {
        loggedEmptySample = true;
        console.warn(
          `ThetaData returned zero quotes for ${sym} on ${date}. Raw response (first 300 chars): ${text.slice(0, 300)}`,
        );
      }
      cache.set(date, quotes);
      if (quotes.length > 0) {
        pendingSave.push({ cacheKey: `eod_chain:${sym}:${date}`, payload: quotes });
      }
    } catch (err) {
      console.warn(`ThetaData fetch error for ${sym} on ${date}: ${(err as Error).message}`);
      cache.set(date, []);
      consecutiveFailures++;
    }
  }

  if (concurrency === 1) {
    // Sequential mode (FREE tier) — original behavior with rate-limit delay
    for (const date of datesToFetch) {
      if (consecutiveFailures >= 3) {
        console.warn(
          `[thetadata] Giving up on prefetch after ${consecutiveFailures} consecutive failures — terminal at ${base} is not reachable.`,
        );
        break;
      }

      await fetchOneDate(date);

      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      done++;
      onProgress?.(done, dates.length, cachedCount);
      if (done % 20 === 0 || done === dates.length) {
        console.log(`[thetadata] Prefetch progress: ${done}/${dates.length} (${cachedCount} from cache, ${done - cachedCount} fetched, ${totalSaved} saved to DB)...`);
      }

      if (pendingSave.length >= SAVE_BATCH) {
        await flushSave();
      }
    }
  } else {
    // Concurrent mode (VALUE+ tier) — fire N requests in parallel
    console.log(`[thetadata] Using concurrency=${concurrency} for ${datesToFetch.length} dates`);
    let idx = 0;
    async function worker() {
      while (idx < datesToFetch.length && consecutiveFailures < 3) {
        const date = datesToFetch[idx++]!;
        await fetchOneDate(date);
        done++;
        onProgress?.(done, dates.length, cachedCount);
        if (done % 20 === 0 || done === dates.length) {
          console.log(`[thetadata] Prefetch progress: ${done}/${dates.length} (${cachedCount} from cache, ${done - cachedCount} fetched, ${totalSaved} saved to DB)...`);
        }
        if (pendingSave.length >= SAVE_BATCH) {
          await flushSave();
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }

  if (consecutiveFailures >= 3) {
    console.warn(
      `[thetadata] Giving up on prefetch after ${consecutiveFailures} consecutive failures — terminal at ${base} is not reachable.`,
    );
  }

  // Flush any remaining pending saves
  await flushSave();
  if (totalSaved > 0) {
    console.log(`[thetadata] Saved ${totalSaved} new EOD chains to DB cache for ${sym}`);
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
): { strike: number; bid: number; ask: number; mid: number; delta: number; iv: number; expiration: string } | null {
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
  let best: { strike: number; bid: number; ask: number; mid: number; delta: number; iv: number; expiration: string } | null = null;
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
        expiration: q.expiration,
      };
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Intraday stock OHLC (1-minute candles with extended hours)
// ---------------------------------------------------------------------------

export interface IntradayCandle {
  timestamp: string; // ISO string
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  session: "pre" | "regular" | "post";
}

interface ThetaDataOHLCEntity {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

function classifySession(timestampStr: string): "pre" | "regular" | "post" {
  // ThetaData timestamps are in ET (market time). Parse the time portion.
  // Pre-market: 04:00 - 09:30, Regular: 09:30 - 16:00, Post: 16:00 - 20:00
  const t = new Date(timestampStr);
  const hours = t.getUTCHours() - 5; // Convert UTC to ET (approximate, ignore DST)
  const minutes = t.getUTCMinutes();
  const totalMin = hours * 60 + minutes;

  if (totalMin < 9 * 60 + 30) return "pre";
  if (totalMin < 16 * 60) return "regular";
  return "post";
}

/**
 * Fetch 1-minute intraday OHLC candles for a symbol over a date range.
 *
 * ThetaData limits multi-day requests to 1 month, so this function fetches
 * month by month. Extended hours (04:00-20:00 ET) are included by default.
 *
 * Results are cached in the IntradayPrice DB table. On subsequent calls for
 * the same symbol/date range, cached data is loaded from DB and only missing
 * dates are fetched from ThetaData.
 *
 * @param symbol Stock ticker
 * @param startDate YYYY-MM-DD
 * @param endDate YYYY-MM-DD
 * @param onProgress Optional callback (done, total, cachedCount)
 * @returns Array of IntradayCandle sorted by timestamp
 */
export async function fetchIntradayCandles(
  symbol: string,
  startDate: string,
  endDate: string,
  onProgress?: (done: number, total: number, cachedCount: number) => void,
): Promise<IntradayCandle[]> {
  const sym = symbol.toUpperCase();
  const base = getBaseUrl();
  const interval = "1m";
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");

  // Generate list of months to fetch (ThetaData limits multi-day to 1 month)
  const months: { start: string; end: string }[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) {
    const monthStart = new Date(cursor);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const actualStart = monthStart < start ? start : monthStart;
    const actualEnd = monthEnd > end ? end : monthEnd;
    months.push({
      start: actualStart.toISOString().slice(0, 10).replace(/-/g, ""),
      end: actualEnd.toISOString().slice(0, 10).replace(/-/g, ""),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  // Phase 1: Check DB cache — find which dates we already have
  const cachedDates = new Set<string>();
  try {
    const existing = await prisma.intradayPrice.findMany({
      where: {
        symbol: sym,
        date: { gte: start, lte: end },
        interval,
      },
      select: { date: true },
      distinct: ["date"],
    });
    for (const row of existing) {
      cachedDates.add(row.date.toISOString().slice(0, 10));
    }
  } catch (err) {
    console.warn("[thetadata] Intraday DB cache read failed:", err);
  }

  // Generate all trading dates in range (skip weekends)
  const allDates: string[] = [];
  const d = new Date(start);
  while (d <= end) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) {
      allDates.push(d.toISOString().slice(0, 10));
    }
    d.setDate(d.getDate() + 1);
  }

  const datesToFetch = allDates.filter((dt) => !cachedDates.has(dt));
  const cachedCount = allDates.length - datesToFetch.length;

  if (datesToFetch.length === 0) {
    console.log(`[thetadata] All ${allDates.length} intraday dates served from DB cache for ${sym}`);
    // Load from DB
    const rows = await prisma.intradayPrice.findMany({
      where: { symbol: sym, date: { gte: start, lte: end }, interval },
      orderBy: { timestamp: "asc" },
    });
    return rows.map((r) => ({
      timestamp: r.timestamp.toISOString(),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: r.volume ? Number(r.volume) : 0,
      session: r.session as "pre" | "regular" | "post",
    }));
  }

  console.log(`[thetadata] Intraday cache: ${cachedCount}/${allDates.length} dates cached, fetching ${datesToFetch.length} from ThetaData for ${sym}`);

  // Phase 2: Fetch missing months from ThetaData
  const headers: Record<string, string> = {};
  const apiKey = process.env.THETADATA_API_KEY;
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const delayMs = Number(process.env.THETADATA_REQ_DELAY_MS ?? 200);
  const concurrency = Math.max(1, Number(process.env.THETADATA_CONCURRENCY ?? 1));
  let done = cachedCount;
  let totalSaved = 0;
  const SAVE_BATCH = 500; // Batch size for DB inserts (1 day = ~960 candles)
  let pendingSave: IntradayCandle[] = [];

  async function flushSave() {
    if (pendingSave.length === 0) return;
    const batch = pendingSave;
    pendingSave = [];
    try {
      await prisma.intradayPrice.createMany({
        data: batch.map((c) => ({
          symbol: sym,
          date: new Date(c.timestamp.slice(0, 10) + "T00:00:00"),
          timestamp: new Date(c.timestamp),
          interval,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: BigInt(c.volume),
          session: c.session,
        })),
        skipDuplicates: true,
      });
      totalSaved += batch.length;
    } catch (err) {
      console.warn(`[thetadata] Intraday DB cache write failed (${batch.length} rows):`, err);
    }
  }

  async function fetchMonth(monthStart: string, monthEnd: string): Promise<IntradayCandle[]> {
    const params = new URLSearchParams({
      symbol: sym,
      start_date: monthStart,
      end_date: monthEnd,
      interval,
      start_time: "04:00:00.000",
      end_time: "20:00:00.000",
    });
    const url = `${base}/stock/history/ohlc?${params.toString()}`;

    try {
      const res = await fetch(url, { headers, cache: "no-store" });
      if (!res.ok) {
        console.warn(`ThetaData intraday fetch failed for ${sym} ${monthStart}-${monthEnd}: ${res.status}`);
        return [];
      }
      const text = await res.text();
      let json: { response?: ThetaDataOHLCEntity[]; data?: ThetaDataOHLCEntity[] };
      try {
        json = JSON.parse(text);
      } catch {
        console.warn(`ThetaData intraday non-JSON for ${sym} ${monthStart}-${monthEnd}: ${text.slice(0, 300)}`);
        return [];
      }
      const entries = json.response ?? json.data;
      if (!entries || !Array.isArray(entries)) return [];

      const candles: IntradayCandle[] = [];
      for (const entry of entries) {
        candles.push({
          timestamp: entry.timestamp,
          open: entry.open,
          high: entry.high,
          low: entry.low,
          close: entry.close,
          volume: entry.volume ?? 0,
          session: classifySession(entry.timestamp),
        });
      }
      return candles;
    } catch (err) {
      console.warn(`ThetaData intraday fetch error for ${sym} ${monthStart}-${monthEnd}: ${(err as Error).message}`);
      return [];
    }
  }

  const allCandles: IntradayCandle[] = [];

  // Load any cached candles from DB
  if (cachedCount > 0) {
    try {
      const rows = await prisma.intradayPrice.findMany({
        where: { symbol: sym, date: { gte: start, lte: end }, interval },
        orderBy: { timestamp: "asc" },
      });
      for (const r of rows) {
        allCandles.push({
          timestamp: r.timestamp.toISOString(),
          open: Number(r.open),
          high: Number(r.high),
          low: Number(r.low),
          close: Number(r.close),
          volume: r.volume ? Number(r.volume) : 0,
          session: r.session as "pre" | "regular" | "post",
        });
      }
    } catch (err) {
      console.warn("[thetadata] Failed to load cached intraday data:", err);
    }
  }

  // Fetch missing months
  // Only fetch months that contain dates we need
  const monthsToFetch = months.filter((m) => {
    const mStart = m.start.slice(0, 4) + "-" + m.start.slice(4, 6) + "-" + m.start.slice(6, 8);
    const mEnd = m.end.slice(0, 4) + "-" + m.end.slice(4, 6) + "-" + m.end.slice(6, 8);
    return datesToFetch.some((dt) => dt >= mStart && dt <= mEnd);
  });

  if (concurrency === 1) {
    for (const month of monthsToFetch) {
      const candles = await fetchMonth(month.start, month.end);
      allCandles.push(...candles);
      pendingSave.push(...candles);

      // Estimate progress by counting dates in this month
      const monthDates = datesToFetch.filter((dt) => {
        const mStart = month.start.slice(0, 4) + "-" + month.start.slice(4, 6) + "-" + month.start.slice(6, 8);
        const mEnd = month.end.slice(0, 4) + "-" + month.end.slice(4, 6) + "-" + month.end.slice(6, 8);
        return dt >= mStart && dt <= mEnd;
      });
      done += monthDates.length;
      onProgress?.(done, allDates.length, cachedCount);

      if (pendingSave.length >= SAVE_BATCH) {
        await flushSave();
      }

      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  } else {
    let idx = 0;
    async function worker() {
      while (idx < monthsToFetch.length) {
        const month = monthsToFetch[idx++]!;
        const candles = await fetchMonth(month.start, month.end);
        allCandles.push(...candles);
        pendingSave.push(...candles);

        const monthDates = datesToFetch.filter((dt) => {
          const mStart = month.start.slice(0, 4) + "-" + month.start.slice(4, 6) + "-" + month.start.slice(6, 8);
          const mEnd = month.end.slice(0, 4) + "-" + month.end.slice(4, 6) + "-" + month.end.slice(6, 8);
          return dt >= mStart && dt <= mEnd;
        });
        done += monthDates.length;
        onProgress?.(done, allDates.length, cachedCount);

        if (pendingSave.length >= SAVE_BATCH) {
          await flushSave();
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }

  // Flush remaining
  await flushSave();
  if (totalSaved > 0) {
    console.log(`[thetadata] Saved ${totalSaved} intraday candles to DB cache for ${sym}`);
  }

  // Sort all candles by timestamp
  allCandles.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return allCandles;
}
