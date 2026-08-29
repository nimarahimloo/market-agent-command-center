import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function contextFor(id: number): TrpcContext {
  return { user: { id, openId: `user-${id}`, name: "Radar User", email: "radar@example.com", loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describe("market.earlyWarnings", () => {
  it("rejects unauthenticated access", async () => {
    const caller = appRouter.createCaller({ ...contextFor(7), user: null });
    await expect(caller.market.earlyWarnings()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("runs through the protected route with mocked discovery data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ articles: [{ url: "https://example.com/index", title: "Index rates and gold event", seendate: "2026-08-29T12:00:00Z", domain: "example.com", tone: 5 }] }), { status: 200 })));
    const caller = appRouter.createCaller(contextFor(7));
    const result = await caller.market.earlyWarnings({ query: "index gold rates" });
    expect(result[0]?.source).toBe("example.com");
    expect(result[0]?.markets).toEqual(expect.arrayContaining(["Indices", "Gold", "Rates"]));
    vi.unstubAllGlobals();
  });
});
