import { redirect } from "next/navigation";
import { analyzePortfolioIncome, getPortfolioSummary } from "@/features/portfolio/income-planner";
import { getSessionUser } from "@/lib/auth";
import { IncomePlannerView } from "@/components/portfolio/income-planner-view";

export const dynamic = "force-dynamic";

export default async function IncomePlannerPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const [analysis, summary] = await Promise.all([
    analyzePortfolioIncome(5000, user.id),
    getPortfolioSummary(user.id),
  ]);
  return <IncomePlannerView initialAnalysis={analysis} summary={summary} />;
}
