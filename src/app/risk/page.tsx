import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { PortfolioRiskView } from "@/components/portfolio/portfolio-risk-view";
import { MarketRegimeView } from "@/components/portfolio/market-regime-view";

export const dynamic = "force-dynamic";

export default async function RiskPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Portfolio Risk &amp; Market Regime</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Beta-weighted delta shows your portfolio&apos;s directional exposure in SPY-equivalent terms.
          Concentration risk measures how much of your portfolio sits in a few positions.
          The market regime surface classifies the current environment using VIX and SPY trend,
          with strategy implications for each regime.
        </p>
      </div>

      <div className="space-y-2">
        <h2 className="text-xl font-bold">Market regime</h2>
        <MarketRegimeView />
      </div>

      <div className="space-y-2">
        <h2 className="text-xl font-bold">Portfolio risk</h2>
        <PortfolioRiskView />
      </div>
    </div>
  );
}
