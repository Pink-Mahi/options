import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  getPresets,
  createPreset,
  deletePreset,
  updatePreset,
  type BacktestPresetInput,
} from "@/lib/database/backtest-preset-repo";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const presets = await getPresets(user.id);
  return NextResponse.json({ presets });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const input: BacktestPresetInput = {
    name,
    strategy: String(body.strategy ?? "COVERED_CALL"),
    deltaTarget: Number(body.deltaTarget) || 0.3,
    dteTarget: Number(body.dteTarget) || 45,
    range: String(body.range ?? "3y"),
    contracts: Number(body.contracts) || 1,
    neverBelowCost: body.neverBelowCost !== false,
    minYieldPct: Number(body.minYieldPct) || 0,
    averageDown: body.averageDown === true,
    fillAssumption: body.fillAssumption === "mid" ? "mid" : "bid",
    startingCapital: Number(body.startingCapital) || 0,
    buyBackPct: Number(body.buyBackPct) || 0,
    minPutYieldPct: Number(body.minPutYieldPct) || 0,
    rollOnAssignment: body.rollOnAssignment === true,
  };

  const preset = await createPreset(user.id, input);
  return NextResponse.json({ preset });
}

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const presetId = String(body.id ?? "");
  if (!presetId) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const input: BacktestPresetInput = {
    name,
    strategy: String(body.strategy ?? "COVERED_CALL"),
    deltaTarget: Number(body.deltaTarget) || 0.3,
    dteTarget: Number(body.dteTarget) || 45,
    range: String(body.range ?? "3y"),
    contracts: Number(body.contracts) || 1,
    neverBelowCost: body.neverBelowCost !== false,
    minYieldPct: Number(body.minYieldPct) || 0,
    averageDown: body.averageDown === true,
    fillAssumption: body.fillAssumption === "mid" ? "mid" : "bid",
    startingCapital: Number(body.startingCapital) || 0,
    buyBackPct: Number(body.buyBackPct) || 0,
    minPutYieldPct: Number(body.minPutYieldPct) || 0,
    rollOnAssignment: body.rollOnAssignment === true,
  };

  const preset = await updatePreset(user.id, presetId, input);
  return NextResponse.json({ preset });
}

export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const presetId = url.searchParams.get("id");
  if (!presetId) return NextResponse.json({ error: "id is required" }, { status: 400 });

  await deletePreset(user.id, presetId);
  return NextResponse.json({ ok: true });
}
