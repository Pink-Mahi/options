"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/database/prisma";
import { getOrCreatePortfolioId } from "@/lib/database/portfolio-repo";
import { requireUser } from "@/lib/auth";

export async function addStockLot(input: {
  symbol: string;
  shares: number;
  purchaseDate: string;
  costBasisPerShare: number;
  brokerAccount?: string;
  notes?: string;
  protectedFromCalls?: boolean;
}) {
  try {
    const user = await requireUser();
    const portfolioId = await getOrCreatePortfolioId(user.id);
    await prisma.stockLot.create({
      data: {
        portfolioId,
        symbol: input.symbol.toUpperCase().trim(),
        shares: input.shares,
        purchaseDate: new Date(input.purchaseDate),
        costBasisPerShare: input.costBasisPerShare,
        brokerAccount: input.brokerAccount || null,
        notes: input.notes || null,
        protectedFromCalls: input.protectedFromCalls ?? false,
      },
    });
    revalidatePath("/portfolio");
    revalidatePath("/");
  } catch (error) {
    console.error("Failed to add stock lot:", error);
    throw new Error("Failed to add stock lot. Please try again.");
  }
}

export async function deleteStockLot(id: string) {
  try {
    // Check if any option positions reference this stock lot before deleting.
    const referencingPositions = await prisma.optionPosition.findMany({
      where: { relatedStockLotIds: { has: id } },
      select: { id: true },
    });
    if (referencingPositions.length > 0) {
      throw new Error(
        `Cannot delete this stock lot: it is referenced by ${referencingPositions.length} option position(s). Close or unlink those positions first.`,
      );
    }
    await prisma.stockLot.delete({ where: { id } });
    revalidatePath("/portfolio");
    revalidatePath("/");
  } catch (error) {
    console.error("Failed to delete stock lot:", error);
    throw error instanceof Error ? error : new Error("Failed to delete stock lot.");
  }
}

export async function toggleLotProtection(id: string, protectedFromCalls: boolean) {
  try {
    await prisma.stockLot.update({ where: { id }, data: { protectedFromCalls } });
    revalidatePath("/portfolio");
    revalidatePath("/");
  } catch (error) {
    console.error("Failed to toggle lot protection:", error);
    throw new Error("Failed to update lot protection.");
  }
}

export async function saveGoals(input: {
  monthlyIncomeTarget?: number | null;
  annualIncomeTarget?: number | null;
  annualTotalReturnTarget?: number | null;
  minimumOTMPercent?: number | null;
  maximumDelta?: number | null;
  preferredDteMin?: number | null;
  preferredDteMax?: number | null;
  minimumPremiumYield?: number | null;
  maximumAssignmentProbability?: number | null;
  minimumSharesUncovered?: number | null;
  earningsPreference?: string | null;
  dividendPreference?: string | null;
  riskProfile?: string | null;
}) {
  const user = await requireUser();
  const portfolioId = await getOrCreatePortfolioId(user.id);
  const existing = await prisma.portfolioGoal.findFirst({ where: { portfolioId, symbol: null } });
  if (existing) {
    await prisma.portfolioGoal.update({ where: { id: existing.id }, data: input });
  } else {
    await prisma.portfolioGoal.create({ data: { portfolioId, symbol: null, ...input } });
  }
  revalidatePath("/portfolio");
  revalidatePath("/");
}

// ---------------------------------------------------------------------------
// Option positions (Phase 7)
// ---------------------------------------------------------------------------

export async function openOptionPosition(input: {
  symbol: string;
  optionType: "CALL" | "PUT";
  strategyType: "COVERED_CALL" | "CASH_SECURED_PUT" | "NAKED" | "LONG" | "WHEEL" | "OTHER";
  strike: number;
  expiration: string;
  contracts: number;
  openingPrice: number; // stock price at open
  openingCreditDebit: number; // per-share premium (credit positive for sells)
  openDate?: string;
  deltaAtEntry?: number | null;
  ivAtEntry?: number | null;
  dteAtEntry?: number | null;
  reasonForTrade?: string | null;
  userGoal?: string | null;
  relatedStockLotIds?: string[];
}) {
  const user = await requireUser();
  const portfolioId = await getOrCreatePortfolioId(user.id);
  const pos = await prisma.optionPosition.create({
    data: {
      portfolioId,
      symbol: input.symbol.toUpperCase().trim(),
      optionType: input.optionType,
      strategyType: input.strategyType,
      strike: input.strike,
      expiration: new Date(input.expiration),
      contracts: input.contracts,
      openingPrice: input.openingPrice,
      openingCreditDebit: input.openingCreditDebit,
      openDate: input.openDate ? new Date(input.openDate) : new Date(),
      deltaAtEntry: input.deltaAtEntry ?? null,
      ivAtEntry: input.ivAtEntry ?? null,
      dteAtEntry: input.dteAtEntry ?? null,
      reasonForTrade: input.reasonForTrade ?? null,
      userGoal: input.userGoal ?? null,
      relatedStockLotIds: input.relatedStockLotIds ?? [],
    },
  });
  // Record the premium transaction.
  const credit = input.openingCreditDebit * input.contracts * 100;
  await prisma.transaction.create({
    data: {
      portfolioId,
      symbol: input.symbol.toUpperCase().trim(),
      type: input.openingCreditDebit >= 0 ? "PREMIUM" : "OPEN",
      amount: credit,
      shares: null,
      price: input.openingCreditDebit,
      notes: `Opened ${input.contracts}x ${input.optionType} ${input.strike} ${input.expiration}`,
      relatedOptionPositionId: pos.id,
    },
  });
  revalidatePath("/portfolio");
  revalidatePath("/positions");
  revalidatePath("/");
}

export async function closeOptionPosition(
  id: string,
  input: {
    status: "EXPIRED_WORTHLESS" | "ASSIGNED" | "BOUGHT_BACK" | "ROLLED" | "CLOSED";
    closingPrice: number; // per-share cost to close (positive = debit paid)
    closeDate?: string;
    closingNotes?: string | null;
  },
) {
  const pos = await prisma.optionPosition.findUniqueOrThrow({ where: { id } });
  const realized = (pos.openingCreditDebit.toNumber() - input.closingPrice) * pos.contracts * 100;
  await prisma.optionPosition.update({
    where: { id },
    data: {
      status: input.status,
      closingPrice: input.closingPrice,
      closeDate: input.closeDate ? new Date(input.closeDate) : new Date(),
      realizedProfitLoss: realized,
      closingNotes: input.closingNotes ?? null,
    },
  });
  await prisma.transaction.create({
    data: {
      portfolioId: pos.portfolioId,
      symbol: pos.symbol,
      type: input.status === "ASSIGNED" ? "ASSIGN" : input.status === "ROLLED" ? "ROLL" : "CLOSE",
      amount: -input.closingPrice * pos.contracts * 100,
      shares: null,
      price: input.closingPrice,
      notes: `Closed ${pos.contracts}x ${pos.optionType} ${pos.strike} as ${input.status}`,
      relatedOptionPositionId: id,
    },
  });
  revalidatePath("/portfolio");
  revalidatePath("/positions");
  revalidatePath("/");
}

export async function deleteOptionPosition(id: string) {
  await prisma.optionPosition.delete({ where: { id } });
  revalidatePath("/portfolio");
  revalidatePath("/positions");
}

export async function updatePositionCurrentPrice(id: string, currentPrice: number) {
  await prisma.optionPosition.update({ where: { id }, data: { currentPrice } });
  revalidatePath("/positions");
}
