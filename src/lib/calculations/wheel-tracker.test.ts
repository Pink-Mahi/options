import { describe, it, expect } from "vitest";
import { buildWheelSummary, nextWheelPhase, type WheelCycle } from "./wheel-tracker";

describe("nextWheelPhase", () => {
  it("transitions PUT → HOLDING on assignment", () => {
    expect(nextWheelPhase("PUT", "ASSIGNED")).toBe("HOLDING");
  });

  it("stays PUT on expired worthless", () => {
    expect(nextWheelPhase("PUT", "EXPIRED_WORTHLESS")).toBe("PUT");
  });

  it("transitions HOLDING → CALL", () => {
    expect(nextWheelPhase("HOLDING", "EXPIRED_WORTHLESS")).toBe("CALL");
  });

  it("transitions CALL → CASH on called away", () => {
    expect(nextWheelPhase("CALL", "CALLED_AWAY")).toBe("CASH");
  });

  it("stays CALL on expired worthless", () => {
    expect(nextWheelPhase("CALL", "EXPIRED_WORTHLESS")).toBe("CALL");
  });

  it("transitions CASH → PUT", () => {
    expect(nextWheelPhase("CASH", "EXPIRED_WORTHLESS")).toBe("PUT");
  });
});

describe("buildWheelSummary", () => {
  const cycles: WheelCycle[] = [
    { cycleNumber: 1, phase: "PUT", startDate: "2025-01-01", endDate: "2025-01-31", symbol: "AAPL", strike: 150, premium: 200, contracts: 1, outcome: "EXPIRED_WORTHLESS", pnl: 200, sharesHeldAfter: 0 },
    { cycleNumber: 2, phase: "PUT", startDate: "2025-02-01", endDate: "2025-03-01", symbol: "AAPL", strike: 145, premium: 180, contracts: 1, outcome: "ASSIGNED", pnl: 80, sharesHeldAfter: 100 },
    { cycleNumber: 3, phase: "CALL", startDate: "2025-03-02", endDate: "2025-04-01", symbol: "AAPL", strike: 155, premium: 220, contracts: 1, outcome: "CALLED_AWAY", pnl: 320, sharesHeldAfter: 0 },
  ];

  it("computes total premium and PnL", () => {
    const summary = buildWheelSummary(cycles)!;
    expect(summary.totalPremium).toBe(600);
    expect(summary.totalPnl).toBe(600);
  });

  it("counts outcomes correctly", () => {
    const summary = buildWheelSummary(cycles)!;
    expect(summary.assignmentCount).toBe(1);
    expect(summary.calledAwayCount).toBe(1);
    expect(summary.expiredWorthlessCount).toBe(1);
  });

  it("determines current phase", () => {
    const summary = buildWheelSummary(cycles)!;
    expect(summary.currentPhase).toBe("CALL");
    expect(summary.currentSharesHeld).toBe(0);
  });

  it("estimates annualized income", () => {
    const summary = buildWheelSummary(cycles)!;
    expect(summary.annualizedIncomeEstimate).toBeCloseTo(2488.64, 1);
    expect(summary.cyclesPerYearEstimate).toBeCloseTo(12.44, 2);
    expect(summary.avgPremiumPerCycle).toBe(200);
    expect(summary.avgCycleDays).toBeCloseTo(29.33, 2);
  });

  it("returns null for empty cycles", () => {
    expect(buildWheelSummary([])).toBeNull();
  });
});
