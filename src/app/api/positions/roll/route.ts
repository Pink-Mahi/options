import { NextResponse } from "next/server";
import { analyzeRoll } from "@/features/options/roll-analyzer";
import type { OptionPosition } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const position = body.position as OptionPosition | undefined;
  if (!position || !position.symbol || !position.strike) {
    return NextResponse.json({ error: "position required" }, { status: 400 });
  }
  const analysis = await analyzeRoll(position, { targetDte: body.targetDte ?? 45, sameStrikeOnly: body.sameStrikeOnly ?? false });
  return NextResponse.json(analysis);
}
