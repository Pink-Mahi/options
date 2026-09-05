/**
 * Backtest API — runs a repeating options income strategy over historical prices.
 *
 * Premiums are MODELED with Black-Scholes from trailing realized volatility,
 * not historical option quotes. The response always carries that caveat.
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getHistoricalPrices, getQuote } from "@/features/market-data/service";
import { runBacktest, type BacktestStrategy } from "@/lib/calculations/backtester";

export const dynamic = "force-dynamic";

const ALLOWED_STRATEGIES: BacktestStrategy[] = ["COVERED_CALL", "CASH_SECURED_PUT", "WHEEL"];
const ALLOWED_RANGES = ["1y", "3y", "5y", "10y", "max"] as const;
type HistRange = (typeof ALLOWED_RANGES)[number];

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const symbol = String(body.symbol ?? "").toUpperCase().trim();
    if (!symbol) return NextResponse.json({ error: "symbol is required" }, { status: 400 });

    const rawStrategy = String(body.strategy ?? "").toUpperCase();
    if (!(ALLOWED_STRATEGIES as string[]).includes(rawStrategy)) {
      return NextResponse.json(
        { error: `strategy must be one of ${ALLOWED_STRATEGIES.join(", ")}` },
        { status: 400 },
      );
    }
    const strategy = rawStrategy as BacktestStrategy;

    const requestedRange = String(body.range ?? "3y").toLowerCase();
    const range: HistRange = (ALLOWED_RANGES as readonly string[]).includes(requestedRange)
      ? (requestedRange as HistRange)
      : "3y";

    const [hist, quote] = await Promise.all([
      getHistoricalPrices({ symbol, range }),
      getQuote({ symbol }),
    ]);

    const spot = quote.data.price;
    const contracts = Number(body.contracts) > 0 ? Number(body.contracts) : 1;
    const shares = strategy === "CASH_SECURED_PUT" ? 0 : contracts * 100;
    const startingCapital = Math.max(spot * contracts * 100, 1);

    const result = runBacktest(hist.data.points, {
      strategy,
      symbol,
      deltaTarget: Number(body.deltaTarget) > 0 ? Number(body.deltaTarget) : 0.3,
      dteTarget: Number(body.dteTarget) > 0 ? Number(body.dteTarget) : 45,
      contracts,
      riskFreeRate: 0.05,
      startingCapital,
      shares,
      strikeInterval: spot >= 200 ? 5 : spot >= 50 ? 2.5 : 1,
      fillAssumption: body.fillAssumption === "mid" ? "mid" : "bid",
      neverSellCallBelowCostBasis: body.neverSellCallBelowCostBasis === true,
      minCallPremiumYieldPct:
        Number(body.minCallPremiumYieldPct) > 0 ? Number(body.minCallPremiumYieldPct) : undefined,
      averageDownWithPremium: body.averageDownWithPremium === true,
    });

    return NextResponse.json({
      ...result,
      startingCapital,
      underlyingPrice: spot,
      modelCaveat:
        "Option premiums are modeled with Black-Scholes using trailing 30-day realized volatility, not historical option quotes. Real fills would differ, and this is not an achievable track record.",
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
