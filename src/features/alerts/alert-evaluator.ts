/**
 * Alert evaluation engine.
 *
 * Checks each alert against current market data and determines
 * whether it should fire. Does NOT send notifications — that's a
 * separate concern (email, push, in-app). This module just evaluates.
 */

import "server-only";
import { getQuote, getExpirations, getOptionChain, getCorporateEvents } from "@/features/market-data/service";
import { computeAllIndicators } from "@/lib/calculations/indicators";
import { getHistoricalPrices } from "@/features/market-data/service";
import type { AlertEntry, AlertEvaluation } from "@/lib/types";

export async function evaluateAlerts(alerts: AlertEntry[]): Promise<AlertEvaluation[]> {
  const results: AlertEvaluation[] = [];

  // Group alerts by symbol to batch market data fetches.
  const bySymbol = new Map<string, AlertEntry[]>();
  for (const alert of alerts) {
    if (!alert.enabled) continue;
    const sym = alert.symbol ?? "_GLOBAL_";
    const list = bySymbol.get(sym) ?? [];
    list.push(alert);
    bySymbol.set(sym, list);
  }

  for (const [symbol, symbolAlerts] of bySymbol) {
    if (symbol === "_GLOBAL_") {
      // Global alerts (no symbol) — skip for now, would need portfolio-level data.
      for (const alert of symbolAlerts) {
        results.push({
          alert,
          currentValue: null,
          triggered: false,
          message: "Global alerts require portfolio-level evaluation.",
        });
      }
      continue;
    }

    try {
      const quote = await getQuote({ symbol });
      const price = quote.data.price;

      for (const alert of symbolAlerts) {
        const evalResult = await evaluateOne(alert, symbol, price);
        results.push(evalResult);
      }
    } catch {
      for (const alert of symbolAlerts) {
        results.push({
          alert,
          currentValue: null,
          triggered: false,
          message: "Failed to fetch market data.",
        });
      }
    }
  }

  return results;
}

async function evaluateOne(alert: AlertEntry, symbol: string, price: number): Promise<AlertEvaluation> {
  const { ruleType, parameters } = alert;
  const threshold = parameters.threshold;

  switch (ruleType) {
    case "price_above": {
      if (threshold == null) return noThreshold(alert);
      return {
        alert,
        currentValue: price,
        triggered: price >= threshold,
        message: `${symbol} at $${price.toFixed(2)} ${price >= threshold ? "≥" : "<"} target $${threshold.toFixed(2)}`,
      };
    }

    case "price_below": {
      if (threshold == null) return noThreshold(alert);
      return {
        alert,
        currentValue: price,
        triggered: price <= threshold,
        message: `${symbol} at $${price.toFixed(2)} ${price <= threshold ? "≤" : ">"} target $${threshold.toFixed(2)}`,
      };
    }

    case "iv_above":
    case "iv_below": {
      try {
        const hist = await getHistoricalPrices({ symbol, range: "1y" });
        const indicators = computeAllIndicators(hist.data.points, symbol);
        // Use ATM IV from Bollinger volatility as a proxy if no option IV available.
        const atmIv = indicators.atr.currentAsPercent; // ATR% as volatility proxy
        if (threshold == null) return noThreshold(alert);
        const triggered = ruleType === "iv_above" ? (atmIv ?? 0) >= threshold : (atmIv ?? 0) <= threshold;
        return {
          alert,
          currentValue: atmIv,
          triggered,
          message: `${symbol} volatility ${(atmIv ?? 0).toFixed(4)} ${triggered ? "triggered" : "not triggered"} vs ${threshold}`,
        };
      } catch {
        return { alert, currentValue: null, triggered: false, message: "Failed to fetch IV data." };
      }
    }

    case "yield_above":
    case "yield_below": {
      try {
        const expirations = await getExpirations({ symbol });
        const firstExp = expirations.data[0];
        if (!firstExp) return { alert, currentValue: null, triggered: false, message: "No expirations available." };
        const chain = await getOptionChain({ symbol, expiration: firstExp.expirationDate });
        const spot = chain.data.underlyingPrice;
        // Find the call with highest premium yield.
        let bestYield = 0;
        for (const c of chain.data.calls) {
          const premium = c.midpoint ?? c.last ?? 0;
          const yield_ = premium / spot;
          if (yield_ > bestYield) bestYield = yield_;
        }
        if (threshold == null) return noThreshold(alert);
        const triggered = ruleType === "yield_above" ? bestYield >= threshold : bestYield <= threshold;
        return {
          alert,
          currentValue: bestYield,
          triggered,
          message: `${symbol} best call yield ${(bestYield * 100).toFixed(2)}% ${triggered ? "triggered" : "not triggered"} vs ${(threshold * 100).toFixed(2)}%`,
        };
      } catch {
        return { alert, currentValue: null, triggered: false, message: "Failed to fetch chain data." };
      }
    }

    case "earnings_within_days": {
      try {
        const events = await getCorporateEvents({ symbol });
        const today = new Date();
        const next = events.data.earnings
          .filter((e) => new Date(e.date) >= today)
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
        if (!next) return { alert, currentValue: null, triggered: false, message: "No upcoming earnings." };
        const daysUntil = Math.round((new Date(next.date).getTime() - today.getTime()) / 86400000);
        if (threshold == null) return noThreshold(alert);
        const triggered = daysUntil <= threshold;
        return {
          alert,
          currentValue: daysUntil,
          triggered,
          message: `${symbol} earnings in ${daysUntil} days ${triggered ? "≤" : ">"} ${threshold} day threshold`,
        };
      } catch {
        return { alert, currentValue: null, triggered: false, message: "Failed to fetch earnings data." };
      }
    }

    case "delta_above":
    case "delta_below": {
      try {
        const expirations = await getExpirations({ symbol });
        const firstExp = expirations.data[0];
        if (!firstExp) return { alert, currentValue: null, triggered: false, message: "No expirations available." };
        const chain = await getOptionChain({ symbol, expiration: firstExp.expirationDate });
        const spot = chain.data.underlyingPrice;
        // Find ATM call delta.
        const firstCall = chain.data.calls[0];
        if (!firstCall) return { alert, currentValue: null, triggered: false, message: "No calls in chain." };
        const atmCall = chain.data.calls.reduce((best, c) => {
          return Math.abs(c.strike - spot) < Math.abs(best.strike - spot) ? c : best;
        }, firstCall);
        const delta = atmCall?.greeks?.delta ?? null;
        if (threshold == null) return noThreshold(alert);
        const triggered = ruleType === "delta_above" ? (delta ?? 0) >= threshold : (delta ?? 0) <= threshold;
        return {
          alert,
          currentValue: delta,
          triggered,
          message: `${symbol} ATM call delta ${(delta ?? 0).toFixed(3)} ${triggered ? "triggered" : "not triggered"} vs ${threshold}`,
        };
      } catch {
        return { alert, currentValue: null, triggered: false, message: "Failed to fetch delta data." };
      }
    }

    case "assignment_risk_above": {
      // Would need portfolio positions to evaluate.
      return { alert, currentValue: null, triggered: false, message: "Assignment risk alerts require portfolio positions." };
    }

    default:
      return { alert, currentValue: null, triggered: false, message: `Unknown rule type: ${ruleType}` };
  }
}

function noThreshold(alert: AlertEntry): AlertEvaluation {
  return {
    alert,
    currentValue: null,
    triggered: false,
    message: `Alert ${alert.ruleType} has no threshold set.`,
  };
}
