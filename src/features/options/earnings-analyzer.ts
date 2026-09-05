/**
 * Earnings analysis: historical reactions, IV crush, and strategy implications.
 *
 * Analyzes how a stock has historically moved after earnings announcements
 * and estimates the expected move and IV crush for the next earnings event.
 *
 * Deterministic given historical data. The AI layer adds interpretation.
 */

import "server-only";
import { getHistoricalPrices, getCorporateEvents, getExpirations, getOptionChain, getQuote } from "@/features/market-data/service";
import type { EarningsAnalysis, EarningsHistoricalReaction, HistoricalPricePoint } from "@/lib/types";

export async function analyzeEarnings(symbol: string): Promise<EarningsAnalysis> {
  const warnings: string[] = [];

  const [eventsRes, histRes] = await Promise.all([
    getCorporateEvents({ symbol }).catch(() => null),
    getHistoricalPrices({ symbol, range: "5y" }).catch(() => null),
  ]);

  // Next earnings date.
  const earningsEvents = eventsRes?.data.earnings ?? [];
  const today = new Date();
  const futureEarnings = earningsEvents
    .filter((e) => new Date(e.date) >= today)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const nextEarnings = futureEarnings[0] ?? null;
  const daysUntil = nextEarnings
    ? Math.round((new Date(nextEarnings.date).getTime() - today.getTime()) / 86400000)
    : null;

  // Historical earnings reactions: find earnings dates in price history and
  // measure the move from the close before earnings to the close after.
  const reactions: EarningsHistoricalReaction[] = [];
  const points = histRes?.data.points ?? [];

  if (points.length > 60) {
    // We don't have actual EPS data from the provider, so we estimate
    // the earnings move by looking at large overnight gaps.
    // A more complete implementation would fetch earnings calendar with EPS data.
    const pastEarnings = earningsEvents
      .filter((e) => new Date(e.date) < today)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 12);

    for (const e of pastEarnings) {
      const reaction = measureEarningsReaction(points, e.date);
      if (reaction) reactions.push(reaction);
    }

    // If we don't have earnings events from the provider, estimate from
    // large overnight gaps (top 12 gaps in last 3 years).
    if (reactions.length === 0) {
      warnings.push("No earnings calendar data available — estimating earnings dates from large overnight gaps.");
      const gaps = findLargeGaps(points, 12);
      for (const g of gaps) {
        reactions.push({
          date: g.date,
          actualEps: null,
          estimatedEps: null,
          surprise: null,
          surprisePercent: null,
          priceMovePercent: g.gapPercent,
          direction: g.gapPercent > 0.01 ? "up" : g.gapPercent < -0.01 ? "down" : "flat",
          preEarningsClose: g.prevClose,
          postEarningsClose: g.nextClose,
        });
      }
    }
  }

  // Statistics.
  const moves = reactions.map((r) => r.priceMovePercent).filter((m): m is number => m != null);
  const absMoves = moves.map(Math.abs);
  const sortedMoves = [...moves].sort((a, b) => a - b);
  const sortedAbs = [...absMoves].sort((a, b) => a - b);

  const stats = {
    avgMovePercent: moves.length > 0 ? absMoves.reduce((s, m) => s + m, 0) / moves.length : null,
    medianMovePercent: sortedAbs.length > 0 ? sortedAbs[Math.floor(sortedAbs.length / 2)] ?? null : null,
    maxUpMove: moves.length > 0 ? Math.max(...moves) : null,
    maxDownMove: moves.length > 0 ? Math.min(...moves) : null,
    beatRate: null, // Can't compute without EPS data
    avgSurprisePercent: null,
    upMoveFrequency: moves.length > 0 ? moves.filter((m) => m > 0).length / moves.length : null,
    sampleSize: reactions.length,
  };

  // Expected move for next earnings.
  let atmIv: number | null = null;
  let dte: number | null = null;
  try {
    const quote = await getQuote({ symbol });
    const expirations = await getExpirations({ symbol });
    // Find the expiration closest to the earnings date (or the nearest one).
    const targetDate = nextEarnings ? new Date(nextEarnings.date) : new Date(Date.now() + 30 * 86400000);
    const nearest = expirations.data
      .map((e) => ({ ...e, dist: Math.abs(new Date(e.expirationDate).getTime() - targetDate.getTime()) }))
      .sort((a, b) => a.dist - b.dist)[0];
    if (nearest) {
      const chain = await getOptionChain({ symbol, expiration: nearest.expirationDate });
      const spot = chain.data.underlyingPrice;
      const all = [...chain.data.calls, ...chain.data.puts];
      const first = all[0];
      if (first) {
        const atm = all.reduce((best, c) => {
          return Math.abs(c.strike - spot) < Math.abs(best.strike - spot) ? c : best;
        }, first);
        atmIv = atm?.impliedVolatility ?? null;
        dte = atm?.daysToExpiration ?? null;
      }
    }
  } catch {
    // IV data not available.
  }

  const expectedMove = {
    basedOnAvg: stats.avgMovePercent,
    basedOnMedian: stats.medianMovePercent,
    basedOnAtmIv: atmIv != null && dte != null
      ? atmIv * Math.sqrt(dte / 365) // 1 standard deviation as fraction of spot
      : null,
    note: "Expected move is a 1-standard-deviation estimate. Historical average is the mean of |post-earnings moves|. ATM IV is the implied move from the options market.",
  };

  // IV crush estimate: typically IV drops 30-50% after earnings for liquid stocks.
  const ivCrush = {
    typicalPostEarningsIvDropPercent: atmIv != null ? atmIv * 0.4 : null, // estimate 40% drop
    note: "IV typically drops 30-50% after earnings as uncertainty resolves. This is an estimate — actual crush varies by stock and event.",
  };

  // Strategy implications.
  const strategyImplications = generateStrategyImplications(nextEarnings, daysUntil, stats, atmIv, warnings);

  return {
    symbol,
    nextEarnings: {
      date: nextEarnings?.date ?? null,
      timing: nextEarnings?.timing ?? null,
      confirmed: nextEarnings?.confirmed ?? false,
      daysUntil,
    },
    historicalReactions: reactions,
    statistics: stats,
    expectedMove,
    ivCrush,
    strategyImplications,
    warnings,
  };
}

function measureEarningsReaction(points: HistoricalPricePoint[], earningsDate: string): EarningsHistoricalReaction | null {
  const target = new Date(earningsDate);
  // Find the trading day before and after the earnings date.
  let beforeIdx = -1;
  let afterIdx = -1;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p) continue;
    const d = new Date(p.date);
    if (d < target) beforeIdx = i;
    if (d > target && afterIdx === -1) {
      afterIdx = i;
      break;
    }
  }
  if (beforeIdx === -1 || afterIdx === -1) return null;
  const before = points[beforeIdx];
  const after = points[afterIdx];
  if (!before || !after) return null;

  const move = (after.close - before.close) / before.close;
  return {
    date: earningsDate,
    actualEps: null,
    estimatedEps: null,
    surprise: null,
    surprisePercent: null,
    priceMovePercent: move,
    direction: move > 0.01 ? "up" : move < -0.01 ? "down" : "flat",
    preEarningsClose: before.close,
    postEarningsClose: after.close,
  };
}

function findLargeGaps(points: HistoricalPricePoint[], count: number): { date: string; prevClose: number; nextClose: number; gapPercent: number }[] {
  const gaps: { date: string; prevClose: number; nextClose: number; gapPercent: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    if (!prev || !cur) continue;
    const gap = (cur.open - prev.close) / prev.close;
    // Only consider large gaps (>3% or <-3%) as potential earnings moves.
    if (Math.abs(gap) > 0.03) {
      gaps.push({ date: cur.date, prevClose: prev.close, nextClose: cur.close, gapPercent: (cur.close - prev.close) / prev.close });
    }
  }
  return gaps.sort((a, b) => Math.abs(b.gapPercent) - Math.abs(a.gapPercent)).slice(0, count);
}

function generateStrategyImplications(
  nextEarnings: { date: string; timing: string | null; confirmed: boolean } | null,
  daysUntil: number | null,
  stats: EarningsAnalysis["statistics"],
  atmIv: number | null,
  warnings: string[],
): string {
  const lines: string[] = [];

  if (!nextEarnings || daysUntil == null) {
    lines.push("No upcoming earnings date identified. Normal options strategy applies.");
    return lines.join("\n");
  }

  lines.push(`**Next earnings: ${nextEarnings.date} (${daysUntil} days away, ${nextEarnings.timing ?? "timing unknown"})**`);
  lines.push("");

  if (daysUntil <= 7) {
    lines.push("**Earnings imminent (within 7 days):**");
    lines.push("");
    lines.push("- **Covered calls:** High risk. If you sell a call expiring after earnings, you face significant assignment risk if the stock gaps up. The premium will be elevated due to IV, but so is the risk.");
    lines.push("- **Consider:** Selling calls that expire BEFORE earnings to capture premium without earnings risk. Or sell further OTM calls to reduce assignment probability.");
    lines.push("- **Cash-secured puts:** Selling puts through earnings is risky — a negative surprise could leave you assigned at a high cost basis. Consider waiting until after earnings to sell puts at better prices.");
    if (atmIv != null && atmIv > 0.5) {
      lines.push(`- **IV is elevated (${(atmIv * 100).toFixed(0)}%):** Premium is rich but IV crush after earnings will hurt buyers. As a seller, this favors you — but the stock move can overwhelm the premium.`);
    }
  } else if (daysUntil <= 30) {
    lines.push("**Earnings approaching (within 30 days):**");
    lines.push("");
    lines.push("- **Covered calls:** Be cautious about selling calls that expire after earnings. IV is rising, making premiums attractive, but assignment risk is real.");
    lines.push("- **Strategy:** Sell calls expiring before earnings for income without earnings risk. Or sell post-earnings calls further OTM to account for the expected move.");
    if (stats.avgMovePercent != null) {
      lines.push(`- **Historical avg earnings move:** ${(stats.avgMovePercent * 100).toFixed(1)}%. Price this into your strike selection.`);
    }
    lines.push("- **Cash-secured puts:** Premium is elevated approaching earnings. If you want to own the stock, selling puts through earnings can be a good entry strategy — but size for the worst-case historical move.");
  } else {
    lines.push(`**Earnings in ${daysUntil} days:**`);
    lines.push("");
    lines.push("- Normal options strategy applies. Earnings is far enough away that IV hasn't significantly inflated yet.");
    lines.push("- Consider shorter-DTE calls that expire well before earnings for consistent income without earnings risk.");
  }

  lines.push("");
  if (stats.avgMovePercent != null) {
    lines.push(`**Historical earnings moves:**`);
    lines.push(`- Average absolute move: ±${(stats.avgMovePercent * 100).toFixed(1)}%`);
    if (stats.maxUpMove != null) lines.push(`- Largest up move: +${(stats.maxUpMove * 100).toFixed(1)}%`);
    if (stats.maxDownMove != null) lines.push(`- Largest down move: ${(stats.maxDownMove * 100).toFixed(1)}%`);
    if (stats.upMoveFrequency != null) lines.push(`- Stock went up after earnings: ${(stats.upMoveFrequency * 100).toFixed(0)}% of the time (${stats.sampleSize} samples)`);
  }

  return lines.join("\n");
}
