/**
 * Watchlist & alert repository.
 *
 * CRUD operations for the user's watchlist and alerts.
 * Uses the same default-portfolio pattern as portfolio-repo.
 */

import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/database/prisma";
import { getOrCreatePortfolioId } from "./portfolio-repo";
import type { AlertEntry, AlertRuleType, WatchlistEntry } from "@/lib/types";

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

export async function getWatchlist(userId: string): Promise<WatchlistEntry[]> {
  const portfolioId = await getOrCreatePortfolioId(userId);
  const rows = await prisma.watchlist.findMany({
    where: { portfolioId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(mapWatchlistRow);
}

export async function addToWatchlist(userId: string, input: {
  symbol: string;
  notes?: string | null;
  targetPrice?: number | null;
  targetIv?: number | null;
  targetYield?: number | null;
}): Promise<WatchlistEntry> {
  const portfolioId = await getOrCreatePortfolioId(userId);
  const row = await prisma.watchlist.upsert({
    where: { portfolioId_symbol: { portfolioId, symbol: input.symbol.toUpperCase() } },
    update: {
      notes: input.notes ?? undefined,
      targetPrice: input.targetPrice ?? undefined,
      targetIv: input.targetIv ?? undefined,
      targetYield: input.targetYield ?? undefined,
    },
    create: {
      portfolioId,
      symbol: input.symbol.toUpperCase(),
      notes: input.notes ?? null,
      targetPrice: input.targetPrice ?? null,
      targetIv: input.targetIv ?? null,
      targetYield: input.targetYield ?? null,
    },
  });
  return mapWatchlistRow(row);
}

export async function removeFromWatchlist(id: string): Promise<void> {
  await prisma.watchlist.delete({ where: { id } });
}

export async function updateWatchlistEntry(
  id: string,
  input: Partial<{
    notes: string | null;
    targetPrice: number | null;
    targetIv: number | null;
    targetYield: number | null;
  }>,
): Promise<WatchlistEntry> {
  const row = await prisma.watchlist.update({
    where: { id },
    data: {
      notes: input.notes,
      targetPrice: input.targetPrice,
      targetIv: input.targetIv,
      targetYield: input.targetYield,
    },
  });
  return mapWatchlistRow(row);
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export async function getAlerts(userId: string): Promise<AlertEntry[]> {
  const portfolioId = await getOrCreatePortfolioId(userId);
  const rows = await prisma.alert.findMany({
    where: { portfolioId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(mapAlertRow);
}

export async function createAlert(userId: string, input: {
  symbol: string | null;
  ruleType: AlertRuleType;
  parameters: { threshold?: number; expiration?: string; strike?: number };
}): Promise<AlertEntry> {
  const portfolioId = await getOrCreatePortfolioId(userId);
  const row = await prisma.alert.create({
    data: {
      portfolioId,
      symbol: input.symbol?.toUpperCase() ?? null,
      ruleType: input.ruleType,
      parameters: input.parameters,
    },
  });
  return mapAlertRow(row);
}

export async function updateAlert(
  id: string,
  input: Partial<{ enabled: boolean }>,
): Promise<AlertEntry> {
  const row = await prisma.alert.update({
    where: { id },
    data: { enabled: input.enabled },
  });
  return mapAlertRow(row);
}

export async function deleteAlert(id: string): Promise<void> {
  await prisma.alert.delete({ where: { id } });
}

export async function markAlertFired(id: string): Promise<void> {
  await prisma.alert.update({
    where: { id },
    data: { lastFiredAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

type WatchlistRow = Prisma.WatchlistGetPayload<{}>;

function mapWatchlistRow(row: WatchlistRow): WatchlistEntry {
  return {
    id: row.id,
    portfolioId: row.portfolioId,
    symbol: row.symbol,
    notes: row.notes,
    targetPrice: row.targetPrice != null ? Number(row.targetPrice) : null,
    targetIv: row.targetIv != null ? Number(row.targetIv) : null,
    targetYield: row.targetYield != null ? Number(row.targetYield) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapAlertRow(row: {
  id: string;
  portfolioId: string;
  symbol: string | null;
  ruleType: string;
  parameters: unknown;
  enabled: boolean;
  lastFiredAt: Date | null;
  createdAt: Date;
}): AlertEntry {
  return {
    id: row.id,
    portfolioId: row.portfolioId,
    symbol: row.symbol,
    ruleType: row.ruleType as AlertRuleType,
    parameters: (row.parameters ?? {}) as { threshold?: number; expiration?: string; strike?: number },
    enabled: row.enabled,
    lastFiredAt: row.lastFiredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
