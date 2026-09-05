import { NextResponse } from "next/server";
import { comparePeers } from "@/features/options/peer-comparison";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase().trim();
  try {
    const comparison = await comparePeers(symbol);
    return NextResponse.json(comparison);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
