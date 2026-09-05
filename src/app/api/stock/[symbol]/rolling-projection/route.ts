import { NextResponse } from "next/server";
import { getHistoricalPrices } from "@/features/market-data/service";
import { projectRollingIncome } from "@/lib/calculations/rolling-projection";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase().trim();
  const body = await req.json().catch(() => ({}));
  const periodDte = Math.min(180, Math.max(7, Number(body.periodDte ?? 30)));
  const strikeOtmPercent = Math.min(0.5, Math.max(0, Number(body.strikeOtmPercent ?? 0.05)));
  const premiumYieldPerPeriod = Math.min(0.2, Math.max(0, Number(body.premiumYieldPerPeriod ?? 0.01)));
  const periodsPerYear = Math.round(365 / periodDte);

  try {
    const hist = await getHistoricalPrices({ symbol, range: "5y" });
    const result = projectRollingIncome(hist.data.points, {
      periodDte,
      strikeOtmPercent,
      premiumYieldPerPeriod,
      periodsPerYear,
    });
    if (!result) return NextResponse.json({ error: "Insufficient history" }, { status: 422 });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
