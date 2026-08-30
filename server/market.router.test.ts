import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { ownerScoped } from "../shared/ownership";

function contextFor(id: number): TrpcContext {
  return {
    user: { id, openId: `user-${id}`, name: "Test", email: "test@example.com", loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("market protected procedures", () => {
  it("exposes owner-scoped collections for every market domain", async () => {
    const caller = appRouter.createCaller(contextFor(42));
    const results = await Promise.all([
      caller.market.watchlist(), caller.market.signals(), caller.market.intelligence(),
      caller.market.agents(), caller.market.agentRuns(), caller.market.agentRunEvents(), caller.market.risk(), caller.market.simulations(), caller.market.integrations(), caller.market.audit(),
    ]);
    results.forEach(result => expect(Array.isArray(result)).toBe(true));
  });

  it("blocks unauthenticated access to every protected market procedure", async () => {
    const caller = appRouter.createCaller({ ...contextFor(42), user: null });
    const calls = [caller.market.watchlist(), caller.market.signals(), caller.market.intelligence(), caller.market.agents(), caller.market.agentRuns(), caller.market.agentRunEvents(), caller.market.cancelBatch({ runId: 1 }), caller.market.analyzeEvent({ event: { id: "event-unauth", title: "Test", url: "https://example.com/test", publishedAt: "2026-08-30T00:00:00Z", retrievedAt: "2026-08-30T00:01:00Z", source: "example.com", sourceTier: "discovery", severity: "low", markets: ["FX"], entities: [], tone: 0, corroboration: "single-source", confidence: 50, leadTimeEstimateMinutes: 10, freshness: "fresh" } }), caller.market.risk(), caller.market.simulations(), caller.market.integrations(), caller.market.audit(), caller.market.historicalRuns(), caller.market.historicalBars({ symbol: "AAPL", from: "2026-01-01", to: "2026-01-05" })];
    for (const call of calls) await expect(call).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("keeps records isolated by owner", () => {
    const rows = [{ ownerId: 1, id: "a" }, { ownerId: 2, id: "b" }];
    expect(ownerScoped(rows, 1)).toEqual([{ ownerId: 1, id: "a" }]);
    expect(ownerScoped(rows, 2)).toEqual([{ ownerId: 2, id: "b" }]);
  });
});
