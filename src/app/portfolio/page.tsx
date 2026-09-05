import { redirect } from "next/navigation";
import { getPortfolio } from "@/lib/database/portfolio-repo";
import { getSessionUser } from "@/lib/auth";
import { PortfolioView } from "@/components/portfolio/portfolio-view";
import { PortfolioGreeksView } from "@/components/portfolio/portfolio-greeks-view";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const portfolio = await getPortfolio(user.id);
  return (
    <div className="space-y-6">
      <PortfolioView portfolio={portfolio} />
      <div className="space-y-2">
        <h2 className="text-xl font-bold">Portfolio Greeks &amp; assignment risk</h2>
        <p className="text-sm text-muted-foreground">
          Aggregated delta, gamma, theta, vega across all open option positions and stock holdings.
          Assignment risk is estimated from current ITM status and time to expiration.
        </p>
        <PortfolioGreeksView />
      </div>
    </div>
  );
}
