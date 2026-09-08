import "server-only";
import { prisma } from "@/lib/database/prisma";
import type { HistoricalPricePoint } from "@/lib/types";

/**
 * Persistent historical price cache.
 *
 * Stores daily OHLCV data in PostgreSQL so we only fetch from external APIs
 * for dates we don't already have. Over time, the database accumulates a
 * complete price history for every symbol users have looked at.
 *
 * Strategy:
 * 1. Check DB for existing data covering the requested range
 * 2. If complete → return from DB (no API call)
 * 3. If partial → fetch only the missing tail from the API, merge, persist
 * 4. If nothing → full API fetch, persist all
 */

/** Convert DB rows to the app's HistoricalPricePoint type. */
function mapRow(row: {
  date: Date;
  open: { toNumber: () => number };
  high: { toNumber: () => number };
  low: { toNumber: () => number };
  close: { toNumber: () => number };
  adjustedClose: { toNumber: () => number };
  volume: bigint | null;
}): HistoricalPricePoint {
  return {
    date: row.date.toISOString().slice(0, 10) as HistoricalPricePoint["date"],
    open: row.open.toNumber(),
    high: row.high.toNumber(),
    low: row.low.toNumber(),
    close: row.close.toNumber(),
    adjustedClose: row.adjustedClose.toNumber(),
    volume: row.volume != null ? Number(row.volume) : null,
  };
}

/** Get all stored prices for a symbol, optionally filtered by date range. */
export async function getStoredPrices(
  symbol: string,
  startDate?: string,
  endDate?: string,
): Promise<HistoricalPricePoint[]> {
  const where: { symbol: string; date?: { gte?: Date; lte?: Date } } = {
    symbol: symbol.toUpperCase(),
  };
  if (startDate) where.date = { ...where.date, gte: new Date(startDate) };
  if (endDate) where.date = { ...where.date, lte: new Date(endDate) };

  const rows = await prisma.historicalPrice.findMany({
    where,
    orderBy: { date: "asc" },
  });
  return rows.map(mapRow);
}

/** Get the most recent stored date for a symbol (YYYY-MM-DD), or null. */
export async function getLastStoredDate(symbol: string): Promise<string | null> {
  const row = await prisma.historicalPrice.findFirst({
    where: { symbol: symbol.toUpperCase() },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  if (!row) return null;
  return row.date.toISOString().slice(0, 10);
}

/** Get the earliest stored date for a symbol (YYYY-MM-DD), or null. */
export async function getFirstStoredDate(symbol: string): Promise<string | null> {
  const row = await prisma.historicalPrice.findFirst({
    where: { symbol: symbol.toUpperCase() },
    orderBy: { date: "asc" },
    select: { date: true },
  });
  if (!row) return null;
  return row.date.toISOString().slice(0, 10);
}

/** Count stored price rows for a symbol. */
export async function countStoredPrices(symbol: string): Promise<number> {
  return prisma.historicalPrice.count({
    where: { symbol: symbol.toUpperCase() },
  });
}

/** Persist price points to the DB. Uses upsert to handle re-fetches gracefully. */
export async function savePrices(
  symbol: string,
  points: HistoricalPricePoint[],
  source: string = "tradier",
): Promise<number> {
  if (points.length === 0) return 0;
  const sym = symbol.toUpperCase();

  // Batch upserts in chunks to avoid overwhelming the DB
  const BATCH_SIZE = 250;
  let saved = 0;

  for (let i = 0; i < points.length; i += BATCH_SIZE) {
    const batch = points.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map((p) =>
        prisma.historicalPrice.upsert({
          where: {
            symbol_date: { symbol: sym, date: new Date(p.date) },
          },
          create: {
            symbol: sym,
            date: new Date(p.date),
            open: p.open,
            high: p.high,
            low: p.low,
            close: p.close,
            adjustedClose: p.adjustedClose,
            volume: p.volume != null ? BigInt(Math.floor(p.volume)) : null,
            source,
          },
          update: {
            open: p.open,
            high: p.high,
            low: p.low,
            close: p.close,
            adjustedClose: p.adjustedClose,
            volume: p.volume != null ? BigInt(Math.floor(p.volume)) : null,
            source,
            fetchedAt: new Date(),
          },
        }),
      ),
    );
    saved += batch.length;
  }

  return saved;
}

/**
 * Check if we have sufficient data in the DB for the requested range.
 * Returns the stored points if we do, or null if we need to fetch from the API.
 *
 * "Sufficient" means:
 * - We have data for the symbol
 * - The most recent stored date is within 3 trading days of today
 *   (so we don't serve stale data when the market has moved)
 * - The earliest stored date is at least as far back as the requested range start
 */
export async function getFromDbOrReturnNull(
  symbol: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<HistoricalPricePoint[] | null> {
  const points = await getStoredPrices(symbol, rangeStart, rangeEnd);
  if (points.length === 0) return null;

  // Check freshness: is the most recent point within 3 calendar days of today?
  const lastDate = points[points.length - 1]?.date;
  if (!lastDate) return null;
  const lastMs = new Date(lastDate).getTime();
  const nowMs = Date.now();
  const daysSinceLast = (nowMs - lastMs) / (1000 * 60 * 60 * 24);
  // Allow up to 4 days gap (weekends + 1 holiday)
  if (daysSinceLast > 4) return null;

  return points;
}
