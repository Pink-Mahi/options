import "server-only";
import { prisma } from "@/lib/database/prisma";
import { getOrCreatePortfolioId } from "@/lib/database/portfolio-repo";

export interface BacktestPresetData {
  id: string;
  portfolioId: string;
  name: string;
  strategy: string;
  deltaTarget: number;
  dteTarget: number;
  range: string;
  contracts: number;
  neverBelowCost: boolean;
  minYieldPct: number;
  averageDown: boolean;
  fillAssumption: "bid" | "mid";
  startingCapital: number;
  buyBackPct: number;
  minPutYieldPct: number;
  rollOnAssignment: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BacktestPresetInput {
  name: string;
  strategy: string;
  deltaTarget: number;
  dteTarget: number;
  range: string;
  contracts: number;
  neverBelowCost: boolean;
  minYieldPct: number;
  averageDown: boolean;
  fillAssumption: "bid" | "mid";
  startingCapital: number;
  buyBackPct: number;
  minPutYieldPct: number;
  rollOnAssignment: boolean;
}

function mapPreset(p: {
  id: string;
  portfolioId: string;
  name: string;
  strategy: string;
  deltaTarget: { toNumber: () => number };
  dteTarget: number;
  range: string;
  contracts: number;
  neverBelowCost: boolean;
  minYieldPct: { toNumber: () => number };
  averageDown: boolean;
  fillAssumption: string;
  startingCapital: number;
  buyBackPct: { toNumber: () => number };
  minPutYieldPct: { toNumber: () => number };
  rollOnAssignment: boolean;
  createdAt: Date;
  updatedAt: Date;
}): BacktestPresetData {
  return {
    id: p.id,
    portfolioId: p.portfolioId,
    name: p.name,
    strategy: p.strategy,
    deltaTarget: p.deltaTarget.toNumber(),
    dteTarget: p.dteTarget,
    range: p.range,
    contracts: p.contracts,
    neverBelowCost: p.neverBelowCost,
    minYieldPct: p.minYieldPct.toNumber(),
    averageDown: p.averageDown,
    fillAssumption: p.fillAssumption as "bid" | "mid",
    startingCapital: p.startingCapital,
    buyBackPct: p.buyBackPct.toNumber(),
    minPutYieldPct: p.minPutYieldPct.toNumber(),
    rollOnAssignment: p.rollOnAssignment,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function getPresets(userId: string): Promise<BacktestPresetData[]> {
  const portfolioId = await getOrCreatePortfolioId(userId);
  const rows = await prisma.backtestPreset.findMany({
    where: { portfolioId },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(mapPreset);
}

export async function createPreset(
  userId: string,
  input: BacktestPresetInput,
): Promise<BacktestPresetData> {
  const portfolioId = await getOrCreatePortfolioId(userId);
  const row = await prisma.backtestPreset.create({
    data: {
      portfolioId,
      name: input.name,
      strategy: input.strategy,
      deltaTarget: input.deltaTarget,
      dteTarget: input.dteTarget,
      range: input.range,
      contracts: input.contracts,
      neverBelowCost: input.neverBelowCost,
      minYieldPct: input.minYieldPct,
      averageDown: input.averageDown,
      fillAssumption: input.fillAssumption,
      startingCapital: input.startingCapital,
      buyBackPct: input.buyBackPct,
      minPutYieldPct: input.minPutYieldPct,
      rollOnAssignment: input.rollOnAssignment,
    },
  });
  return mapPreset(row);
}

export async function updatePreset(
  userId: string,
  presetId: string,
  input: BacktestPresetInput,
): Promise<BacktestPresetData> {
  const portfolioId = await getOrCreatePortfolioId(userId);
  const row = await prisma.backtestPreset.update({
    where: { id: presetId, portfolioId },
    data: {
      name: input.name,
      strategy: input.strategy,
      deltaTarget: input.deltaTarget,
      dteTarget: input.dteTarget,
      range: input.range,
      contracts: input.contracts,
      neverBelowCost: input.neverBelowCost,
      minYieldPct: input.minYieldPct,
      averageDown: input.averageDown,
      fillAssumption: input.fillAssumption,
      startingCapital: input.startingCapital,
      buyBackPct: input.buyBackPct,
      minPutYieldPct: input.minPutYieldPct,
      rollOnAssignment: input.rollOnAssignment,
    },
  });
  return mapPreset(row);
}

export async function deletePreset(userId: string, presetId: string): Promise<void> {
  const portfolioId = await getOrCreatePortfolioId(userId);
  await prisma.backtestPreset.delete({
    where: { id: presetId, portfolioId },
  });
}
