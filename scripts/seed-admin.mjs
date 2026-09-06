/**
 * Seed admin user from environment variables.
 * Run after `prisma db push` in the container startup script.
 *
 * Env vars:
 *   ADMIN_EMAIL    — required, admin login email
 *   ADMIN_PASSWORD — required, min 6 chars
 *   ADMIN_NAME     — optional, display name
 *
 * Behaviour:
 *   - If ADMIN_EMAIL + ADMIN_PASSWORD are set AND no user exists with that email,
 *     creates the admin user + default portfolio.
 *   - If the user already exists, updates the password (so changing the env var
 *     and redeploying rotates the password) and ensures the role is ADMIN.
 *   - If env vars are not set, does nothing (falls back to /setup web flow).
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || null;

  if (!email || !password) {
    console.log("seed-admin: ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping (use /setup web flow).");
    return;
  }

  if (password.length < 6) {
    console.error("seed-admin: ADMIN_PASSWORD must be at least 6 characters — skipping.");
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    // Update password + ensure admin role
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, role: "ADMIN", name: name ?? existing.name },
    });
    console.log(`seed-admin: Updated existing user "${email}" (password rotated, role=ADMIN).`);
    return;
  }

  // Create admin user + default portfolio
  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      role: "ADMIN",
    },
  });

  await prisma.portfolio.create({
    data: { userId: user.id, name: "My Portfolio" },
  });

  console.log(`seed-admin: Created admin user "${email}" with default portfolio.`);
}

main()
  .catch((e) => {
    console.error("seed-admin: ERROR:", e.message);
    // Don't exit with non-zero — we don't want to block app startup if seeding fails
  })
  .finally(() => prisma.$disconnect());
