import { NextResponse } from "next/server";
import { getHistoricalPrices, getOptionChain, getExpirations } from "@/features/market-data/service";
import { computeIVAnalytics } from "@/lib/calculations/iv-analytics";
import { MarketDataError } from "@/features/market-data/provider";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase().trim();
  const { searchParams } = new URL(req.url);
  const expiration = searchParams.get("expiration");
  try {
    const expirations = await getExpirations({ symbol });
    const exp = expiration ?? expirations.data[0]?.expirationDate;
    if (!exp) return NextResponse.json({ error: "No expirations available" }, { status: 404 });
    const [chain, hist] = await Promise.all([
      getOptionChain({ symbol, expiration: exp }),
      getHistoricalPrices({ symbol, range: "5y" }).catch(() => ({ data: { points: [] }, fromCache: false, dataQuality: "unknown" as const, fetchedAt: "" })),
    ]);
    const analytics = computeIVAnalytics(chain.data, hist.data.points);
    return NextResponse.json({
      ...analytics,
      ivHistory: analytics.ivHistory.slice(-252),
    });
  } catch (e) {
    const code = e instanceof MarketDataError ? e.code : "PROVIDER_UNAVAILABLE";
    return NextResponse.json({ error: (e as Error).message, code }, { status: code === "NOT_FOUND" ? 404 : 502 });
  }
}
