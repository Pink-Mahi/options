import { NextResponse } from "next/server";
import { getWatchlist, addToWatchlist, removeFromWatchlist, updateWatchlistEntry } from "@/lib/database/watchlist-repo";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const items = await getWatchlist(user.id);
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json();
    const item = await addToWatchlist(user.id, {
      symbol: body.symbol,
      notes: body.notes ?? null,
      targetPrice: body.targetPrice != null ? Number(body.targetPrice) : null,
      targetIv: body.targetIv != null ? Number(body.targetIv) : null,
      targetYield: body.targetYield != null ? Number(body.targetYield) : null,
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
    const item = await updateWatchlistEntry(body.id, {
      notes: body.notes,
      targetPrice: body.targetPrice != null ? Number(body.targetPrice) : null,
      targetIv: body.targetIv != null ? Number(body.targetIv) : null,
      targetYield: body.targetYield != null ? Number(body.targetYield) : null,
    });
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
    await removeFromWatchlist(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
