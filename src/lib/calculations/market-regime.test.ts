import { describe, it, expect } from "vitest";
import { classifyMarketRegime } from "./market-regime";
import type { HistoricalPricePoint } from "@/lib/types";

function generateUptrendPrices(start: number, days: number): HistoricalPricePoint[] {
  const prices: HistoricalPricePoint[] = [];
  let price = start;
  for (let i = 0; i < days; i++) {
    price *= 1 + 0.001 + (Math.sin(i / 10) * 0.005);
    prices.push({
      date: new Date(2020, 0, 1 + i).toISOString().slice(0, 10),
      open: price, high: price * 1.01, low: price * 0.99, close: price, adjustedClose: price, volume: 1000000,
    });
  }
  return prices;
}

function generateDowntrendPrices(start: number, days: number): HistoricalPricePoint[] {
  const prices: HistoricalPricePoint[] = [];
  let price = start;
  for (let i = 0; i < days; i++) {
    price *= 1 - 0.001 + (Math.sin(i / 10) * 0.005);
    prices.push({
      date: new Date(2020, 0, 1 + i).toISOString().slice(0, 10),
      open: price, high: price * 1.01, low: price * 0.99, close: price, adjustedClose: price, volume: 1000000,
    });
  }
  return prices;
}

describe("classifyMarketRegime", () => {
  it("classifies low-vol bull market", () => {
    const prices = generateUptrendPrices(300, 250);
    const result = classifyMarketRegime(12, prices);
    expect(result.regime).toBe("LOW_VOL_BULL");
    expect(result.spyTrend).toBe("up");
    expect(result.riskLevel).toBe("low");
  });

  it("classifies high-vol bull market", () => {
    const prices = generateUptrendPrices(300, 250);
    const result = classifyMarketRegime(18, prices);
    expect(result.regime).toBe("HIGH_VOL_BULL");
    expect(result.spyTrend).toBe("up");
  });

  it("classifies crisis regime", () => {
    const prices = generateUptrendPrices(300, 250);
    const result = classifyMarketRegime(35, prices);
    expect(result.regime).toBe("CRISIS");
    expect(result.riskLevel).toBe("extreme");
  });

  it("classifies bear market", () => {
    const prices = generateDowntrendPrices(400, 250);
    const result = classifyMarketRegime(20, prices);
    expect(result.regime).toBe("HIGH_VOL_BEAR");
    expect(result.spyTrend).toBe("down");
  });

  it("provides strategy implications", () => {
    const prices = generateUptrendPrices(300, 250);
    const result = classifyMarketRegime(12, prices);
    expect(result.strategyImplications.length).toBeGreaterThan(0);
  });

  it("computes realized volatility", () => {
    const prices = generateUptrendPrices(300, 250);
    const result = classifyMarketRegime(12, prices);
    expect(result.realizedVol30).toBeGreaterThanOrEqual(0);
  });
});
