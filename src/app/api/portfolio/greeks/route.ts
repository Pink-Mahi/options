import { NextResponse } from "next/server";
import { getPortfolio } from "@/lib/database/portfolio-repo";
import { calculatePortfolioGreeks } from "@/lib/calculations/portfolio-greeks";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const portfolio = await getPortfolio(user.id);
  const greeks = await calculatePortfolioGreeks(portfolio);
  return NextResponse.json(greeks);
}
