import { NextResponse } from "next/server";
import { getAlerts, createAlert, updateAlert, deleteAlert } from "@/lib/database/watchlist-repo";
import { evaluateAlerts } from "@/features/alerts/alert-evaluator";
import { getSessionUser } from "@/lib/auth";
import type { AlertRuleType } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const alerts = await getAlerts(user.id);
    const evaluations = await evaluateAlerts(alerts).catch(() => []);
    return NextResponse.json({ alerts, evaluations });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json();
    const item = await createAlert(user.id, {
      symbol: body.symbol ?? null,
      ruleType: body.ruleType as AlertRuleType,
      parameters: {
        threshold: body.threshold != null ? Number(body.threshold) : undefined,
        expiration: body.expiration,
        strike: body.strike != null ? Number(body.strike) : undefined,
      },
    });
    return NextResponse.json(item);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json();
    const item = await updateAlert(body.id, { enabled: body.enabled });
    return NextResponse.json(item);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    await deleteAlert(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
