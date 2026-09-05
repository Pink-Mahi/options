import { redirect } from "next/navigation";
import { getPortfolio } from "@/lib/database/portfolio-repo";
import { getSessionUser } from "@/lib/auth";
import { PositionsView } from "@/components/positions/positions-view";

export const dynamic = "force-dynamic";

export default async function PositionsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const portfolio = await getPortfolio(user.id);
  return <PositionsView portfolio={portfolio} />;
}
