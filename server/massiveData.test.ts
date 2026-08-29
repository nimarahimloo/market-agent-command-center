import { describe, expect, it, vi } from "vitest";
import { fetchMassiveHistorical, normalizeMassiveAggregates } from "./massiveData";
import { runBacktest } from "../shared/backtest";

describe("Massive data normalization", () => {
  const request = { symbol: "AAPL", from: "2026-01-01", to: "2026-01-05", timespan: "day" as const };

  it("normalizes complete aggregates and preserves provenance", () => {
    const result = normalizeMassiveAggregates({ status: "OK", results: [{ t: 2, o: 101, h: 105, l: 99, c: 104, v: 1000 }] }, request, "https://api.massive.com/v2/aggs/test", 123);
    expect(result.bars).toEqual([{ timestamp: 2, open: 101, high: 105, low: 99, close: 104 }]);
    expect(result.provider).toBe("Massive");
    expect(result.provenance.retrievedAt).toBe(123);
    expect(result.provenance.timezone).toBe("UTC");
  });

  it("caches identical provider requests briefly", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "OK", results: [{ t: 1, o: 100, h: 101, l: 99, c: 100 }, { t: 2, o: 100, h: 101, l: 99, c: 100 }] }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const cacheRequest = { symbol: "CACHE_TEST_UNIQUE", from: "2026-01-01", to: "2026-01-05", timespan: "day" as const };
    await fetchMassiveHistorical(cacheRequest);
    await fetchMassiveHistorical(cacheRequest);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", originalFetch);
  });

  it("feeds normalized provider bars into the backtest engine", () => {
    const data = normalizeMassiveAggregates({ status: "OK", results: [{ t: 1, o: 100, h: 101, l: 99, c: 100 }, { t: 2, o: 100, h: 111, l: 99, c: 110 }, { t: 3, o: 110, h: 111, l: 104, c: 105 }] }, request, "endpoint", 123);
    const result = runBacktest(data.bars, [1, 0, 0], { initialCash: 1000, commissionBps: 8, slippageBps: 12, positionFraction: 0.5, allowShort: false, universe: "AAPL · Massive" });
    expect(result.trades).toHaveLength(1);
    expect(result.assumptions.universe).toBe("AAPL · Massive");
    expect(result.metrics.finalEquity).toBeGreaterThan(0);
  });

  it("warns when the returned dataset is stale or not point-in-time", () => {
    const result = normalizeMassiveAggregates({ status: "OK", results: [{ t: Date.parse("2026-01-01T00:00:00Z"), o: 100, h: 101, l: 99, c: 100 }] }, { ...request, to: "2026-01-10" }, "endpoint", 123);
    expect(result.provenance.warnings.some(warning => warning.includes("stale"))).toBe(true);
    expect(result.provenance.warnings.some(warning => warning.includes("point-in-time"))).toBe(true);
  });

  it("warns on invalid OHLC geometry, duplicates, gaps, and empty responses", () => {
    const result = normalizeMassiveAggregates({ status: "OK", results: [{ t: 2, o: 101, h: 100, l: 99, c: 100 }, { t: 2, o: 100, h: 101, l: 98, c: 100 }] }, request, "endpoint", 123);
    expect(result.provenance.warnings).toEqual(expect.arrayContaining([
      "Provider response contains duplicate or out-of-order timestamps.",
      "At least one OHLC bar violates high/low consistency.",
    ]));
    const gap = normalizeMassiveAggregates({ status: "OK", results: [{ t: 1, o: 100, h: 101, l: 99, c: 100 }, { t: 432000001, o: 100, h: 101, l: 99, c: 100 }] }, request, "endpoint", 123);
    expect(gap.provenance.warnings.some(warning => warning.startsWith("Potential historical data gap"))).toBe(true);
    const empty = normalizeMassiveAggregates({ status: "OK", results: [] }, request, "endpoint", 123);
    expect(empty.provenance.warnings).toContain("Provider returned no complete OHLC bars for this range.");
  });
});
