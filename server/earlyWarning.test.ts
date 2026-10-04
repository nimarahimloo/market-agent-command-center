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

  it("uses Google News RSS when GDELT is completely unavailable", async () => {
    clearEarlyWarningCacheForTests();
    const fetchMock = vi.fn(async (input: URL) => {
      if (fetchMock.mock.calls.length <= 2)
        return new Response("upstream down", { status: 503 });
      expect(input.toString()).toContain("news.google.com/rss/search");
      return new Response(
        `<?xml version="1.0"?><rss><channel><item><title><![CDATA[Reuters: Oil and gold markets react to central bank rates]]></title><link>https://news.example.com/market-event</link><pubDate>Tue, 04 Oct 2026 12:00:00 GMT</pubDate><source url="https://reuters.com">Reuters</source></item></channel></rss>`,
        { status: 200, headers: { "content-type": "application/rss+xml" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchEarlyWarnings("secondary provider test");
    expect(result[0]).toMatchObject({
      source: "Reuters",
      sourceTier: "financial-media",
      title: expect.stringContaining("Oil and gold"),
      markets: expect.arrayContaining(["Oil", "Gold", "Rates"]),
    });
    expect(result[0]?.id).toMatch(/^google-news-/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
    await vi.advanceTimersByTimeAsync(400);
    const stale = await stalePromise;
    expect(stale[0]).toMatchObject({ id: first[0]?.id, freshness: "stale" });
    expect(fetchMock).toHaveBeenCalledTimes(5);
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
