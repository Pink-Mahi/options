import { describe, it, expect } from "vitest";
import { analyzeTaxLot, buildTaxSummary } from "./tax";
import type { TaxLot } from "./tax";

describe("analyzeTaxLot", () => {
  it("classifies long-term holding", () => {
    const lot: TaxLot = {
      symbol: "AAPL",
      shares: 100,
      purchaseDate: "2023-01-01",
      costBasis: 150,
      saleDate: "2025-01-01",
      salePrice: 180,
    };
    const result = analyzeTaxLot(lot);
    expect(result.term).toBe("long_term");
    expect(result.holdingDays).toBeGreaterThan(365);
    expect(result.gainLoss).toBe(3000);
    expect(result.estimatedTax).toBe(450); // 3000 * 0.15
  });

  it("classifies short-term holding", () => {
    const lot: TaxLot = {
      symbol: "AAPL",
      shares: 100,
      purchaseDate: "2024-12-01",
      costBasis: 150,
      saleDate: "2025-01-15",
      salePrice: 160,
    };
    const result = analyzeTaxLot(lot);
    expect(result.term).toBe("short_term");
    expect(result.holdingDays).toBeLessThanOrEqual(365);
    expect(result.gainLoss).toBe(1000);
    expect(result.estimatedTax).toBe(320); // 1000 * 0.32
  });

  it("detects wash sale on loss", () => {
    const lot: TaxLot = {
      symbol: "AAPL",
      shares: 100,
      purchaseDate: "2024-06-01",
      costBasis: 180,
      saleDate: "2025-01-01",
      salePrice: 150,
    };
    const repurchase: TaxLot = {
      symbol: "AAPL",
      shares: 100,
      purchaseDate: "2025-01-10",
      costBasis: 155,
      saleDate: "2025-06-01",
      salePrice: 160,
    };
    const result = analyzeTaxLot(lot, [repurchase]);
    expect(result.gainLoss).toBe(-3000);
    expect(result.washSaleDisallowed).toBe(3000);
  });

  it("no wash sale when repurchase > 30 days later", () => {
    const lot: TaxLot = {
      symbol: "AAPL",
      shares: 100,
      purchaseDate: "2024-06-01",
      costBasis: 180,
      saleDate: "2025-01-01",
      salePrice: 150,
    };
    const repurchase: TaxLot = {
      symbol: "AAPL",
      shares: 100,
      purchaseDate: "2025-02-15",
      costBasis: 155,
      saleDate: "2025-06-01",
      salePrice: 160,
    };
    const result = analyzeTaxLot(lot, [repurchase]);
    expect(result.washSaleDisallowed).toBe(0);
  });

  it("no tax on losses", () => {
    const lot: TaxLot = {
      symbol: "AAPL",
      shares: 100,
      purchaseDate: "2024-06-01",
      costBasis: 180,
      saleDate: "2025-01-01",
      salePrice: 150,
    };
    const result = analyzeTaxLot(lot);
    expect(result.gainLoss).toBeLessThan(0);
    expect(result.estimatedTax).toBe(0);
  });
});

describe("buildTaxSummary", () => {
  it("aggregates lots correctly", () => {
    const lots = [
      { symbol: "AAPL", shares: 100, proceeds: 18000, costBasis: 15000, gainLoss: 3000, term: "long_term" as const, holdingDays: 400, estimatedTax: 450, washSaleDisallowed: 0, netAfterTax: 2550 },
      { symbol: "MSFT", shares: 50, proceeds: 20000, costBasis: 22000, gainLoss: -2000, term: "short_term" as const, holdingDays: 100, estimatedTax: 0, washSaleDisallowed: 0, netAfterTax: -2000 },
    ];
    const summary = buildTaxSummary(lots);
    expect(summary.totalProceeds).toBe(38000);
    expect(summary.totalGainLoss).toBe(1000);
    expect(summary.longTermGains).toBe(3000);
    expect(summary.shortTermLosses).toBe(2000);
    expect(summary.totalEstimatedTax).toBe(450);
  });
});
