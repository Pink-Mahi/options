import { NextResponse } from "next/server";
import { prisma } from "@/lib/database/prisma";
import type { ThetaDataEODQuote } from "@/features/market-data/thetadata";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Fetch option price history from cached EOD chains.
 *
 * Queries the MarketDataCache for eod_chain entries in the given date range,
 * then filters each day's chain for the specific contract (strike + expiration + right).
 * Returns a time series of bid/ask/mid/close/volume for that contract.
 *
 * Also returns the underlying stock close for each date (from the EOD quote's
 * underlyingPrice field, or inferred from the chain if available).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const symbol = String(body.symbol ?? "").toUpperCase();
    const strike = Number(body.strike);
    const expiration = String(body.expiration ?? ""); // YYYY-MM-DD
    const right = String(body.right ?? "CALL").toUpperCase() === "PUT" ? "PUT" : "CALL";
    const startDate = String(body.startDate ?? "");
    const endDate = String(body.endDate ?? "");

    if (!symbol || !strike || !expiration || !startDate || !endDate) {
      return NextResponse.json(
        { error: "symbol, strike, expiration, startDate, endDate are required" },
        { status: 400 },
      );
    }

    // Generate cache keys for the date range (weekdays only)
    const start = new Date(startDate + "T00:00:00");
    const end = new Date(endDate + "T00:00:00");
    const cacheKeys: string[] = [];
    const dates: string[] = [];
    const d = new Date(start);
    while (d <= end) {
      const day = d.getDay();
      if (day !== 0 && day !== 6) {
        const dateStr = d.toISOString().slice(0, 10);
        dates.push(dateStr);
        cacheKeys.push(`eod_chain:${symbol}:${dateStr}`);
      }
      d.setDate(d.getDate() + 1);
    }

    // Query cached EOD chains
    const rows = await prisma.marketDataCache.findMany({
      where: { cacheKey: { in: cacheKeys } },
      select: { cacheKey: true, payload: true },
    });

    const series: {
      date: string;
      bid: number;
      ask: number;
      mid: number;
      close: number;
      volume: number;
      openInterest: number;
      underlyingPrice: number;
    }[] = [];

    for (const row of rows) {
      const date = row.cacheKey.split(":").slice(2).join(":");
      const quotes = row.payload as unknown as ThetaDataEODQuote[];
      if (!Array.isArray(quotes)) continue;

      const match = quotes.find(
        (q) =>
          q.strike === strike &&
          q.expiration === expiration &&
          q.right === right,
      );

      if (match) {
        series.push({
          date,
          bid: match.bid,
          ask: match.ask,
          mid: match.mid,
          close: match.close,
          volume: match.volume,
          openInterest: match.openInterest,
          underlyingPrice: match.underlyingPrice,
        });
      }
    }

    series.sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      symbol,
      strike,
      expiration,
      right,
      dataPoints: series.length,
      totalDatesChecked: dates.length,
      series,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
