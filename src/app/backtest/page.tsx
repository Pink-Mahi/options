import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { BacktestView } from "@/components/backtest/backtest-view";

export const dynamic = "force-dynamic";

export default async function BacktestPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <BacktestView />;
}
