import { NextResponse } from "next/server";
import { getHistoricalPrices } from "@/features/market-data/service";
import { calculateRiskAdjustedReturns } from "@/lib/calculations/historical";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase().trim();
  const { searchParams } = new URL(req.url);
  const riskFreeRate = Number(searchParams.get("riskFreeRate") ?? 0.045);

  try {
    const hist = await getHistoricalPrices({ symbol, range: "5y" });
    const result = calculateRiskAdjustedReturns(hist.data.points, riskFreeRate);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
