import { describe, expect, it, vi } from "vitest";

const { fetchMock, recordMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(async () => ({ provider: "Massive", symbol: "AAPL", bars: [{ timestamp: 1, open: 100, high: 101, low: 99, close: 100 }, { timestamp: 2, open: 100, high: 102, low: 99, close: 101 }], provenance: { endpoint: "endpoint", retrievedAt: 123, timezone: "UTC", adjusted: true, multiplier: 1, timespan: "day", warnings: [] } })),
  recordMock: vi.fn(async () => undefined),
}));

vi.mock("./massiveData", () => ({ fetchMassiveHistorical: fetchMock }));
vi.mock("./db", () => ({ recordHistoricalDataRun: recordMock }));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function contextFor(id: number): TrpcContext {
  return { user: { id, openId: `user-${id}`, name: "Test", email: "test@example.com", loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describe("historical data procedure", () => {
  it("records fetched provenance under the authenticated owner", async () => {
    const result = await appRouter.createCaller(contextFor(77)).market.historicalBars({ symbol: "AAPL", from: "2026-01-01", to: "2026-01-05" });
    expect(result.bars).toHaveLength(2);
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 77, provider: "Massive", symbol: "AAPL", barsCount: 2 }));
  });
});
