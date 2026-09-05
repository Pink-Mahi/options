/**
 * Multi-leg strategy analysis API.
 *
 * Accepts an arbitrary set of legs and returns the classified structure with
 * net premium, max profit/loss, breakevens, Greeks, margin, and payoff curve.
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { analyzeMultiLegStrategy, type LegAction, type StrategyLeg } from "@/lib/calculations/multi-leg";
import type { OptionType } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const underlyingPrice = Number(body.underlyingPrice);
    if (!Number.isFinite(underlyingPrice) || underlyingPrice <= 0) {
      return NextResponse.json({ error: "underlyingPrice must be a positive number" }, { status: 400 });
    }

    const rawLegs = Array.isArray(body.legs) ? body.legs : [];
    const legs: StrategyLeg[] = [];
    for (const raw of rawLegs) {
      const strike = Number(raw.strike);
      const pricePerShare = Number(raw.pricePerShare);
      if (!Number.isFinite(strike) || !Number.isFinite(pricePerShare)) continue;
      legs.push({
        action: (String(raw.action).toUpperCase() === "SELL" ? "SELL" : "BUY") as LegAction,
        optionType: (String(raw.optionType).toUpperCase() === "PUT" ? "PUT" : "CALL") as OptionType,
        strike,
        pricePerShare,
        contracts: Number(raw.contracts) > 0 ? Number(raw.contracts) : 1,
        daysToExpiration: Number(raw.daysToExpiration) > 0 ? Number(raw.daysToExpiration) : 30,
        expiration: String(raw.expiration ?? ""),
      });
    }

    if (legs.length === 0) {
      return NextResponse.json(
        { error: "At least one valid leg is required (strike and pricePerShare must be numbers)" },
        { status: 400 },
      );
    }

    const result = analyzeMultiLegStrategy(legs, underlyingPrice);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
