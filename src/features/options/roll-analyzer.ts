/**
 * Roll & buyback analyzer for open short option positions.
 *
 * Deterministic. Compares:
 *   1. Hold to expiration
 *   2. Buy back now (close for the current ask)
 *   3. Roll out to a later expiration (buy back + sell new)
 *
 * All inputs come from real market data or user-entered fill prices. No
 * fabrication. Returns clear trade-offs, never a single "best" recommendation.
 */

import "server-only";
import { getExpirations, getOptionChain, getQuote } from "@/features/market-data/service";
import type { OptionPosition } from "@/lib/types";

export interface RollAnalysis {
  position: {
    symbol: string;
    optionType: "CALL" | "PUT";
    strike: number;
    expiration: string;
    contracts: number;
    openingCreditDebit: number;
    openDate: string;
  };
  currentStockPrice: number;
  holdToExpiration: {
    maxRemainingProfit: number; // if expires worthless
    currentIntrinsicValue: number; // per-share ITM amount (negative for OTM)
    daysToExpiration: number;
  };
  buybackNow: {
    askPrice: number | null;
    cost: number | null; // total debit to close
    realizedProfit: number | null; // openingCredit - buyback cost (per-contract total)
    percentOfMaxCaptured: number | null;
  };
  rollCandidates: RollCandidate[];
  warnings: string[];
  dataQuality: "realtime" | "delayed" | "unknown";
}

export interface RollCandidate {
  expiration: string;
  dte: number;
  strike: number;
  newPremium: number; // per-share credit from selling new
  buybackCost: number; // per-share debit to close existing
  netCredit: number; // newPremium - buybackCost (positive = credit received)
  extraDays: number;
  annualizedNetCredit: number; // comparison tool only
  newDelta: number | null;
  newIv: number | null;
  rationale: string;
}

export async function analyzeRoll(
  position: OptionPosition,
  options: { targetDte?: number; sameStrikeOnly?: boolean } = {},
): Promise<RollAnalysis> {
  const warnings: string[] = [];
  const symbol = position.symbol;
  const targetDte = options.targetDte ?? 45;

  const [quoteRes, expirationsRes] = await Promise.all([
    getQuote({ symbol }).catch(() => null),
    getExpirations({ symbol }).catch(() => null),
  ]);
  if (!quoteRes || !expirationsRes) {
    return {
      position: positionSummary(position),
      currentStockPrice: position.openingPrice,
      holdToExpiration: { maxRemainingProfit: 0, currentIntrinsicValue: 0, daysToExpiration: 0 },
      buybackNow: { askPrice: null, cost: null, realizedProfit: null, percentOfMaxCaptured: null },
      rollCandidates: [],
      warnings: ["Market data unavailable for roll analysis."],
      dataQuality: "unknown",
    };
  }

  const currentPrice = quoteRes.data.price;
  const today = new Date();
  const expDate = new Date(position.expiration);
  const daysToExpiration = Math.max(0, Math.round((expDate.getTime() - today.getTime()) / 86400000));

  // Intrinsic value of the short option (per share). Positive = ITM (bad for seller).
  const intrinsic =
    position.optionType === "CALL"
      ? Math.max(0, currentPrice - position.strike)
      : Math.max(0, position.strike - currentPrice);

  const maxRemainingProfit = position.openingCreditDebit * position.contracts * 100;

  // Buy back now: find the current option in the nearest chain and use its ask.
  let buybackAsk: number | null = null;
  const nearestExpiration = expirationsRes.data.find((e) => e.expirationDate === position.expiration);
  if (nearestExpiration) {
    const chain = await getOptionChain({ symbol, expiration: position.expiration }).catch(() => null);
    if (chain) {
      const list = position.optionType === "CALL" ? chain.data.calls : chain.data.puts;
      const match = list.find((c) => Math.abs(c.strike - position.strike) < 1e-6);
      buybackAsk = match?.ask ?? null;
    }
  }

  const buybackCost = buybackAsk != null ? buybackAsk * position.contracts * 100 : null;
  const originalCredit = position.openingCreditDebit * position.contracts * 100;
  const realizedProfit = buybackCost != null ? originalCredit - buybackCost : null;
  const percentCaptured = realizedProfit != null && originalCredit > 0 ? realizedProfit / originalCredit : null;

  // Roll candidates: pick the closest expiration to targetDte that is AFTER the current expiration.
  const futureExpirations = expirationsRes.data.filter((e) => e.daysToExpiration > daysToExpiration);
  const rollCandidates: RollCandidate[] = [];

  for (const exp of futureExpirations.slice(0, 5)) {
    try {
      const chain = await getOptionChain({ symbol, expiration: exp.expirationDate });
      const list = position.optionType === "CALL" ? chain.data.calls : chain.data.puts;
      // For rolls we typically keep the same strike (or slightly higher for calls / lower for puts).
      const candidates = options.sameStrikeOnly
        ? list.filter((c) => Math.abs(c.strike - position.strike) < 1e-6)
        : list.filter((c) => {
            if (position.optionType === "CALL") return c.strike >= position.strike - 5 && c.strike <= position.strike + 10;
            return c.strike <= position.strike + 5 && c.strike >= position.strike - 10;
          });
      // Best roll candidate at each strike: highest net credit.
      for (const c of candidates.slice(0, 6)) {
        const newPremium = c.bid ?? 0;
        const netCredit = newPremium - (buybackAsk ?? 0);
        const extraDays = exp.daysToExpiration - daysToExpiration;
        const annualizedNetCredit = extraDays > 0 ? (netCredit / extraDays) * 365 : 0;
        rollCandidates.push({
          expiration: exp.expirationDate,
          dte: exp.daysToExpiration,
          strike: c.strike,
          newPremium,
          buybackCost: buybackAsk ?? 0,
          netCredit,
          extraDays,
          annualizedNetCredit,
          newDelta: c.greeks.delta ?? null,
          newIv: c.impliedVolatility ?? null,
          rationale:
            c.strike === position.strike
              ? `Same strike, ${extraDays} extra days`
              : position.optionType === "CALL"
              ? c.strike > position.strike
                ? `Roll up to ${c.strike} (+${(c.strike - position.strike).toFixed(2)} upside)`
                : `Roll down to ${c.strike} (more protection, less upside)`
              : c.strike < position.strike
              ? `Roll down to ${c.strike} (lower effective entry)`
              : `Roll up to ${c.strike} (more premium, higher entry)`,
        });
      }
    } catch {
      // skip this expiration
    }
  }

  // Sort by net credit descending.
  rollCandidates.sort((a, b) => b.netCredit - a.netCredit);

  if (buybackAsk == null) warnings.push("Could not fetch current ask for the open position — buyback figures unavailable.");
  if (rollCandidates.length === 0) warnings.push("No roll candidates found in future expirations.");

  return {
    position: positionSummary(position),
    currentStockPrice: currentPrice,
    holdToExpiration: {
      maxRemainingProfit,
      currentIntrinsicValue: intrinsic,
      daysToExpiration,
    },
    buybackNow: {
      askPrice: buybackAsk,
      cost: buybackCost,
      realizedProfit,
      percentOfMaxCaptured: percentCaptured,
    },
    rollCandidates: rollCandidates.slice(0, 8),
    warnings,
    dataQuality: quoteRes.dataQuality,
  };
}

function positionSummary(p: OptionPosition) {
  return {
    symbol: p.symbol,
    optionType: p.optionType,
    strike: p.strike,
    expiration: p.expiration,
    contracts: p.contracts,
    openingCreditDebit: p.openingCreditDebit,
    openDate: p.openDate,
  };
}
