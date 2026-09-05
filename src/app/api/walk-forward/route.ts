/**
 * Walk-forward validation API — runs out-of-sample signal validation
 * with Deflated Sharpe Ratio overfitting correction.
 *
 * The signal engine extracts point-in-time factors (momentum, trend, mean
 * reversion, volatility), sweeps candidate weight vectors on each training
 * fold, selects the best on train only, and applies it to the test fold.
 * The stitched OOS returns are the honest track record.
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getHistoricalPrices } from "@/features/market-data/service";
import { runWalkForward, DEFAULT_WALK_FORWARD_CONFIG } from "@/lib/quant/walk-forward";

export const dynamic = "force-dynamic";

const ALLOWED_RANGES = ["3y", "5y", "10y", "max"] as const;
type HistRange = (typeof ALLOWED_RANGES)[number];

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const symbol = String(body.symbol ?? "").toUpperCase().trim();
    if (!symbol) return NextResponse.json({ error: "symbol is required" }, { status: 400 });

    const requestedRange = String(body.range ?? "10y").toLowerCase();
    const range: HistRange = (ALLOWED_RANGES as readonly string[]).includes(requestedRange)
      ? (requestedRange as HistRange)
      : "10y";

    const hist = await getHistoricalPrices({ symbol, range });

    if (hist.data.points.length < 300) {
      return NextResponse.json({
        error: `Only ${hist.data.points.length} historical bars available. Walk-forward validation needs at least 300 (ideally 1000+) for meaningful fold sizes after the 252-bar feature warm-up.`,
      }, { status: 400 });
    }

    const config = {
      ...DEFAULT_WALK_FORWARD_CONFIG,
      folds: Math.min(Math.max(Number(body.folds) || 4, 2), 8),
      costBps: Number(body.costBps) >= 0 ? Number(body.costBps) : DEFAULT_WALK_FORWARD_CONFIG.costBps,
      signalThreshold: Number(body.signalThreshold) > 0 ? Number(body.signalThreshold) : DEFAULT_WALK_FORWARD_CONFIG.signalThreshold,
    };

    const result = runWalkForward(hist.data.points, symbol, config);

    return NextResponse.json({
      ...result,
      dataSource: hist.provider,
      dataRange: `${hist.data.points[0]?.date} to ${hist.data.points[hist.data.points.length - 1]?.date}`,
      barsAnalyzed: hist.data.points.length,
      modelCaveat:
        "Signal weights are selected on training folds and frozen for out-of-sample testing. " +
        "The Deflated Sharpe Ratio corrects for the number of candidate strategies searched. " +
        "Past performance does not predict future results — these factors are well-known and heavily arbitraged.",
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
