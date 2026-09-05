import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { WalkForwardView } from "@/components/quant/walk-forward-view";
import { PositionSizingView } from "@/components/quant/position-sizing-view";

export const dynamic = "force-dynamic";

export default async function QuantPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <main className="container mx-auto max-w-7xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold">Quant Lab</h1>
        <p className="text-sm text-muted-foreground">
          Walk-forward out-of-sample signal validation with Deflated Sharpe Ratio overfitting correction,
          plus cost-aware entry/exit levels and volatility-targeted position sizing. Every number is
          deterministic and auditable.
        </p>
      </div>
      <WalkForwardView />
      <PositionSizingView />
    </main>
  );
}
