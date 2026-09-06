import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  getStrategyPresets,
  createStrategyPreset,
  deleteStrategyPreset,
  type StrategyPresetInput,
} from "@/lib/database/strategy-preset-repo";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const presets = await getStrategyPresets(user.id);
  return NextResponse.json({ presets });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const input: StrategyPresetInput = {
    name,
    strategyType: String(body.strategyType ?? "ANY"),
    minDelta: Number(body.minDelta) || 0,
    maxDelta: Number(body.maxDelta) || 1,
    minDte: Number(body.minDte) || 0,
    maxDte: Number(body.maxDte) || 365,
    minYieldPct: Number(body.minYieldPct) || 0,
    minOtmPercent: Number(body.minOtmPercent) || 0,
    minDiscountPct: Number(body.minDiscountPct) || 0,
    excludeEarnings: body.excludeEarnings !== false,
  };

  const preset = await createStrategyPreset(user.id, input);
  return NextResponse.json({ preset });
}

export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const presetId = url.searchParams.get("id");
  if (!presetId) return NextResponse.json({ error: "id is required" }, { status: 400 });

  await deleteStrategyPreset(user.id, presetId);
  return NextResponse.json({ ok: true });
}
