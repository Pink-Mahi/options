import { NextResponse } from "next/server";
import { getQuote } from "@/features/market-data/service";
import { MarketDataError } from "@/features/market-data/provider";

export const dynamic = "force-dynamic";

/**
 * Lightweight quote endpoint for live price polling.
 * Returns just the Quote object — the heavy stock-data payload is loaded once
 * on the server; this endpoint refreshes the price fields client-side.
 * Server-side TTL cache (15s for quotes) bounds upstream API calls.
 */
export async function GET(
  _req: Request,
  { params }: { params: { symbol: string } },
) {
  const symbol = params.symbol.toUpperCase().trim();
  if (!symbol) {
    return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  }
  try {
    const res = await getQuote({ symbol });
    return NextResponse.json(
      {
        quote: res.data,
        fetchedAt: res.fetchedAt,
        fromCache: res.fromCache,
        dataQuality: res.dataQuality,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const code = e instanceof MarketDataError ? e.code : "PROVIDER_UNAVAILABLE";
    return NextResponse.json(
      { error: (e as Error).message, code },
      { status: code === "NOT_FOUND" ? 404 : 502 },
    );
  }
}
