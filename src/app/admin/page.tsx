import { redirect } from "next/navigation";
import { prisma } from "@/lib/database/prisma";
import { getSessionUser, getUserCount } from "@/lib/auth";
import { AdminPanel } from "@/components/admin/admin-panel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/");

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      portfolios: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const userCount = await getUserCount();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Admin Panel</h1>
        <p className="text-sm text-muted-foreground">
          Manage user accounts. All users share the same API keys but have separate portfolio data.
        </p>
      </div>
      <AdminPanel users={users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        createdAt: u.createdAt.toISOString(),
        portfolioCount: u.portfolios.length,
      }))} currentUser={{ id: user.id, role: user.role }} userCount={userCount} />
    </div>
  );
}
