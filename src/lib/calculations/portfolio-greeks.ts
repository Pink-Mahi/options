/**
 * Portfolio-level Greeks aggregation and assignment risk analysis.
 *
 * Aggregates delta, gamma, theta, vega exposure across all open option
 * positions and stock lots. Short calls have negative delta exposure (from
 * the seller's perspective), long stock has +1 delta per share.
 *
 * Also computes assignment risk: for each open short call/put, estimates
 * probability of assignment based on entry delta and current DTE.
 */

import "server-only";
import { getQuote, getOptionChain, getExpirations } from "@/features/market-data/service";
import type { Portfolio, OptionPosition } from "@/lib/types";

export interface PortfolioGreeks {
  stockDelta: number; // total delta from stock holdings (shares * 1)
  optionDelta: number; // total delta from short options (negative for short calls)
  totalDelta: number; // stockDelta + optionDelta
  totalDeltaDollars: number; // $ exposure per 1% move
  optionGamma: number;
  optionTheta: number; // $/day from options
  optionVega: number; // $ per 1% IV change
  netTheta: number; // theta income per day (positive = you collect)
  positions: PositionGreeks[];
  assignmentRisk: {
    symbol: string;
    positionId: string;
    optionType: "CALL" | "PUT";
    strike: number;
    expiration: string;
    dte: number;
    currentPrice: number;
    intrinsicValue: number;
    itm: boolean;
    estimatedAssignmentProb: number;
    contracts: number;
    sharesAtRisk: number;
  }[];
  warnings: string[];
}

export interface PositionGreeks {
  positionId: string;
  symbol: string;
  optionType: "CALL" | "PUT";
  strike: number;
  expiration: string;
  contracts: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  deltaDollars: number;
}

export async function calculatePortfolioGreeks(portfolio: Portfolio): Promise<PortfolioGreeks> {
  const warnings: string[] = [];
  const openPositions = portfolio.optionPositions.filter((p) => p.status === "OPEN");

  // Stock delta: 1 per share owned.
  const stockDelta = portfolio.stockLots.reduce((s, lot) => s + lot.shares, 0);

  // Fetch current quotes and option chains for each open position.
  const positionGreeks: PositionGreeks[] = [];
  const assignmentRisk: PortfolioGreeks["assignmentRisk"] = [];

  // Group positions by symbol to batch fetches.
  const bySymbol = new Map<string, OptionPosition[]>();
  for (const p of openPositions) {
    const list = bySymbol.get(p.symbol) ?? [];
    list.push(p);
    bySymbol.set(p.symbol, list);
  }

  for (const [symbol, positions] of bySymbol) {
    try {
      const [quote, expirations] = await Promise.all([
        getQuote({ symbol }).catch(() => null),
        getExpirations({ symbol }).catch(() => null),
      ]);
      if (!quote) {
        warnings.push(`Could not fetch quote for ${symbol}.`);
        continue;
      }
      const currentPrice = quote.data.price;

      for (const pos of positions) {
        // Try to fetch the chain for this position's expiration.
        let chain = null;
        if (expirations) {
          const expExists = expirations.data.some((e) => e.expirationDate === pos.expiration);
          if (expExists) {
            chain = await getOptionChain({ symbol, expiration: pos.expiration }).catch(() => null);
          }
        }

        // Find the matching contract.
        const list = pos.optionType === "CALL" ? chain?.data.calls : chain?.data.puts;
        const contract = list?.find((c) => Math.abs(c.strike - pos.strike) < 1e-6);

        // Use current greeks if available, otherwise fall back to entry delta.
        const delta = contract?.greeks.delta ?? pos.deltaAtEntry ?? 0;
        const gamma = contract?.greeks.gamma ?? 0;
        const theta = contract?.greeks.theta ?? 0;
        const vega = contract?.greeks.vega ?? 0;

        // For short options, negate the greeks (seller's perspective).
        const signedDelta = -delta * pos.contracts * 100;
        const signedGamma = -gamma * pos.contracts * 100;
        const signedTheta = -theta * pos.contracts * 100; // positive = you collect decay
        const signedVega = -vega * pos.contracts * 100;

        positionGreeks.push({
          positionId: pos.id,
          symbol,
          optionType: pos.optionType,
          strike: pos.strike,
          expiration: pos.expiration,
          contracts: pos.contracts,
          delta: signedDelta,
          gamma: signedGamma,
          theta: signedTheta,
          vega: signedVega,
          deltaDollars: signedDelta * currentPrice / 100,
        });

        // Assignment risk.
        const dte = Math.max(0, Math.round((new Date(pos.expiration).getTime() - Date.now()) / 86400000));
        const intrinsic = pos.optionType === "CALL"
          ? Math.max(0, currentPrice - pos.strike)
          : Math.max(0, pos.strike - currentPrice);
        const itm = intrinsic > 0;
        // Assignment probability ≈ |delta| (the option buyer's exercise probability).
        // When DTE → 0 and the option is ITM, assignment is nearly certain, so
        // we blend delta toward 1.0 as expiration approaches to reflect that
        // an ITM option at expiration will almost certainly be assigned.
        let assignProb: number;
        if (itm && dte <= 1) {
          // At expiration, ITM = certain assignment.
          assignProb = 1;
        } else if (itm) {
          // Near expiration ITM: delta is a good proxy, but as DTE shrinks the
          // probability of the stock moving back OTM drops. We scale delta up
          // proportionally as time decays, capped at 1.
          const timeFactor = Math.max(0, 1 - (7 - dte) / 14); // 0 at dte=0, ~0.5 at dte=7
          assignProb = Math.min(1, Math.abs(delta) + (1 - Math.abs(delta)) * timeFactor);
        } else {
          // OTM: assignment probability ≈ |delta| (chance of moving ITM).
          assignProb = Math.abs(delta);
        }

        assignmentRisk.push({
          symbol,
          positionId: pos.id,
          optionType: pos.optionType,
          strike: pos.strike,
          expiration: pos.expiration,
          dte,
          currentPrice,
          intrinsicValue: intrinsic,
          itm,
          estimatedAssignmentProb: assignProb,
          contracts: pos.contracts,
          sharesAtRisk: pos.contracts * 100,
        });
      }
    } catch {
      warnings.push(`Failed to fetch market data for ${symbol}.`);
    }
  }

  const optionDelta = positionGreeks.reduce((s, g) => s + g.delta, 0);
  const optionGamma = positionGreeks.reduce((s, g) => s + g.gamma, 0);
  const optionTheta = positionGreeks.reduce((s, g) => s + g.theta, 0);
  const optionVega = positionGreeks.reduce((s, g) => s + g.vega, 0);
  const totalDelta = stockDelta + optionDelta;

  // Dollar delta: how many dollars move per 1% stock move.
  // Approximate using average portfolio price — more accurate would weight by symbol.
  const totalDeltaDollars = positionGreeks.reduce((s, g) => s + g.deltaDollars, 0);

  // Net theta: positive means you're collecting time decay.
  const netTheta = optionTheta;

  return {
    stockDelta,
    optionDelta,
    totalDelta,
    totalDeltaDollars,
    optionGamma,
    optionTheta,
    optionVega,
    netTheta,
    positions: positionGreeks,
    assignmentRisk: assignmentRisk.sort((a, b) => b.estimatedAssignmentProb - a.estimatedAssignmentProb),
    warnings,
  };
}
