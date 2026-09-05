/**
 * Portfolio risk API — beta-weighted delta & concentration risk.
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getPortfolio } from "@/lib/database/portfolio-repo";
import { getQuote } from "@/features/market-data/service";
import { computeBetaWeightedDelta, type PositionDelta } from "@/lib/calculations/beta-risk";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const portfolio = await getPortfolio(user.id);
    const warnings: string[] = [];

    const bySymbol = new Map<string, number>();
    for (const lot of portfolio.stockLots) {
      bySymbol.set(lot.symbol, (bySymbol.get(lot.symbol) ?? 0) + lot.shares);
    }

    if (bySymbol.size === 0) {
      return NextResponse.json({
        totalMarketValue: 0,
        netDelta: 0,
        betaWeightedDelta: 0,
        spyEquivalentExposure: 0,
        directionalBias: "neutral",
        concentration: {
          riskLevel: "diversified",
          largestPosition: 0,
          top3: 0,
          herfindahlIndex: 0,
          warnings: [],
        },
        positions: [],
        warnings: ["Portfolio has no stock holdings, so there is no directional or concentration exposure to measure."],
      });
    }

    warnings.push(
      "Beta is not supplied by the market-data provider, so every holding is beta-weighted at 1.0. Beta-weighted delta therefore equals raw delta and understates high-beta names.",
    );

    let spyPrice = 500;
    try {
      const spy = await getQuote({ symbol: "SPY" });
      spyPrice = spy.data.price;
    } catch {
      warnings.push("Could not fetch SPY; used a $500 placeholder for SPY-equivalent dollar exposure.");
    }

    const positions: PositionDelta[] = [];
    for (const [symbol, shares] of bySymbol) {
      try {
        const q = await getQuote({ symbol });
        positions.push({
          symbol,
          delta: shares,
          marketValue: shares * q.data.price,
          beta: 1.0,
        });
      } catch {
        warnings.push(`Could not fetch a quote for ${symbol}; it was excluded.`);
      }
    }

    const r = computeBetaWeightedDelta(positions, spyPrice);

    return NextResponse.json({
      totalMarketValue: Math.round(r.totalMarketValue * 100) / 100,
      netDelta: Math.round(r.netDelta * 100) / 100,
      betaWeightedDelta: Math.round(r.totalBetaWeightedDelta * 100) / 100,
      spyEquivalentExposure: Math.round(r.spyEquivalentExposure * 100) / 100,
      directionalBias: r.directionalBias,
      concentration: {
        riskLevel: r.concentrationRisk.riskLevel,
        largestPosition: Math.round(r.concentrationRisk.maxSinglePosition * 10000) / 100,
        top3: Math.round(r.concentrationRisk.top3Concentration * 10000) / 100,
        herfindahlIndex: Math.round(r.concentrationRisk.herfindahlIndex * 10000) / 10000,
        warnings: r.concentrationRisk.warnings,
      },
      positions: r.weightedDeltaBySymbol.map((w) => ({
        symbol: w.symbol,
        marketValue: Math.round(w.marketValue * 100) / 100,
        percentOfPortfolio: Math.round(w.percentOfPortfolio * 10000) / 100,
        betaWeightedDelta: Math.round(w.betaWeightedDelta * 100) / 100,
      })),
      warnings,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
