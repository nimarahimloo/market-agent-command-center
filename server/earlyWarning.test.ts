import { describe, expect, it, vi } from "vitest";
import {
  classifyFreshness,
  clearEarlyWarningCacheForTests,
  fetchEarlyWarnings,
  shouldAlert,
} from "./intelligence";

describe("early-warning intelligence", () => {
  it("normalizes discovery articles into auditable cross-market warnings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              articles: [
                {
                  url: "https://example.com/oil",
                  title: "OPEC oil, gold, silver, index and dollar rates event",
                  seendate: "20260829120000",
                  domain: "example.com",
                  tone: -8,
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
      )
    );
    const result = await fetchEarlyWarnings("oil rates test");
    expect(result[0]).toMatchObject({
      source: "example.com",
      severity: "high",
      markets: expect.arrayContaining([
        "Oil",
        "Gold",
        "Silver",
        "Indices",
        "FX",
        "Rates",
      ]),
      corroboration: "single-source",
      confidence: expect.any(Number),
      leadTimeEstimateMinutes: expect.any(Number),
    });
    expect(result[0]?.retrievedAt).toBeTruthy();
    expect(result[0]?.confidence).toBeGreaterThanOrEqual(25);
    expect(result[0]?.leadTimeEstimateMinutes).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

  it("deduplicates repeated URLs and classifies source tiers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              articles: [
                {
                  url: "https://sec.gov/event",
                  title: "Gold index disclosure",
                  seendate: "2026-08-29T12:00:00Z",
                  domain: "sec.gov",
                  tone: 1,
                },
                {
                  url: "https://sec.gov/event",
                  title: "Gold index disclosure",
                  seendate: "2026-08-29T12:00:00Z",
                  domain: "sec.gov",
                  tone: 1,
                },
              ],
            }),
            { status: 200 }
          )
      )
    );
    const result = await fetchEarlyWarnings("dedupe source tier");
    expect(result).toHaveLength(1);
    expect(result[0]?.sourceTier).toBe("official");
    vi.unstubAllGlobals();
  });

  it("serves a stale cached feed after transient GDELT failure", async () => {
    vi.useFakeTimers();
    clearEarlyWarningCacheForTests();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            articles: [
              {
                url: "https://example.com/cached",
                title: "Cached oil event",
                seendate: "2026-08-29T12:00:00Z",
                domain: "example.com",
                tone: 2,
              },
            ],
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    const first = await fetchEarlyWarnings("stale fallback test");
    vi.setSystemTime(Date.now() + 61_000);
    fetchMock.mockRejectedValue(new Error("network down"));
    const stalePromise = fetchEarlyWarnings("stale fallback test");
    await vi.advanceTimersByTimeAsync(200);
    const stale = await stalePromise;
    expect(stale[0]).toMatchObject({ id: first[0]?.id, freshness: "stale" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("classifies freshness and respects alert thresholds", () => {
    expect(
      classifyFreshness("2026-08-29T12:00:00Z", "2026-08-29T12:10:00Z")
    ).toBe("fresh");
    expect(
      classifyFreshness("2026-08-29T10:00:00Z", "2026-08-29T12:10:00Z")
    ).toBe("stale");
    expect(
      shouldAlert(
        { severity: "high", confidence: 80, freshness: "fresh" },
        { minConfidence: 70, severities: ["high", "medium"] }
      )
    ).toBe(true);
    expect(
      shouldAlert(
        { severity: "high", confidence: 80, freshness: "stale" },
        { minConfidence: 70, severities: ["high"] }
      )
    ).toBe(false);
  });
});
