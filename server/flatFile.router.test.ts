import { describe, expect, it, vi } from "vitest";

const { recordMock, storageMock } = vi.hoisted(() => ({
  recordMock: vi.fn(async () => undefined),
  storageMock: vi.fn(async () => ({ key: "77-datasets/prices.csv_hash", url: "/manus-storage/77-datasets/prices.csv_hash" })),
}));

vi.mock("./db", () => ({ recordHistoricalDataset: recordMock }));
vi.mock("./storage", () => ({ storagePut: storageMock }));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function contextFor(id: number): TrpcContext {
  return { user: { id, openId: `user-${id}`, name: "Test", email: "test@example.com", loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describe("uploadFlatFile", () => {
  it("stores a validated dataset and records owner-scoped metadata", async () => {
    const csv = "timestamp,open,high,low,close\n2026-01-01,100,102,99,101\n2026-01-02,101,103,100,102\n";
    const result = await appRouter.createCaller(contextFor(77)).market.uploadFlatFile({ name: "prices.csv", format: "csv", symbol: "AAPL", contentBase64: Buffer.from(csv).toString("base64"), timezone: "UTC" });
    expect(result.status).toBe("validated");
    expect(result.bars).toHaveLength(2);
    expect(storageMock).toHaveBeenCalledWith(expect.stringContaining("77-datasets"), expect.any(Buffer), "text/csv");
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 77, symbol: "AAPL", rowCount: 2, status: "validated", sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }));
  });

  it("rejects files above the bounded MVP size limit", async () => {
    const oversized = Buffer.alloc(25 * 1024 * 1024 + 1).toString("base64");
    await expect(appRouter.createCaller(contextFor(77)).market.uploadFlatFile({ name: "large.csv", format: "csv", symbol: "AAPL", contentBase64: oversized, timezone: "UTC" })).rejects.toThrow("25 MB");
    expect(storageMock).not.toHaveBeenCalledWith(expect.stringContaining("large.csv"), expect.anything(), expect.anything());
  });

  it("blocks unauthenticated upload", async () => {
    const caller = appRouter.createCaller({ ...contextFor(77), user: null });
    await expect(caller.market.uploadFlatFile({ name: "prices.csv", format: "csv", symbol: "AAPL", contentBase64: Buffer.from("x").toString("base64"), timezone: "UTC" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
