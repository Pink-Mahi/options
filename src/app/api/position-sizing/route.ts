/**
 * Position sizing API — cost-aware entry/exit levels + vol-targeted sizing.
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { computeCostAwareLevels, computeVolTargetSizing } from "@/lib/calculations/position-sizing";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const spot = Number(body.spot);
    const volatility = Number(body.volatility);
    const holdingDays = Number(body.holdingDays);
    const signalScore = Number(body.signalScore);
    const costBps = Number(body.costBps);

    if (!Number.isFinite(spot) || !Number.isFinite(volatility) || !Number.isFinite(holdingDays) || !Number.isFinite(signalScore) || !Number.isFinite(costBps)) {
      return NextResponse.json({ error: "Missing or invalid required parameters" }, { status: 400 });
    }

    const levels = computeCostAwareLevels({
      spot,
      volatility,
      holdingDays,
      signalScore,
      costBps,
      stopMultiplier: Number(body.stopMultiplier) > 0 ? Number(body.stopMultiplier) : undefined,
      targetMultiplier: Number(body.targetMultiplier) > 0 ? Number(body.targetMultiplier) : undefined,
    });

    let sizing = null;
    const capital = Number(body.capital);
    const targetVol = Number(body.targetVol);

    if (Number.isFinite(capital) && Number.isFinite(targetVol)) {
      sizing = computeVolTargetSizing({
        capital,
        assetVol: volatility,
        targetVol,
        price: spot,
        maxLeverage: Number(body.maxLeverage) > 0 ? Number(body.maxLeverage) : undefined,
        kellyFraction: Number(body.kellyFraction) >= 0 ? Number(body.kellyFraction) : undefined,
        expectedReturn: Number(body.expectedReturn) || undefined,
      });
    }

    return NextResponse.json({
      levels: {
        direction: levels.direction,
        entryPrice: levels.entryPrice,
        stopLoss: levels.stopLoss,
        takeProfit: levels.takeProfit,
        expectedMove: levels.expectedMove,
        expectedMovePct: levels.expectedMovePct,
        riskPerShare: levels.riskPerShare,
        rewardPerShare: levels.rewardPerShare,
        riskRewardRatio: levels.riskRewardRatio,
        breakevenMove: levels.breakevenMove,
        costDragPct: levels.costDragPct,
      },
      sizing: sizing ? {
        weight: sizing.weight,
        units: sizing.units,
        positionValue: sizing.positionValue,
        leverage: sizing.leverage,
        actualVolContribution: sizing.actualVolContribution,
        kellyWeight: Number.isFinite(sizing.kellyWeight) ? sizing.kellyWeight : null,
        kellyCapped: sizing.kellyCapped,
        leverageCapped: sizing.leverageCapped,
        warnings: sizing.warnings,
      } : null,
      warnings: [
        "Entry/exit levels are derived from expected move bands and transaction costs, not AI-generated price targets.",
        "Volatility-targeted sizing assumes the input volatility is representative — regime shifts will change the optimal size.",
      ],
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
