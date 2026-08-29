import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getPaperAlertsByOwner: vi.fn(async (ownerId: number) => [{ id: 1, ownerId, warningId: "w-1", headline: "Event", severity: "high", confidence: 88, reason: "high event at 88% confidence", triggeredAt: new Date(), acknowledged: false, createdAt: new Date() }]),
  recordPaperAlert: vi.fn(async (input: any) => ({ id: 2, ...input, triggeredAt: new Date(), createdAt: new Date(), acknowledged: false })),
}));
vi.mock("./db", async importOriginal => ({ ...(await importOriginal<typeof import("./db")>()), ...mocks }));
const { appRouter } = await import("./routers");

function contextFor(id: number): TrpcContext {
  return { user: { id, openId: `user-${id}`, name: "Alert User", email: "alert@example.com", loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describe("market.paperAlerts", () => {
  it("rejects unauthenticated access and scopes reads to the caller", async () => {
    await expect(appRouter.createCaller({ ...contextFor(9), user: null }).market.paperAlerts()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const result = await appRouter.createCaller(contextFor(9)).market.paperAlerts();
    expect(mocks.getPaperAlertsByOwner).toHaveBeenCalledWith(9);
    expect(result[0].ownerId).toBe(9);
  });

  it("records a paper-only alert with owner-bound payload", async () => {
    const result = await appRouter.createCaller(contextFor(12)).market.recordPaperAlert({ warningId: "gdelt-1", headline: "Rates event", severity: "medium", confidence: 75, reason: "medium event at 75% confidence" });
    expect(mocks.recordPaperAlert).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 12, warningId: "gdelt-1" }));
    expect(result?.ownerId).toBe(12);
  });
});
