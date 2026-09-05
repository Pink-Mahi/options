import { NextResponse } from "next/server";
import { getHistoricalPrices } from "@/features/market-data/service";
import { computeAllIndicators } from "@/lib/calculations/indicators";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase().trim();
  try {
    const hist = await getHistoricalPrices({ symbol, range: "1y" });
    const indicators = computeAllIndicators(hist.data.points, symbol);
    return NextResponse.json(indicators);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
