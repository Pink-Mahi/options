import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/database/prisma";
import { clearSessionCookie, destroySession } from "@/lib/auth";

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

export async function GET() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ user: null });
  }

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: { select: { id: true, email: true, name: true, role: true } } },
  });

  if (!session || session.expiresAt < new Date()) {
    if (session) {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    }
    return NextResponse.json({ user: null });
  }

  return NextResponse.json({
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
    },
  });
}
