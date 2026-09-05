import { NextResponse } from "next/server";
import { loadOptionChain } from "@/features/options/stock-data";
import { getCorporateEvents } from "@/features/market-data/service";
import { MarketDataError } from "@/features/market-data/provider";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { symbol: string } },
) {
  const symbol = params.symbol.toUpperCase().trim();
  const { searchParams } = new URL(_req.url);
  const expiration = searchParams.get("expiration");
  if (!expiration) {
    return NextResponse.json({ error: "expiration query param required" }, { status: 400 });
  }
  try {
    const [chainRes, eventsRes] = await Promise.all([
      loadOptionChain(symbol, expiration),
      getCorporateEvents({ symbol }).catch(() => null),
    ]);
    return NextResponse.json({
      chain: chainRes.data,
      events: eventsRes?.data ?? null,
      fetchedAt: chainRes.fetchedAt,
      fromCache: chainRes.fromCache,
      dataQuality: chainRes.dataQuality,
    });
  } catch (e) {
    const code = e instanceof MarketDataError ? e.code : "PROVIDER_UNAVAILABLE";
    return NextResponse.json({ error: (e as Error).message, code }, { status: code === "NOT_FOUND" ? 404 : 502 });
  }
}
