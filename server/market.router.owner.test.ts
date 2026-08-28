import { describe, expect, it, vi } from "vitest";

const { ownerCalls, scoped } = vi.hoisted(() => {
  const calls: Record<string, number[]> = {};
  const makeScoped = (name: string) => vi.fn(async (ownerId: number) => {
    calls[name] ??= [];
    calls[name].push(ownerId);
    return [{ ownerId }];
  });
  return { ownerCalls: calls, scoped: makeScoped };
});

vi.mock("./db", () => ({
  appendAuditEventToDb: vi.fn(),
  getInstrumentsByOwner: scoped("watchlist"),
  getAuditEventsByOwner: scoped("audit"),
  getSignalsByOwner: scoped("signals"),
  getIntelligenceByOwner: scoped("intelligence"),
  getAgentOutputsByOwner: scoped("agents"),
  getRiskControlsByOwner: scoped("risk"),
  getSimulationsByOwner: scoped("simulations"),
  getIntegrationsByOwner: scoped("integrations"),
}));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function contextFor(id: number): TrpcContext {
  return { user: { id, openId: `user-${id}`, name: "Test", email: "test@example.com", loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describe("market procedure owner isolation", () => {
  it("passes each authenticated owner's id to every collection helper", async () => {
    const callerOne = appRouter.createCaller(contextFor(101));
    const callerTwo = appRouter.createCaller(contextFor(202));
    const names = ["watchlist", "signals", "intelligence", "agents", "risk", "simulations", "integrations", "audit"] as const;
    for (const name of names) {
      const one = await callerOne.market[name]();
      const two = await callerTwo.market[name]();
      expect(one.every((row: { ownerId: number }) => row.ownerId === 101)).toBe(true);
      expect(two.every((row: { ownerId: number }) => row.ownerId === 202)).toBe(true);
    }
    for (const name of names) expect(ownerCalls[name]).toEqual([101, 202]);
  });
});
