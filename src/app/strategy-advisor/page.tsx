import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { StrategyAdvisorView } from "@/components/strategy-advisor/strategy-advisor-view";

export const dynamic = "force-dynamic";

export default async function StrategyAdvisorPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <main className="container mx-auto max-w-5xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold">Strategy Advisor</h1>
        <p className="text-sm text-muted-foreground">
          Enter any stock ticker. We&apos;ll grade its quality, find the best covered call to sell,
          and tell you in plain English whether it&apos;s a good stock to own and rent out with options.
        </p>
      </div>
      <StrategyAdvisorView />
    </main>
  );
}
