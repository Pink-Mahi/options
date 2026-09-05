import { NextResponse } from "next/server";
import { analyzeEarnings } from "@/features/options/earnings-analyzer";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase().trim();
  try {
    const analysis = await analyzeEarnings(symbol);
    return NextResponse.json(analysis);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
