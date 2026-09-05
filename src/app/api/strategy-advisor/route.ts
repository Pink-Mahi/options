/**
 * Strategy Advisor API — "Should I buy this house and rent it out?"
 *
 * Fetches historical prices, option chains, and technical indicators,
 * then runs the deterministic strategy advisor to produce a plain-English
 * recommendation for long-term buy-and-hold + covered call income.
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getHistoricalPrices, getQuote, getExpirations, getOptionChain } from "@/features/market-data/service";
import { computeAllIndicators } from "@/lib/calculations/indicators";
import { runStrategyAdvisor } from "@/lib/calculations/strategy-advisor";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const symbol = String(body.symbol ?? "").toUpperCase().trim();
    if (!symbol) return NextResponse.json({ error: "symbol is required" }, { status: 400 });

    const contracts = Number(body.contracts) > 0 ? Number(body.contracts) : 1;

    // Fetch historical prices (5y for quality scoring + technicals)
    const [hist, quoteRes, expRes] = await Promise.all([
      getHistoricalPrices({ symbol, range: "5y" }),
      getQuote({ symbol }),
      getExpirations({ symbol }),
    ]);

    const currentPrice = quoteRes.data.price;
    const points = hist.data.points;

    if (points.length < 60) {
      return NextResponse.json({
        error: `Not enough historical data for ${symbol} (only ${points.length} bars). Need at least 60.`,
      }, { status: 400 });
    }

    // Compute technical indicators
    const indicators = computeAllIndicators(points, symbol);
    const technicalBias = indicators.summary.overallBias;
    const technicalScore = indicators.signalScore.score;

    // Fetch option chains for nearest 4 expirations (covering ~30/45/60/90 DTE)
    const expirations = expRes.data ?? [];
    const targetDTEs = [30, 45, 60, 90, 180];
    const selectedExpirations: string[] = [];

    for (const targetDTE of targetDTEs) {
      let closest: typeof expirations[number] | null = null;
      for (const exp of expirations) {
        if (selectedExpirations.includes(exp.expirationDate)) continue;
        if (closest == null || Math.abs(exp.daysToExpiration - targetDTE) < Math.abs(closest.daysToExpiration - targetDTE)) {
          closest = exp;
        }
      }
      if (closest) selectedExpirations.push(closest.expirationDate);
    }

    // Fetch chains in parallel
    const chainResults = await Promise.all(
      selectedExpirations.map(exp => getOptionChain({ symbol, expiration: exp }).catch(() => null)),
    );

    const chains = chainResults
      .filter((c): c is NonNullable<typeof c> => c != null)
      .map(c => c.data);

    const result = runStrategyAdvisor(
      symbol,
      currentPrice,
      points,
      chains,
      technicalBias,
      technicalScore,
      contracts,
    );

    return NextResponse.json({
      ...result,
      dataSource: hist.provider,
      dataRange: hist.data.range,
      barsAnalyzed: points.length,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
