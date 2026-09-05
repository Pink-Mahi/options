import { NextResponse } from "next/server";
import { analyzePortfolioIncome } from "@/features/portfolio/income-planner";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const monthlyTarget = Number(body.monthlyIncomeTarget ?? body.monthlyTarget ?? 0);
  if (!Number.isFinite(monthlyTarget)) {
    return NextResponse.json({ error: "monthlyIncomeTarget must be a number" }, { status: 400 });
  }
  const analysis = await analyzePortfolioIncome(monthlyTarget, user.id);
  return NextResponse.json(analysis);
}
