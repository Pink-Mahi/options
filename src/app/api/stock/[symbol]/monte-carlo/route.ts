import { NextResponse } from "next/server";
import { getHistoricalPrices, getQuote } from "@/features/market-data/service";
import { runMonteCarlo } from "@/lib/calculations/monte-carlo";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase().trim();
  const body = await req.json().catch(() => ({}));
  const paths = Math.min(2000, Math.max(50, Number(body.paths ?? 500)));
  const horizonDays = Math.min(756, Math.max(30, Number(body.horizonDays ?? 252)));
  const periodDte = Math.min(180, Math.max(7, Number(body.periodDte ?? 30)));
  const strikeOtmPercent = Math.min(0.5, Math.max(0, Number(body.strikeOtmPercent ?? 0.05)));
  const premiumYieldPerPeriod = Math.min(0.2, Math.max(0, Number(body.premiumYieldPerPeriod ?? 0.01)));
  const seed = Number(body.seed ?? 42);

  try {
    const [hist, quote] = await Promise.all([
      getHistoricalPrices({ symbol, range: "5y" }),
      getQuote({ symbol }),
    ]);
    const result = runMonteCarlo(hist.data.points, {
      paths,
      horizonDays,
      periodDte,
      strikeOtmPercent,
      premiumYieldPerPeriod,
      initialPrice: quote.data.price,
      seed,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
