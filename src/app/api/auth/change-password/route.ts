import { NextResponse } from "next/server";
import { prisma } from "@/lib/database/prisma";
import { requireUser, verifyPassword, hashPassword } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { currentPassword, newPassword } = await req.json();

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: "Current and new passwords are required" }, { status: 400 });
    }
    if (newPassword.length < 6) {
      return NextResponse.json({ error: "New password must be at least 6 characters" }, { status: 400 });
    }

    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const valid = await verifyPassword(currentPassword, dbUser.passwordHash!);
    if (!valid) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
    }

    const newHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    // Invalidate all other sessions (keep current one)
    const { cookies } = await import("next/headers");
    const store = await cookies();
    const currentToken = store.get("opc_session")?.value;
    if (currentToken) {
      await prisma.session.deleteMany({
        where: { userId: user.id, NOT: { token: currentToken } },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to change password" }, { status: 500 });
  }
}
