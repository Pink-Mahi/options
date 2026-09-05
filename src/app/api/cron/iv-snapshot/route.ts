/**
 * Cron endpoint for nightly IV snapshot capture.
 *
 * Set CRON_SECRET to protect. Configure to run once per day after market close:
 *   curl -X POST https://your-domain.com/api/cron/iv-snapshot -H "x-cron-secret: <CRON_SECRET>"
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/database/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers.get("x-cron-secret");
    if (authHeader !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    // Get all unique symbols from watchlists and portfolio holdings
    const [watchlistSymbols, holdingSymbols] = await Promise.all([
      prisma.watchlist.findMany({ select: { symbol: true }, distinct: ["symbol"] }),
      prisma.stockLot.findMany({ select: { symbol: true }, distinct: ["symbol"] }),
    ]);

    const symbols = new Set<string>();
    for (const w of watchlistSymbols) symbols.add(w.symbol);
    for (const h of holdingSymbols) symbols.add(h.symbol);

    // Also snapshot SPY and VIX-related ETFs for market regime
    symbols.add("SPY");
    symbols.add("QQQ");

    const { getQuote, getExpirations, getOptionChain, getHistoricalPrices } = await import(
      "@/features/market-data/service"
    );
    const { captureIvSnapshot } = await import("@/features/options/iv-snapshot-service");

    const results: { symbol: string; status: string }[] = [];

    for (const symbol of symbols) {
      try {
        const quote = await getQuote({ symbol });
        const expirations = await getExpirations({ symbol });
        const firstExp = expirations.data[0];
        if (!firstExp) {
          results.push({ symbol, status: "no_expirations" });
          continue;
        }
        const chain = await getOptionChain({ symbol, expiration: firstExp.expirationDate });
        const hist = await getHistoricalPrices({ symbol, range: "1y" });
        await captureIvSnapshot(symbol, chain.data, hist.data.points);
        results.push({ symbol, status: "captured" });
      } catch (err) {
        results.push({ symbol, status: `error: ${(err as Error).message}` });
      }
    }

    return NextResponse.json({
      ok: true,
      symbolsAttempted: symbols.size,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}
