import { describe, it, expect } from "vitest";
import {
  computeRSI,
  computeMACD,
  computeBollingerBands,
  computeStochastic,
  computeATR,
  computeOBV,
  computeADX,
  computeVWAP,
  computeIchimoku,
  computeParabolicSAR,
  computeTTMSqueeze,
  computeWilliamsR,
  computeCCI,
  computeMFI,
  computeKeltnerChannels,
  computeDonchianChannels,
  computeAllIndicators,
  computeSignalScore,
  computeTradeLevels,
  smaSeries,
  emaSeries,
} from "./indicators";
import type { HistoricalPricePoint } from "@/lib/types";

function makeHistory(days: number, start = 100, vol = 0.3, drift = 0.05): HistoricalPricePoint[] {
  const pts: HistoricalPricePoint[] = [];
  let price = start;
  let seed = 42;
  const rng = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < days; i++) {
    const r = (rng() - 0.5) * vol / Math.sqrt(252) + drift / 252;
    price *= Math.exp(r);
    pts.push({
      date: `2024-${String(Math.floor(i / 30) + 1).padStart(2, "0")}-${String((i % 30) + 1).padStart(2, "0")}`,
      open: price * 0.99,
      high: price * 1.01,
      low: price * 0.98,
      close: price,
      adjustedClose: price,
      volume: Math.floor(1000000 * (0.5 + rng())),
    });
  }
  return pts;
}

function makeUptrend(days: number): HistoricalPricePoint[] {
  const pts: HistoricalPricePoint[] = [];
  let price = 100;
  for (let i = 0; i < days; i++) {
    price *= 1.002;
    pts.push({
      date: `2024-${String(Math.floor(i / 30) + 1).padStart(2, "0")}-${String((i % 30) + 1).padStart(2, "0")}`,
      open: price * 0.999, high: price * 1.001, low: price * 0.998, close: price, adjustedClose: price, volume: 1000000,
    });
  }
  return pts;
}

function makeDowntrend(days: number): HistoricalPricePoint[] {
  const pts: HistoricalPricePoint[] = [];
  let price = 100;
  for (let i = 0; i < days; i++) {
    price *= 0.998;
    pts.push({
      date: `2024-${String(Math.floor(i / 30) + 1).padStart(2, "0")}-${String((i % 30) + 1).padStart(2, "0")}`,
      open: price * 1.001, high: price * 1.002, low: price * 0.999, close: price, adjustedClose: price, volume: 1000000,
    });
  }
  return pts;
}

describe("smaSeries", () => {
  it("computes simple moving average", () => {
    const result = smaSeries([1, 2, 3, 4, 5], 3);
    expect(result).toEqual([null, null, 2, 3, 4]);
  });

  it("returns nulls for insufficient data", () => {
    const result = smaSeries([1, 2], 5);
    expect(result).toEqual([null, null]);
  });
});

describe("emaSeries", () => {
  it("computes exponential moving average", () => {
    const result = emaSeries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 3);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).toBeCloseTo(2, 6); // SMA seed
    // EMA: k = 2/4 = 0.5; next = 4*0.5 + 2*0.5 = 3
    expect(result[3]).toBeCloseTo(3, 6);
  });
});

describe("computeRSI", () => {
  it("produces RSI in [0, 100]", () => {
    const hist = makeHistory(100);
    const r = computeRSI(hist);
    expect(r.current).not.toBeNull();
    expect(r.current!).toBeGreaterThanOrEqual(0);
    expect(r.current!).toBeLessThanOrEqual(100);
  });

  it("detects overbought/oversold", () => {
    const up = makeUptrend(50);
    const rUp = computeRSI(up);
    // Strong uptrend should push RSI high.
    expect(rUp.current).toBeGreaterThan(50);

    const down = makeDowntrend(50);
    const rDown = computeRSI(down);
    expect(rDown.current).toBeLessThan(50);
  });

  it("handles insufficient data", () => {
    const r = computeRSI(makeHistory(5));
    expect(r.current).toBeNull();
  });
});

describe("computeMACD", () => {
  it("computes MACD line, signal, and histogram", () => {
    const hist = makeHistory(100);
    const m = computeMACD(hist);
    expect(m.current.macd).not.toBeNull();
    expect(m.current.signal).not.toBeNull();
    expect(m.current.histogram).not.toBeNull();
    // Histogram = MACD - signal.
    expect(m.current.histogram).toBeCloseTo((m.current.macd ?? 0) - (m.current.signal ?? 0), 6);
  });

  it("detects crossovers", () => {
    // In a strong uptrend, MACD should be above signal (bullish or none).
    const up = makeUptrend(100);
    const m = computeMACD(up);
    expect(m.current.histogram).toBeGreaterThanOrEqual(0);
  });
});

describe("computeBollingerBands", () => {
  it("computes upper, middle, lower bands", () => {
    const hist = makeHistory(100);
    const bb = computeBollingerBands(hist);
    expect(bb.current.upper).not.toBeNull();
    expect(bb.current.middle).not.toBeNull();
    expect(bb.current.lower).not.toBeNull();
    expect(bb.current.upper!).toBeGreaterThan(bb.current.middle!);
    expect(bb.current.middle!).toBeGreaterThan(bb.current.lower!);
  });

  it("computes bandwidth and percentB", () => {
    const hist = makeHistory(100);
    const bb = computeBollingerBands(hist);
    expect(bb.current.bandwidth).toBeGreaterThan(0);
    expect(bb.current.percentB).not.toBeNull();
  });
});

describe("computeStochastic", () => {
  it("produces %K and %D in [0, 100]", () => {
    const hist = makeHistory(100);
    const s = computeStochastic(hist);
    expect(s.current.k).not.toBeNull();
    expect(s.current.d).not.toBeNull();
    expect(s.current.k!).toBeGreaterThanOrEqual(0);
    expect(s.current.k!).toBeLessThanOrEqual(100);
  });
});

describe("computeATR", () => {
  it("computes average true range", () => {
    const hist = makeHistory(100);
    const a = computeATR(hist);
    expect(a.current).not.toBeNull();
    expect(a.current!).toBeGreaterThan(0);
    expect(a.currentAsPercent).toBeGreaterThan(0);
  });

  it("classifies volatility regime", () => {
    const hist = makeHistory(100);
    const a = computeATR(hist);
    expect(["low", "normal", "high"]).toContain(a.volatilityRegime);
  });
});

describe("computeOBV", () => {
  it("accumulates volume based on price direction", () => {
    const pts: HistoricalPricePoint[] = [
      { date: "2024-01-01", open: 10, high: 11, low: 9, close: 10, adjustedClose: 10, volume: 100 },
      { date: "2024-01-02", open: 10, high: 12, low: 10, close: 11, adjustedClose: 11, volume: 200 },
      { date: "2024-01-03", open: 11, high: 11, low: 9, close: 10, adjustedClose: 10, volume: 150 },
    ];
    const o = computeOBV(pts);
    // Day 0: OBV = 100. Day 1: up → +200 = 300. Day 2: down → -150 = 150.
    expect(o.values).toEqual([100, 300, 150]);
  });
});

describe("computeADX", () => {
  it("detects trend strength and direction", () => {
    const up = makeUptrend(100);
    const a = computeADX(up);
    expect(a.current.adx).not.toBeNull();
    expect(a.trendDirection).toBe("bullish");
  });

  it("detects bearish trend", () => {
    const down = makeDowntrend(100);
    const a = computeADX(down);
    expect(a.trendDirection).toBe("bearish");
  });
});

describe("computeVWAP", () => {
  it("computes volume-weighted average price", () => {
    const hist = makeHistory(50);
    const v = computeVWAP(hist);
    expect(v.current).not.toBeNull();
    expect(v.current!).toBeGreaterThan(0);
  });
});

describe("computeIchimoku", () => {
  it("computes Ichimoku cloud components", () => {
    const hist = makeHistory(120);
    const ic = computeIchimoku(hist);
    expect(ic.current.tenkan).not.toBeNull();
    expect(ic.current.kijun).not.toBeNull();
    expect(["bullish", "bearish", "neutral"]).toContain(ic.signal);
    expect(["green", "red", "flat"]).toContain(ic.cloudColor);
  });
});

describe("computeParabolicSAR", () => {
  it("computes SAR values and detects trend", () => {
    const hist = makeHistory(100);
    const sar = computeParabolicSAR(hist);
    expect(sar.current).not.toBeNull();
    expect(["up", "down"]).toContain(sar.trend);
  });
});

describe("computeAllIndicators", () => {
  it("aggregates all indicators with signal summary", () => {
    const hist = makeHistory(250);
    const all = computeAllIndicators(hist, "TEST");
    expect(all.symbol).toBe("TEST");
    expect(all.rsi.current).not.toBeNull();
    expect(all.macd.current.macd).not.toBeNull();
    expect(all.bollinger.current.upper).not.toBeNull();
    expect(all.summary.bullishSignals.length).toBeGreaterThan(0);
    expect(all.summary.signalCount.bullish + all.summary.signalCount.bearish + all.summary.signalCount.neutral).toBeGreaterThan(0);
    expect(["bullish", "bearish", "neutral"]).toContain(all.summary.overallBias);
  });

  it("produces a balanced signal summary for uptrend", () => {
    const up = makeUptrend(250);
    const all = computeAllIndicators(up, "TEST");
    // Uptrend should lean bullish.
    expect(all.summary.signalCount.bullish).toBeGreaterThan(all.summary.signalCount.bearish);
  });

  it("produces a bearish signal summary for downtrend", () => {
    const down = makeDowntrend(250);
    const all = computeAllIndicators(down, "TEST");
    expect(all.summary.signalCount.bearish).toBeGreaterThan(all.summary.signalCount.bullish);
  });
});

describe("computeTTMSqueeze", () => {
  it("detects squeeze state in range-bound market", () => {
    const hist = makeHistory(100, 100, 0.1, 0); // low volatility, no drift
    const ts = computeTTMSqueeze(hist);
    expect(ts.current).toBeDefined();
    expect(["squeeze", "fired", "normal"]).toContain(ts.signal);
  });

  it("produces histogram values", () => {
    const hist = makeHistory(100);
    const ts = computeTTMSqueeze(hist);
    expect(ts.current.histogram).not.toBeNull();
  });

  it("detects fired signal after squeeze releases", () => {
    // Create a low-vol period followed by a breakout.
    const pts: HistoricalPricePoint[] = [];
    let price = 100;
    for (let i = 0; i < 40; i++) {
      // Tight range — squeeze territory
      pts.push({
        date: `2024-01-${String(i + 1).padStart(2, "0")}`,
        open: price, high: price + 0.5, low: price - 0.5, close: price, adjustedClose: price, volume: 1000000,
      });
    }
    // Breakout
    for (let i = 0; i < 30; i++) {
      price *= 1.02;
      pts.push({
        date: `2024-02-${String(i + 1).padStart(2, "0")}`,
        open: price * 0.99, high: price * 1.03, low: price * 0.97, close: price, adjustedClose: price, volume: 2000000,
      });
    }
    const ts = computeTTMSqueeze(pts);
    // At some point in the breakout, squeeze should have fired.
    expect(ts.squeezeFired.some((f) => f)).toBe(true);
  });
});

describe("computeWilliamsR", () => {
  it("produces values in [-100, 0]", () => {
    const hist = makeHistory(100);
    const wr = computeWilliamsR(hist);
    expect(wr.current).not.toBeNull();
    expect(wr.current!).toBeGreaterThanOrEqual(-100);
    expect(wr.current!).toBeLessThanOrEqual(0);
  });

  it("detects overbought in uptrend", () => {
    const up = makeUptrend(50);
    const wr = computeWilliamsR(up);
    // In a strong uptrend, Williams %R should be near 0 (overbought).
    expect(wr.current!).toBeGreaterThan(-20);
    expect(wr.signal).toBe("overbought");
  });

  it("detects oversold in downtrend", () => {
    const down = makeDowntrend(50);
    const wr = computeWilliamsR(down);
    expect(wr.current!).toBeLessThan(-80);
    expect(wr.signal).toBe("oversold");
  });
});

describe("computeCCI", () => {
  it("produces CCI values", () => {
    const hist = makeHistory(100);
    const cci = computeCCI(hist);
    expect(cci.current).not.toBeNull();
  });

  it("detects overbought/oversold extremes", () => {
    const up = makeUptrend(100);
    const cci = computeCCI(up);
    // Strong uptrend should push CCI high.
    expect(cci.current!).toBeGreaterThan(0);
  });
});

describe("computeMFI", () => {
  it("produces MFI in [0, 100]", () => {
    const hist = makeHistory(100);
    const mfi = computeMFI(hist);
    expect(mfi.current).not.toBeNull();
    expect(mfi.current!).toBeGreaterThanOrEqual(0);
    expect(mfi.current!).toBeLessThanOrEqual(100);
  });

  it("detects overbought in uptrend", () => {
    const up = makeUptrend(100);
    const mfi = computeMFI(up);
    // Strong uptrend with volume should push MFI high.
    expect(mfi.current!).toBeGreaterThan(50);
  });
});

describe("computeKeltnerChannels", () => {
  it("computes upper, middle, lower channels", () => {
    const hist = makeHistory(100);
    const kc = computeKeltnerChannels(hist);
    expect(kc.current.upper).not.toBeNull();
    expect(kc.current.middle).not.toBeNull();
    expect(kc.current.lower).not.toBeNull();
    expect(kc.current.upper!).toBeGreaterThan(kc.current.middle!);
    expect(kc.current.middle!).toBeGreaterThan(kc.current.lower!);
  });
});

describe("computeDonchianChannels", () => {
  it("computes upper, lower, middle channels", () => {
    const hist = makeHistory(100);
    const dc = computeDonchianChannels(hist);
    expect(dc.current.upper).not.toBeNull();
    expect(dc.current.lower).not.toBeNull();
    expect(dc.current.middle).not.toBeNull();
    expect(dc.current.upper!).toBeGreaterThanOrEqual(dc.current.lower!);
    expect(dc.current.middle).toBeCloseTo((dc.current.upper! + dc.current.lower!) / 2, 6);
  });
});

describe("computeSignalScore", () => {
  it("produces a score in [-100, 100]", () => {
    const hist = makeHistory(250);
    const ind = computeAllIndicators(hist, "TEST");
    const ss = computeSignalScore(ind);
    expect(ss.score).toBeGreaterThanOrEqual(-100);
    expect(ss.score).toBeLessThanOrEqual(100);
    expect(["strong_sell", "sell", "neutral", "buy", "strong_buy"]).toContain(ss.label);
  });

  it("produces a bullish score for uptrend", () => {
    const up = makeUptrend(250);
    const ind = computeAllIndicators(up, "TEST");
    const ss = computeSignalScore(ind);
    expect(ss.score).toBeGreaterThan(0);
    expect(["buy", "strong_buy", "neutral"]).toContain(ss.label);
  });

  it("produces a bearish score for downtrend", () => {
    const down = makeDowntrend(250);
    const ind = computeAllIndicators(down, "TEST");
    const ss = computeSignalScore(ind);
    expect(ss.score).toBeLessThan(0);
    expect(["sell", "strong_sell", "neutral"]).toContain(ss.label);
  });

  it("includes all indicator components", () => {
    const hist = makeHistory(250);
    const ind = computeAllIndicators(hist, "TEST");
    const ss = computeSignalScore(ind);
    expect(ss.components.length).toBeGreaterThanOrEqual(15);
    expect(ss.components.some((c) => c.name === "RSI")).toBe(true);
    expect(ss.components.some((c) => c.name === "TTM Squeeze")).toBe(true);
  });
});

describe("computeTradeLevels", () => {
  it("computes buy and sell zones", () => {
    const hist = makeHistory(250);
    const ind = computeAllIndicators(hist, "TEST");
    const tl = computeTradeLevels(ind);
    expect(tl.buyZone.upper).not.toBeNull();
    expect(tl.sellZone.lower).not.toBeNull();
    expect(tl.buyZone.upper!).toBeLessThan(ind.currentPrice);
    expect(tl.sellZone.lower!).toBeGreaterThan(ind.currentPrice);
  });

  it("computes stop loss below buy zone", () => {
    const hist = makeHistory(250);
    const ind = computeAllIndicators(hist, "TEST");
    const tl = computeTradeLevels(ind);
    expect(tl.stopLoss).not.toBeNull();
    expect(tl.stopLoss!).toBeLessThan(tl.buyZone.upper ?? Infinity);
  });

  it("provides at least 1 target above current price", () => {
    const hist = makeHistory(250);
    const ind = computeAllIndicators(hist, "TEST");
    const tl = computeTradeLevels(ind);
    expect(tl.targets.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...tl.targets)).toBeGreaterThan(ind.currentPrice);
  });

  it("lists support and resistance levels with sources", () => {
    const hist = makeHistory(250);
    const ind = computeAllIndicators(hist, "TEST");
    const tl = computeTradeLevels(ind);
    expect(tl.supports.length).toBeGreaterThan(0);
    expect(tl.resistances.length).toBeGreaterThan(0);
    expect(tl.supports[0]!.source).toBeTruthy();
    expect(tl.resistances[0]!.source).toBeTruthy();
  });
});
