/**
 * Notifications API — retrieves in-app notifications for the current user.
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getRecentNotifications } from "@/features/alerts/notification-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const notifications = await getRecentNotifications(user.id, 50);
    return NextResponse.json({ notifications });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
