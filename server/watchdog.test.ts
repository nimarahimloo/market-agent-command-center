import { describe, expect, it, vi } from "vitest";
import { evaluateHeartbeat, summarizeWatchdog, withBoundedRetry } from "../shared/watchdog";

describe("watchdog policy", () => {
  it("marks missing and stale heartbeats explicitly", () => {
    expect(evaluateHeartbeat(null, 1_000).status).toBe("failed");
    expect(evaluateHeartbeat(1_000, 1_000 + 180_001).status).toBe("degraded");
    expect(evaluateHeartbeat(1_000, 1_000 + 30_000).status).toBe("healthy");
  });

  it("retries a transient task with a bounded attempt count", async () => {
    let calls = 0;
    const result = await withBoundedRetry(async attempt => {
      calls += 1;
      if (attempt < 3) throw new Error("transient");
      return "ok";
    }, { sleep: vi.fn(async () => undefined) });
    expect(result).toEqual({ value: "ok", attempts: 3 });
    expect(calls).toBe(3);
  });

  it("does not retry forever and surfaces the final failure", async () => {
    const calls: number[] = [];
    await expect(withBoundedRetry(async attempt => {
      calls.push(attempt);
      throw new Error("provider down");
    }, { sleep: vi.fn(async () => undefined) })).rejects.toThrow("provider down");
    expect(calls).toEqual([1, 2, 3]);
  });

  it("summarizes failed checks above degraded and healthy checks", () => {
    expect(summarizeWatchdog([{ name: "a", status: "healthy", observedAt: "now", message: "ok" }])).toBe("healthy");
    expect(summarizeWatchdog([
      { name: "a", status: "degraded", observedAt: "now", message: "stale" },
      { name: "b", status: "healthy", observedAt: "now", message: "ok" },
    ])).toBe("degraded");
    expect(summarizeWatchdog([{ name: "a", status: "failed", observedAt: "now", message: "down" }])).toBe("failed");
  });
});
