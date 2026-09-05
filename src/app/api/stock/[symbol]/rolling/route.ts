import { NextResponse } from "next/server";
import { loadRollingDistribution } from "@/features/options/stock-data";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase().trim();
  const { searchParams } = new URL(req.url);
  const window = Number(searchParams.get("window") ?? "45");
  const threshold = Number(searchParams.get("threshold") ?? "0.15");
  if (!Number.isFinite(window) || !Number.isFinite(threshold)) {
    return NextResponse.json({ error: "window and threshold must be numbers" }, { status: 400 });
  }
  const dist = await loadRollingDistribution(symbol, window, threshold);
  if (!dist) return NextResponse.json({ error: "Insufficient history" }, { status: 404 });
  return NextResponse.json({
    sampleSize: dist.sampleSize,
    median: dist.median,
    mean: dist.mean,
    stdDev: dist.stdDev,
    p10: dist.p10,
    p25: dist.p25,
    p50: dist.p50,
    p75: dist.p75,
    p90: dist.p90,
    percentExceeding: dist.percentExceedingThreshold,
    percentDeclining: dist.percentDecliningBelowBreakEven,
  });
}
