/**
 * IV snapshot service — captures and retrieves real IV history.
 *
 * The snapshot job runs nightly (via API route or cron) and stores ATM IV
 * for each tracked symbol. Over time this builds a genuine IV history that
 * replaces the realized-vol approximation in iv-analytics.ts.
 */

import { prisma } from "@/lib/database/prisma";
import { computeIVAnalytics } from "@/lib/calculations/iv-analytics";
import type { OptionChain, HistoricalPricePoint } from "@/lib/types";

export interface IvSnapshotData {
  symbol: string;
  atmIv: number;
  iv30: number | null;
  iv60: number | null;
  iv90: number | null;
  hv30: number | null;
  spot: number;
}

/**
 * Capture an IV snapshot for a symbol. Called by the nightly job.
 */
export async function captureIvSnapshot(
  symbol: string,
  chain: OptionChain,
  historical: HistoricalPricePoint[],
): Promise<void> {
  const analytics = computeIVAnalytics(chain, historical);
  const atmIv = analytics.currentAtmIv;
  if (atmIv == null) return;

  // Compute term structure IVs from different expirations if available
  const iv30 = findIvByDte(chain, 30);
  const iv60 = findIvByDte(chain, 60);
  const iv90 = findIvByDte(chain, 90);

  // 30-day realized vol from historical
  const hv30 = computeRealizedVol(historical, 30);

  // Truncate to UTC midnight. The @@unique([symbol, date]) constraint is on a
  // DateTime column, so a timestamp with a time component would never match an
  // existing row and the upsert would insert a duplicate on every run.
  const day = startOfUtcDay(new Date());

  await prisma.ivSnapshot.upsert({
    where: {
      symbol_date: {
        symbol,
        date: day,
      },
    },
    create: {
      symbol,
      date: day,
      atmIv,
      iv30,
      iv60,
      iv90,
      hv30,
      spot: chain.underlyingPrice,
    },
    update: {
      atmIv,
      iv30,
      iv60,
      iv90,
      hv30,
      spot: chain.underlyingPrice,
    },
  });
}

/**
 * Retrieve IV history for a symbol from the database.
 */
export async function getIvHistory(
  symbol: string,
  lookbackDays: number = 252,
): Promise<{ date: string; atmIv: number; hv30: number | null; spot: number }[]> {
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);

  const snapshots = await prisma.ivSnapshot.findMany({
    where: {
      symbol,
      date: { gte: since },
    },
    orderBy: { date: "asc" },
  });

  return snapshots.map((s) => ({
    date: s.date.toISOString().slice(0, 10),
    atmIv: Number(s.atmIv),
    hv30: s.hv30 ? Number(s.hv30) : null,
    spot: Number(s.spot),
  }));
}

/**
 * Compute genuine IV percentile and rank from persisted snapshots.
 * Falls back to the approximation in iv-analytics.ts if insufficient data.
 */
export async function computeRealIVRank(symbol: string): Promise<{
  ivPercentile: number | null;
  ivRank: number | null;
  currentIv: number | null;
  dataPoints: number;
  usingApproximation: boolean;
}> {
  const history = await getIvHistory(symbol, 252);

  if (history.length < 20) {
    return {
      ivPercentile: null,
      ivRank: null,
      currentIv: null,
      dataPoints: history.length,
      usingApproximation: true,
    };
  }

  const currentIv = history[history.length - 1]?.atmIv ?? null;
  if (currentIv == null) {
    return { ivPercentile: null, ivRank: null, currentIv: null, dataPoints: history.length, usingApproximation: true };
  }

  const ivs = history.map((h) => h.atmIv);
  const below = ivs.filter((iv) => iv < currentIv).length;
  const ivPercentile = below / ivs.length;

  const high = Math.max(...ivs);
  const low = Math.min(...ivs);
  const ivRank = high === low ? 0.5 : (currentIv - low) / (high - low);

  return {
    ivPercentile,
    ivRank,
    currentIv,
    dataPoints: history.length,
    usingApproximation: false,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findIvByDte(chain: OptionChain, targetDte: number): number | null {
  const all = [...chain.calls, ...chain.puts];
  if (all.length === 0) return null;

  // Find contracts closest to the target DTE
  let best = all[0];
  let bestDiff = Infinity;
  for (const c of all) {
    const diff = Math.abs(c.daysToExpiration - targetDte);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = c;
    }
  }

  // Only use if within 50% of target DTE
  if (best && best.daysToExpiration > targetDte * 1.5) return null;
  return best?.impliedVolatility ?? null;
}

/** Normalize a timestamp to UTC midnight so one snapshot maps to one calendar day. */
function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function computeRealizedVol(prices: HistoricalPricePoint[], window: number): number | null {
  if (prices.length < window + 1) return null;
  const slice = prices.slice(-window - 1);
  const logReturns: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    const prev = slice[i - 1];
    const curr = slice[i];
    if (!prev || !curr) continue;
    const r = Math.log(curr.adjustedClose / prev.adjustedClose);
    if (Number.isFinite(r)) logReturns.push(r);
  }
  if (logReturns.length < 2) return null;
  const mean = logReturns.reduce((s, r) => s + r, 0) / logReturns.length;
  const variance = logReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (logReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}
