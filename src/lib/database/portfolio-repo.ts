/**
 * Portfolio repository.
 *
 * Each authenticated user has their own portfolio. Server actions and pages
 * pass the userId from the session. API routes resolve the userId from the
 * session cookie via auth helpers.
 */

import "server-only";
import { prisma } from "@/lib/database/prisma";
import type { Portfolio, PortfolioGoal, StockLot } from "@/lib/types";

const DEFAULT_PORTFOLIO_NAME = "My Portfolio";

export async function getOrCreatePortfolioId(userId: string): Promise<string> {
  const portfolio = await prisma.portfolio.upsert({
    where: { userId },
    update: {},
    create: { userId, name: DEFAULT_PORTFOLIO_NAME },
  });
  return portfolio.id;
}

export async function getPortfolio(userId: string): Promise<Portfolio> {
  const portfolioId = await getOrCreatePortfolioId(userId);
  const row = await prisma.portfolio.findUniqueOrThrow({
    where: { id: portfolioId },
    include: {
      stockLots: { orderBy: { purchaseDate: "asc" } },
      options: { orderBy: { openDate: "desc" } },
      goals: true,
      watchlist: { orderBy: { createdAt: "desc" } },
      alerts: { orderBy: { createdAt: "desc" } },
    },
  });

  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    cashAvailable: 0, // tracked via transactions in a later phase
    stockLots: row.stockLots.map(mapStockLot),
    optionPositions: row.options.map((o) => ({
      id: o.id,
      symbol: o.symbol,
      optionType: o.optionType,
      strategyType: o.strategyType,
      strike: Number(o.strike),
      expiration: o.expiration.toISOString().slice(0, 10),
      contracts: o.contracts,
      openingPrice: Number(o.openingPrice),
      openingCreditDebit: Number(o.openingCreditDebit),
      openDate: o.openDate.toISOString().slice(0, 10),
      currentPrice: o.currentPrice ? Number(o.currentPrice) : null,
      status: o.status,
      relatedStockLotIds: o.relatedStockLotIds,
      assignmentStatus: o.assignmentStatus,
      closeDate: o.closeDate ? o.closeDate.toISOString().slice(0, 10) : null,
      closingPrice: o.closingPrice ? Number(o.closingPrice) : null,
      realizedProfitLoss: o.realizedProfitLoss ? Number(o.realizedProfitLoss) : null,
      deltaAtEntry: o.deltaAtEntry ? Number(o.deltaAtEntry) : null,
      ivAtEntry: o.ivAtEntry ? Number(o.ivAtEntry) : null,
      dteAtEntry: o.dteAtEntry,
      reasonForTrade: o.reasonForTrade,
      userGoal: o.userGoal,
      closingNotes: o.closingNotes,
    })),
    goals: row.goals.map(mapGoal),
    watchlist: row.watchlist.map((w) => ({
      id: w.id,
      portfolioId: w.portfolioId,
      symbol: w.symbol,
      notes: w.notes,
      targetPrice: w.targetPrice != null ? Number(w.targetPrice) : null,
      targetIv: w.targetIv != null ? Number(w.targetIv) : null,
      targetYield: w.targetYield != null ? Number(w.targetYield) : null,
      createdAt: w.createdAt.toISOString(),
    })),
    alerts: row.alerts.map((a) => ({
      id: a.id,
      portfolioId: a.portfolioId,
      symbol: a.symbol,
      ruleType: a.ruleType as import("@/lib/types").AlertRuleType,
      parameters: (a.parameters ?? {}) as { threshold?: number; expiration?: string; strike?: number },
      enabled: a.enabled,
      lastFiredAt: a.lastFiredAt?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

function mapStockLot(l: {
  id: string;
  portfolioId: string;
  symbol: string;
  shares: { toNumber: () => number };
  purchaseDate: Date;
  costBasisPerShare: { toNumber: () => number };
  brokerAccount: string | null;
  notes: string | null;
  protectedFromCalls: boolean;
}): StockLot {
  const shares = l.shares.toNumber();
  const cost = l.costBasisPerShare.toNumber();
  return {
    id: l.id,
    portfolioId: l.portfolioId,
    symbol: l.symbol,
    shares,
    purchaseDate: l.purchaseDate.toISOString().slice(0, 10),
    costBasisPerShare: cost,
    totalCostBasis: shares * cost,
    brokerAccount: l.brokerAccount,
    notes: l.notes,
    protectedFromCalls: l.protectedFromCalls,
  };
}

function mapGoal(g: Record<string, unknown>): PortfolioGoal {
  const toNum = (v: unknown): number | null => {
    if (v == null) return null;
    if (typeof v === "number") return v;
    if (typeof v === "object" && v !== null && "toNumber" in v && typeof (v as { toNumber: unknown }).toNumber === "function") {
      return (v as { toNumber: () => number }).toNumber();
    }
    return null;
  };
  return {
    id: g.id as string,
    portfolioId: g.portfolioId as string,
    symbol: (g.symbol as string | null) ?? null,
    monthlyIncomeTarget: toNum(g.monthlyIncomeTarget),
    annualIncomeTarget: toNum(g.annualIncomeTarget),
    annualTotalReturnTarget: toNum(g.annualTotalReturnTarget),
    minimumOTMPercent: toNum(g.minimumOTMPercent),
    maximumDelta: toNum(g.maximumDelta),
    preferredDteMin: (g.preferredDteMin as number | null) ?? null,
    preferredDteMax: (g.preferredDteMax as number | null) ?? null,
    minimumPremiumYield: toNum(g.minimumPremiumYield),
    maximumAssignmentProbability: toNum(g.maximumAssignmentProbability),
    minimumSharesUncovered: (g.minimumSharesUncovered as number | null) ?? null,
    earningsPreference: (g.earningsPreference as PortfolioGoal["earningsPreference"]) ?? null,
    dividendPreference: (g.dividendPreference as PortfolioGoal["dividendPreference"]) ?? null,
    riskProfile: (g.riskProfile as PortfolioGoal["riskProfile"]) ?? null,
    strategyPreference: (g.strategyPreference as string | null) ?? null,
  };
}
