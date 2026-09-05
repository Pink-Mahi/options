import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/database/prisma";
import { hashPassword, createSession, setSessionCookie, getUserCount } from "@/lib/auth";

const SESSION_COOKIE = "opc_session";

export async function POST(req: Request) {
  try {
    const userCount = await getUserCount();
    if (userCount > 0) {
      return NextResponse.json({ error: "Setup already complete" }, { status: 400 });
    }

    const { name, email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        name: name?.trim() || null,
        passwordHash,
        role: "ADMIN",
      },
    });

    // Create a default portfolio for the new admin user.
    await prisma.portfolio.create({
      data: { userId: user.id, name: "My Portfolio" },
    });

    const token = await createSession(user.id);
    await setSessionCookie(token);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Setup failed" }, { status: 500 });
  }
}

export async function GET() {
  const count = await getUserCount();
  const store = await cookies();
  const hasSession = store.get(SESSION_COOKIE)?.value != null;
  return NextResponse.json({ needsSetup: count === 0, hasSession });
}
