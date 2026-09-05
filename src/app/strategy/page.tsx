import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { MultiLegBuilder } from "@/components/strategy/multi-leg-builder";

export const dynamic = "force-dynamic";

export default async function StrategyPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <MultiLegBuilder />;
}
