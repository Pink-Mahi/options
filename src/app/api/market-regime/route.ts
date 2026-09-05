/**
 * Market regime API — VIX + SPY trend classification with strategy implications.
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getMarketRegimeSnapshot } from "@/features/market-data/regime-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const snapshot = await getMarketRegimeSnapshot();
    return NextResponse.json(snapshot);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
