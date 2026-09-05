import { describe, it, expect } from "vitest";
import {
  extractFeaturesAt,
  extractFeatureSeries,
  forwardReturn,
  MIN_HISTORY_BARS,
} from "./features";
import type { HistoricalPricePoint } from "@/lib/types";

function bar(date: string, close: number, volume = 1_000_000): HistoricalPricePoint {
  return {
    date,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    adjustedClose: close,
    volume,
  };
}

/** Deterministic series with a controllable drift and oscillation. */
function series(n: number, start = 100, drift = 0, amplitude = 0): HistoricalPricePoint[] {
  const out: HistoricalPricePoint[] = [];
  let price = start;
  for (let i = 0; i < n; i++) {
    price = price * (1 + drift) + amplitude * Math.sin(i / 5);
    const d = new Date(Date.UTC(2020, 0, 1));
    d.setUTCDate(d.getUTCDate() + i);
    out.push(bar(d.toISOString().slice(0, 10), Math.max(price, 1)));
  }
  return out;
}

describe("extractFeaturesAt - guards", () => {
  it("returns null for an out-of-range index", () => {
    const p = series(300);
    expect(extractFeaturesAt(p, -1)).toBeNull();
    expect(extractFeaturesAt(p, 300)).toBeNull();
  });

  it("returns null when history is too short", () => {
    const p = series(10);
    expect(extractFeaturesAt(p, 9)).toBeNull();
  });

  it("populates short-window features once 21 bars exist", () => {
    const p = series(300, 100, 0.001);
    const f = extractFeaturesAt(p, 25)!;
    expect(f).not.toBeNull();
    expect(f.zScore20).not.toBeNull();
    expect(f.rsi14).not.toBeNull();
    expect(f.momentum1m).not.toBeNull();
    // Not enough history for the 12-month window yet.
    expect(f.momentum12m).toBeNull();
  });
});

describe("extractFeaturesAt - no lookahead bias", () => {
  it("produces identical features when future bars are appended", () => {
    const base = series(300, 100, 0.0008, 0.4);
    const target = 260;

    const featuresWithoutFuture = extractFeaturesAt(base.slice(0, target + 1), target)!;
    const featuresWithFuture = extractFeaturesAt(base, target)!;

    // Every numeric field must match exactly. If any feature peeked ahead,
    // appending future bars would change it.
    expect(featuresWithFuture).toEqual(featuresWithoutFuture);
  });

  it("is unaffected by mutating a strictly future bar", () => {
    const base = series(300, 100, 0.0008, 0.4);
    const target = 250;
    const before = extractFeaturesAt(base, target)!;

    const tampered = base.map((b, i) =>
      i > target ? bar(b.date, b.adjustedClose * 5, 99_000_000) : b,
    );
    const after = extractFeaturesAt(tampered, target)!;

    expect(after).toEqual(before);
  });
});

describe("extractFeaturesAt - momentum & trend", () => {
  it("reports positive momentum in an uptrend", () => {
    const p = series(300, 100, 0.002);
    const f = extractFeaturesAt(p, 299)!;
    expect(f.momentum1m!).toBeGreaterThan(0);
    expect(f.momentum12m!).toBeGreaterThan(0);
  });

  it("reports negative momentum in a downtrend", () => {
    const p = series(300, 500, -0.002);
    const f = extractFeaturesAt(p, 299)!;
    expect(f.momentum1m!).toBeLessThan(0);
    expect(f.momentum12m!).toBeLessThan(0);
  });

  it("computes momentum1m as the exact 21-bar return", () => {
    const p = series(300, 100, 0.001);
    const f = extractFeaturesAt(p, 299)!;
    const expected = p[299]!.adjustedClose / p[299 - 21]!.adjustedClose - 1;
    expect(f.momentum1m!).toBeCloseTo(expected, 10);
  });

  it("places price above both SMAs in a steady uptrend", () => {
    const p = series(300, 100, 0.002);
    const f = extractFeaturesAt(p, 299)!;
    expect(f.priceVsSma50!).toBeGreaterThan(0);
    expect(f.priceVsSma200!).toBeGreaterThan(0);
    expect(f.goldenCross).toBe(true);
    expect(f.sma50Slope!).toBeGreaterThan(0);
  });

  it("detects a death cross in a downtrend", () => {
    const p = series(300, 500, -0.002);
    const f = extractFeaturesAt(p, 299)!;
    expect(f.goldenCross).toBe(false);
    expect(f.sma50Slope!).toBeLessThan(0);
  });
});

describe("extractFeaturesAt - RSI", () => {
  it("returns 100 when every bar rises", () => {
    const p = series(60, 100, 0.01);
    const f = extractFeaturesAt(p, 59)!;
    expect(f.rsi14).toBe(100);
  });

  it("approaches 0 when every bar falls", () => {
    const p = series(60, 500, -0.01);
    const f = extractFeaturesAt(p, 59)!;
    expect(f.rsi14!).toBeLessThan(1);
  });

  it("stays within 0-100", () => {
    const p = series(300, 100, 0.0005, 2);
    for (const i of [50, 120, 200, 299]) {
      const f = extractFeaturesAt(p, i)!;
      expect(f.rsi14!).toBeGreaterThanOrEqual(0);
      expect(f.rsi14!).toBeLessThanOrEqual(100);
    }
  });
});

describe("extractFeaturesAt - volatility", () => {
  it("reports higher realized vol for a noisier series", () => {
    const calm = extractFeaturesAt(series(300, 100, 0, 0.2), 299)!;
    const wild = extractFeaturesAt(series(300, 100, 0, 5), 299)!;
    expect(wild.realizedVol20!).toBeGreaterThan(calm.realizedVol20!);
  });

  it("reports atrPercent as a positive fraction", () => {
    const f = extractFeaturesAt(series(300, 100, 0.001, 1), 299)!;
    expect(f.atrPercent!).toBeGreaterThan(0);
    expect(f.atrPercent!).toBeLessThan(1);
  });

  it("computes volRatio as vol20 over vol60", () => {
    const f = extractFeaturesAt(series(300, 100, 0.0005, 1.5), 299)!;
    expect(f.volRatio!).toBeCloseTo(f.realizedVol20! / f.realizedVol60!, 8);
  });
});

describe("extractFeaturesAt - volume", () => {
  it("flags an unusual volume spike with a high z-score", () => {
    const p = series(300, 100, 0.001);
    // Spike only the final bar's volume.
    p[299] = bar(p[299]!.date, p[299]!.adjustedClose, 20_000_000);
    const f = extractFeaturesAt(p, 299)!;
    expect(f.volumeZScore!).toBeGreaterThan(3);
  });

  it("returns null z-score when volume never varies", () => {
    const f = extractFeaturesAt(series(300, 100, 0.001), 299)!;
    expect(f.volumeZScore).toBeNull();
  });
});

describe("extractFeatureSeries", () => {
  it("skips bars without enough history", () => {
    const p = series(400, 100, 0.001);
    const out = extractFeatureSeries(p);
    expect(out.length).toBe(400 - MIN_HISTORY_BARS);
    expect(out[0]!.index).toBe(MIN_HISTORY_BARS);
  });

  it("returns an empty series when history is shorter than the minimum", () => {
    expect(extractFeatureSeries(series(100, 100, 0.001)).length).toBe(0);
  });

  it("honors a custom start index", () => {
    const p = series(400, 100, 0.001);
    const out = extractFeatureSeries(p, 300);
    expect(out.length).toBe(100);
    expect(out[0]!.index).toBe(300);
  });
});

describe("forwardReturn", () => {
  it("computes the realized forward return", () => {
    const p = series(300, 100, 0.001);
    const r = forwardReturn(p, 100, 20)!;
    const expected = p[120]!.adjustedClose / p[100]!.adjustedClose - 1;
    expect(r).toBeCloseTo(expected, 10);
  });

  it("returns null when the horizon runs past the data", () => {
    const p = series(300, 100, 0.001);
    expect(forwardReturn(p, 295, 20)).toBeNull();
  });

  it("is positive in an uptrend and negative in a downtrend", () => {
    expect(forwardReturn(series(300, 100, 0.002), 100, 20)!).toBeGreaterThan(0);
    expect(forwardReturn(series(300, 500, -0.002), 100, 20)!).toBeLessThan(0);
  });
});
