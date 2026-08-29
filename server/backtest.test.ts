import { describe, expect, it } from "vitest";
import { runBacktest, type HistoricalBar } from "../shared/backtest";

const bars: HistoricalBar[] = [
  { timestamp: 1, open: 100, high: 101, low: 99, close: 100 },
  { timestamp: 2, open: 110, high: 111, low: 109, close: 110 },
  { timestamp: 3, open: 105, high: 106, low: 104, close: 105 },
];

describe("backtest engine", () => {
  it("charges commission and slippage on both entry and exit", () => {
    const result = runBacktest(bars, [1, 0, 0], { initialCash: 1000, commissionBps: 10, slippageBps: 20, positionFraction: 1, allowShort: false });
    expect(result.trades).toHaveLength(1);
    expect(result.metrics.totalCommission).toBeGreaterThan(0);
    expect(result.metrics.totalSlippageCost).toBeGreaterThan(0);
    expect(result.metrics.finalEquity).toBeGreaterThan(1000);
    expect(result.metrics.netReturnPct).toBeLessThan(result.metrics.grossReturnPct);
  });

  it("supports short trades when explicitly enabled", () => {
    const decliningBars: HistoricalBar[] = [
      { timestamp: 1, open: 100, high: 101, low: 99, close: 100 },
      { timestamp: 2, open: 90, high: 91, low: 89, close: 90 },
      { timestamp: 3, open: 85, high: 86, low: 84, close: 85 },
    ];
    const result = runBacktest(decliningBars, [-1, 0, 0], { initialCash: 1000, commissionBps: 0, slippageBps: 0, positionFraction: 0.5, allowShort: true });
    expect(result.trades[0]?.side).toBe("short");
    expect(result.trades[0]?.netPnl).toBeGreaterThan(0);
  });

  it("calculates drawdown, profit factor, and lifecycle metrics for multiple trades", () => {
    const result = runBacktest(
      [{ timestamp: 1, open: 100, high: 100, low: 100, close: 100 }, { timestamp: 2, open: 110, high: 110, low: 110, close: 110 }, { timestamp: 3, open: 90, high: 90, low: 90, close: 90 }, { timestamp: 4, open: 80, high: 80, low: 80, close: 80 }],
      [1, 0, 1, 0],
      { initialCash: 1000, commissionBps: 0, slippageBps: 0, positionFraction: 0.5, allowShort: false },
    );
    expect(result.trades).toHaveLength(2);
    expect(result.trades[0]).toMatchObject({ entryTime: 1, exitTime: 2, grossPnl: 50 });
    expect(result.trades[1]?.netPnl).toBeCloseTo(-58.3333, 3);
    expect(result.metrics.maxDrawdownPct).toBeCloseTo(5.5556, 3);
    expect(result.metrics.profitFactor).toBeCloseTo(0.8571, 3);
    expect(result.metrics.sharpeLike).toBeCloseTo(-0.07438, 4);
  });

  it("returns warnings for a short or trade-free sample", () => {
    const result = runBacktest(bars, [0, 0, 0], { initialCash: 1000, commissionBps: 0, slippageBps: 0, positionFraction: 0.5, allowShort: false });
    expect(result.warnings.some(warning => warning.includes("30 bars"))).toBe(true);
    expect(result.warnings.some(warning => warning.includes("No completed trades"))).toBe(true);
  });
});
