import { describe, expect, it, vi } from "vitest";
import { classifyFreshness, fetchEarlyWarnings, shouldAlert } from "./intelligence";

describe("early-warning intelligence", () => {
  it("normalizes discovery articles into auditable cross-market warnings", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ articles: [{ url: "https://example.com/oil", title: "OPEC oil, gold, silver, index and dollar rates event", seendate: "20260829120000", domain: "example.com", tone: -8 }] }), { status: 200, headers: { "content-type": "application/json" } })));
    const result = await fetchEarlyWarnings("oil rates test");
    expect(result[0]).toMatchObject({ source: "example.com", severity: "high", markets: expect.arrayContaining(["Oil", "Gold", "Silver", "Indices", "FX", "Rates"]), corroboration: "single-source", confidence: expect.any(Number), leadTimeEstimateMinutes: expect.any(Number) });
    expect(result[0]?.retrievedAt).toBeTruthy();
    expect(result[0]?.confidence).toBeGreaterThanOrEqual(25);
    expect(result[0]?.leadTimeEstimateMinutes).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

  it("classifies freshness and respects alert thresholds", () => {
    expect(classifyFreshness("2026-08-29T12:00:00Z", "2026-08-29T12:10:00Z")).toBe("fresh");
    expect(classifyFreshness("2026-08-29T10:00:00Z", "2026-08-29T12:10:00Z")).toBe("stale");
    expect(shouldAlert({ severity: "high", confidence: 80, freshness: "fresh" }, { minConfidence: 70, severities: ["high", "medium"] })).toBe(true);
    expect(shouldAlert({ severity: "high", confidence: 80, freshness: "stale" }, { minConfidence: 70, severities: ["high"] })).toBe(false);
  });
});
