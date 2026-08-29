import { describe, expect, it } from "vitest";

describe("Massive historical data credential", () => {
  it("authenticates and returns a historical aggregate response", async () => {
    const apiKey = process.env.MASSIVE_API_KEY;
    if (!apiKey) throw new Error("MASSIVE_API_KEY is required for this integration test");
    const url = new URL("https://api.massive.com/v2/aggs/ticker/AAPL/range/1/day/2026-08-20/2026-08-28");
    url.searchParams.set("adjusted", "true");
    url.searchParams.set("sort", "asc");
    url.searchParams.set("limit", "5");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    expect(response.status).toBe(200);
    const payload = await response.json() as { status?: string; results?: unknown[] };
    expect(["OK", "DELAYED"]).toContain(payload.status);
    expect(Array.isArray(payload.results)).toBe(true);
  }, 15_000);
});
