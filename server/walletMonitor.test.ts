import { describe, expect, it } from "vitest";
import { deriveWalletMonitorState, isWalletHeartbeatStale, shouldChangeWalletMonitor, WALLET_HEARTBEAT_STALE_AFTER_MS } from "../shared/walletMonitor";

describe("wallet monitor lifecycle", () => {
  it("does not request a provider change for an already matching state", () => {
    expect(shouldChangeWalletMonitor({ enabled: true, taskUid: "task-1" }, true)).toBe(false);
    expect(shouldChangeWalletMonitor({ enabled: false, taskUid: "task-1" }, false)).toBe(true);
    expect(shouldChangeWalletMonitor({ enabled: false, taskUid: null }, true)).toBe(true);
    expect(shouldChangeWalletMonitor({ enabled: true, taskUid: "task-1" }, false)).toBe(true);
  });

  it("treats a missing or older-than-three-interval heartbeat as stale", () => {
    const now = Date.parse("2026-09-04T12:00:00.000Z");
    expect(isWalletHeartbeatStale(null, now)).toBe(true);
    expect(isWalletHeartbeatStale(now - WALLET_HEARTBEAT_STALE_AFTER_MS, now)).toBe(false);
    expect(isWalletHeartbeatStale(now - WALLET_HEARTBEAT_STALE_AFTER_MS - 1, now)).toBe(true);
  });

  it("derives an honest UI state without inventing a running heartbeat", () => {
    const now = Date.parse("2026-09-04T12:00:00.000Z");
    expect(deriveWalletMonitorState({ enabled: false, status: "running", lastHeartbeatAt: now }, now)).toBe("off");
    expect(deriveWalletMonitorState({ enabled: true, status: "scheduled", lastHeartbeatAt: now - 60_000 }, now)).toBe("scheduled");
    expect(deriveWalletMonitorState({ enabled: true, status: "running", lastHeartbeatAt: now }, now)).toBe("running");
    expect(deriveWalletMonitorState({ enabled: true, status: "running", lastHeartbeatAt: now - WALLET_HEARTBEAT_STALE_AFTER_MS - 1 }, now)).toBe("stale");
  });
});
