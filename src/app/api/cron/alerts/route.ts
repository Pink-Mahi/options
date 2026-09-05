/**
 * Cron endpoint for scheduled alert checking.
 *
 * Configure an external cron job (or Coolify cron) to hit this endpoint:
 *   curl -X POST https://your-domain.com/api/cron/alerts -H "x-cron-secret: <CRON_SECRET>"
 *
 * Set CRON_SECRET in your environment to protect this endpoint.
 */

import { NextResponse } from "next/server";
import { runAlertCycle } from "@/features/alerts/notification-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers.get("x-cron-secret");
    if (authHeader !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await runAlertCycle();
    return NextResponse.json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return POST(req);
}
