import "server-only";
import { prisma } from "@/lib/database/prisma";
import { getOrCreatePortfolioId } from "@/lib/database/portfolio-repo";

export interface StrategyPresetData {
  id: string;
  name: string;
  strategyType: string;
  minDelta: number;
  maxDelta: number;
  minDte: number;
  maxDte: number;
  minYieldPct: number;
  minOtmPercent: number;
  minDiscountPct: number;
  excludeEarnings: boolean;
}

export interface StrategyPresetInput {
  name: string;
  strategyType: string;
  minDelta: number;
  maxDelta: number;
  minDte: number;
  maxDte: number;
  minYieldPct: number;
  minOtmPercent: number;
  minDiscountPct: number;
  excludeEarnings: boolean;
}

function mapPreset(p: {
  id: string;
  name: string;
  strategyType: string;
  minDelta: { toNumber: () => number };
  maxDelta: { toNumber: () => number };
  minDte: number;
  maxDte: number;
  minYieldPct: { toNumber: () => number };
  minOtmPercent: { toNumber: () => number };
  minDiscountPct: { toNumber: () => number };
  excludeEarnings: boolean;
}): StrategyPresetData {
  return {
    id: p.id,
    name: p.name,
    strategyType: p.strategyType,
    minDelta: p.minDelta.toNumber(),
    maxDelta: p.maxDelta.toNumber(),
    minDte: p.minDte,
    maxDte: p.maxDte,
    minYieldPct: p.minYieldPct.toNumber(),
    minOtmPercent: p.minOtmPercent.toNumber(),
    minDiscountPct: p.minDiscountPct.toNumber(),
    excludeEarnings: p.excludeEarnings,
  };
}

export async function getStrategyPresets(userId: string): Promise<StrategyPresetData[]> {
  const portfolioId = await getOrCreatePortfolioId(userId);
  const rows = await prisma.strategyPreset.findMany({
    where: { portfolioId },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(mapPreset);
}

export async function createStrategyPreset(
  userId: string,
  input: StrategyPresetInput,
): Promise<StrategyPresetData> {
  const portfolioId = await getOrCreatePortfolioId(userId);
  const row = await prisma.strategyPreset.create({
    data: {
      portfolioId,
      name: input.name,
      strategyType: input.strategyType,
      minDelta: input.minDelta,
      maxDelta: input.maxDelta,
      minDte: input.minDte,
      maxDte: input.maxDte,
      minYieldPct: input.minYieldPct,
      minOtmPercent: input.minOtmPercent,
      minDiscountPct: input.minDiscountPct,
      excludeEarnings: input.excludeEarnings,
    },
  });
  return mapPreset(row);
}

export async function deleteStrategyPreset(userId: string, presetId: string): Promise<void> {
  const portfolioId = await getOrCreatePortfolioId(userId);
  await prisma.strategyPreset.delete({
    where: { id: presetId, portfolioId },
  });
}
