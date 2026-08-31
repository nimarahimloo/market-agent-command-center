import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchMassiveHistorical: vi.fn() }));
vi.mock("./massiveData", () => mocks);
const { summarizeMarketContext, buildMarketContext } = await import("./marketContext");

const bars = Array.from({ length: 60 }, (_, index) => ({ timestamp: index + 1, open: 100 + index, high: 102 + index, low: 99 + index, close: 101 + index }));

describe("market context", () => {
  it("derives returns, moving averages, volatility, range, and provenance", () => {
    const result = summarizeMarketContext("Equities", "SPY", "S&P 500 ETF proxy", bars, { provider: "Massive", retrievedAt: 123, sourceLastBarTimestamp: 60 });
    expect(result.return1d).toBeGreaterThan(0);
    expect(result.return5d).toBeGreaterThan(0);
    expect(result.sma20).toBe(150.5);
    expect(result.sma50).toBe(135.5);
    expect(result.volatility20).toBeGreaterThanOrEqual(0);
    expect(result.range20).toBeGreaterThan(0);
    expect(result.asOf).toBe(60);
    expect(result.provenance.provider).toBe("Massive");
  });

  it("returns an explicit unavailable context instead of inventing market values", async () => {
    mocks.fetchMassiveHistorical.mockRejectedValue(new Error("provider unavailable"));
    const result = await buildMarketContext({ markets: ["Gold"] }, { from: "2026-01-01", to: "2026-01-02" });
    expect(result).toHaveLength(1);
    expect(result[0].lastClose).toBeNull();
    expect(result[0].warnings).toContain("provider unavailable");
    expect(result[0].provenance.provider).toBe("Massive");
  });
});
