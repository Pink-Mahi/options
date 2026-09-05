import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Search, PieChart, Calculator, Sparkles, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getPortfolio } from "@/lib/database/portfolio-repo";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const portfolio = await getPortfolio(user.id).catch(() => null);
  const lotCount = portfolio?.stockLots.length ?? 0;
  const distinctSymbols = new Set(portfolio?.stockLots.map((l) => l.symbol) ?? []).size;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          AI Options Income &amp; Profit Calculator
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Analyze covered calls, cash-secured puts, and LEAPS with deterministic calculations
          on real market data. Compare premium income against the stock appreciation you might
          surrender — across your whole portfolio.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Portfolio Holdings" value={`${lotCount} lot${lotCount === 1 ? "" : "s"}`} hint={`${distinctSymbols} symbol${distinctSymbols === 1 ? "" : "s"}`} />
        <StatCard label="Open Option Positions" value={`${portfolio?.optionPositions.filter((p) => p.status === "OPEN").length ?? 0}`} hint="covered calls + short puts" />
        <StatCard label="Income Goal" value={portfolio?.goals[0]?.monthlyIncomeTarget ? `$${portfolio.goals[0].monthlyIncomeTarget}/mo` : "Not set"} hint="set in Portfolio" />
        <StatCard label="Risk Profile" value={portfolio?.goals[0]?.riskProfile ?? "Not set"} hint="strategy preset" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <FeatureCard
          icon={Search}
          title="Search a stock"
          description="Look up any ticker to see live quotes, the full options chain, and covered-call / CSP analysis."
          href="/search"
          cta="Search stocks"
        />
        <FeatureCard
          icon={Calculator}
          title="Covered call calculator"
          description="Pick a strike and expiration, adjust the expected fill, and see premium yield, max total return, and the payoff graph."
          href="/calculator"
          cta="Open calculator"
        />
        <FeatureCard
          icon={PieChart}
          title="Portfolio & goals"
          description="Enter holdings with cost basis and purchase dates. Set income goals, risk profile, and DTE preferences."
          href="/portfolio"
          cta="Manage portfolio"
        />
        <FeatureCard
          icon={TrendingUp}
          title="Historical analysis"
          description="Rolling return distributions, volatility, drawdowns, and the historical frequency of a stock reaching a strike."
          href="/search"
          cta="Analyze a stock"
        />
        <FeatureCard
          icon={Sparkles}
          title="AI strategy assistant"
          description="Ask natural-language questions. The AI converts goals into filters, runs deterministic scanners, and explains the trade-offs."
          href="/ai"
          cta="Ask AI (Phase 5)"
        />
        <Card>
          <CardHeader>
            <CardTitle>Math before AI</CardTitle>
            <CardDescription>Product principle</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Every number shown comes from market data or the deterministic calculation engine —
            never invented by an AI. The AI interprets results; it does not fabricate inputs.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-bold tabular">{value}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  href,
  cta,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  href: string;
  cta: string;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-muted-foreground" />
          <CardTitle>{title}</CardTitle>
        </div>
        <CardDescription className="mt-1">{description}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto">
        <Link href={href}>
          <Button variant="outline" size="sm">
            {cta} <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
