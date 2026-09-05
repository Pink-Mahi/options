import { notFound, redirect } from "next/navigation";
import { loadStockData } from "@/features/options/stock-data";
import { StockHeader } from "@/components/stock/stock-header";
import { StockTabs } from "@/components/stock/stock-tabs";
import { getPortfolio } from "@/lib/database/portfolio-repo";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function StockPage({
  params,
}: {
  params: { symbol: string };
}) {
  const symbol = params.symbol?.toUpperCase().trim();
  if (!symbol) notFound();

  const user = await getSessionUser();
  if (!user) redirect("/login");

  let data;
  try {
    data = await loadStockData(symbol);
  } catch {
    notFound();
  }

  const portfolio = await getPortfolio(user.id).catch(() => null);
  const position = portfolio?.stockLots.find((l) => l.symbol === symbol) ?? null;

  return (
    <div className="space-y-4">
      <StockHeader data={data} position={position} />
      <StockTabs data={data} portfolio={portfolio} />
    </div>
  );
}
