import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { ownerScoped } from "../shared/ownership";
import { buildAgentBatchCancelledAudit, buildCancelledRunPatch } from "../shared/agentRun";

const mocks = vi.hoisted(() => ({
  updateAgentRun: vi.fn(async (_ownerId: number, _id: number, patch: Record<string, unknown>) => patch),
  appendAuditEventToDb: vi.fn(async (input: Record<string, unknown>) => input),
  getAgentRunsByOwner: vi.fn(async (ownerId: number) => [{ id: 7, ownerId, status: "running", mode: "batch", requestedCount: 2, completedCount: 0, failedCount: 0, budgetUnits: 12 }]),
  getAgentRunEventsByOwner: vi.fn(async (ownerId: number) => [{ id: 9, ownerId, runId: 7, eventId: "event-7", status: "completed", consensus: null }]),
}));

vi.mock("./db", async importOriginal => ({
  ...(await importOriginal<typeof import("./db")>()),
  updateAgentRun: mocks.updateAgentRun,
  appendAuditEventToDb: mocks.appendAuditEventToDb,
  getAgentRunsByOwner: mocks.getAgentRunsByOwner,
  getAgentRunEventsByOwner: mocks.getAgentRunEventsByOwner,
}));

function contextFor(id: number): TrpcContext {
  return { user: { id, openId: `user-${id}`, name: "Test", email: "test@example.com", loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describe("agent run persistence routes", () => {
  it("builds a persisted cancelled transition and audit payload", () => {
    const now = new Date("2026-08-30T10:00:00.000Z");
    expect(buildCancelledRunPatch(now)).toEqual({ status: "cancelled", finishedAt: now });
    expect(buildAgentBatchCancelledAudit(42, 7)).toEqual({ ownerId: 42, eventType: "agent_batch_cancelled", entityType: "agent_run", entityId: 7, payload: { runId: 7 } });
  });

  it("marks a run cancelled and appends the lifecycle audit event for the owner", async () => {
    const result = await appRouter.createCaller(contextFor(42)).market.cancelBatch({ runId: 7 });
    expect(result).toEqual({ runId: 7, cancelled: true });
    expect(mocks.updateAgentRun).toHaveBeenCalledWith(42, 7, expect.objectContaining({ status: "cancelled", finishedAt: expect.any(Date) }));
    expect(mocks.appendAuditEventToDb).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 42, eventType: "agent_batch_cancelled", entityType: "agent_run", entityId: 7 }));
  });

  it("filters mixed-owner run and event records at the query contract boundary", () => {
    const runs = ownerScoped([{ id: 1, ownerId: 42 }, { id: 2, ownerId: 99 }], 42);
    const events = ownerScoped([{ id: 3, ownerId: 42 }, { id: 4, ownerId: 99 }], 42);
    expect(runs).toEqual([{ id: 1, ownerId: 42 }]);
    expect(events).toEqual([{ id: 3, ownerId: 42 }]);
  });

  it("passes the authenticated owner into run and event queries", async () => {
    const caller = appRouter.createCaller(contextFor(42));
    const runs = await caller.market.agentRuns();
    const events = await caller.market.agentRunEvents({ runId: 7 });
    expect(runs.every(row => row.ownerId === 42)).toBe(true);
    expect(events.every(row => row.ownerId === 42)).toBe(true);
    expect(mocks.getAgentRunsByOwner).toHaveBeenCalledWith(42);
    expect(mocks.getAgentRunEventsByOwner).toHaveBeenCalledWith(42, 7);
  });
});
