import { NextResponse } from "next/server";
import { clearSessionCookie, destroySession } from "@/lib/auth";
import { cookies } from "next/headers";

const SESSION_COOKIE = "opc_session";

export async function POST() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await destroySession(token).catch(() => {});
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
