/**
 * Market regime service.
 *
 * Resolves a VIX level and SPY history, then classifies the regime. Shared by
 * the AI tool and the HTTP route so both report identical numbers and identical
 * caveats about where VIX came from.
 */

import "server-only";
import { getHistoricalPrices, getQuote } from "@/features/market-data/service";
import { classifyMarketRegime, type RegimeResult } from "@/lib/calculations/market-regime";

/** Ticker spellings different providers use for the volatility index. */
const VIX_SYMBOLS = ["VIX", "$VIX.X", "^VIX"];

export interface RegimeSnapshot extends RegimeResult {
  vixSource: "provider" | "estimated_from_spy_realized_vol";
  warnings: string[];
}

export async function getMarketRegimeSnapshot(): Promise<RegimeSnapshot> {
  const warnings: string[] = [];
  const spyHist = await getHistoricalPrices({ symbol: "SPY", range: "3y" });
  const points = spyHist.data.points;

  let vix: number | null = null;
  for (const candidate of VIX_SYMBOLS) {
    try {
      const q = await getQuote({ symbol: candidate });
      if (q.data.price > 0) {
        vix = q.data.price;
        break;
      }
    } catch {
      // Try the next spelling.
    }
  }

  let vixSource: RegimeSnapshot["vixSource"] = "provider";

  if (vix == null) {
    vix = spyRealizedVolAsVixPoints(points) ?? 18;
    vixSource = "estimated_from_spy_realized_vol";
    warnings.push(
      "VIX was unavailable from the market-data provider, so it was estimated from SPY 30-day realized volatility. Realized volatility normally sits below implied VIX, so the regime may read calmer than the options market implies.",
    );
  }

  if (points.length < 200) {
    warnings.push(
      `Only ${points.length} trading days of SPY history were available; the 200-day moving average could not be computed reliably, so the trend reading is weak.`,
    );
  }

  const regime = classifyMarketRegime(vix, points);
  return { ...regime, vixSource, warnings };
}

/** Annualized 30-day realized volatility of SPY, expressed in VIX-style points. */
function spyRealizedVolAsVixPoints(
  points: { adjustedClose: number }[],
): number | null {
  const window = points.slice(-31);
  const rets: number[] = [];
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1];
    const curr = window[i];
    if (!prev || !curr) continue;
    const r = Math.log(curr.adjustedClose / prev.adjustedClose);
    if (Number.isFinite(r)) rets.push(r);
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}
