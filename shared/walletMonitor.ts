export const WALLET_HEARTBEAT_INTERVAL_MS = 60_000;
export const WALLET_HEARTBEAT_STALE_AFTER_MS = WALLET_HEARTBEAT_INTERVAL_MS * 3;

export type WalletMonitorState = "off" | "scheduled" | "running" | "stale";

export function isWalletHeartbeatStale(lastHeartbeatAt: Date | string | number | null | undefined, now = Date.now()) {
  if (!lastHeartbeatAt) return true;
  const timestamp = new Date(lastHeartbeatAt).getTime();
  return !Number.isFinite(timestamp) || now - timestamp > WALLET_HEARTBEAT_STALE_AFTER_MS;
}

export function deriveWalletMonitorState(input: { enabled: boolean; status?: string | null; lastHeartbeatAt?: Date | string | number | null }, now = Date.now()): WalletMonitorState {
  if (!input.enabled) return "off";
  if (isWalletHeartbeatStale(input.lastHeartbeatAt, now)) return "stale";
  if (input.status === "running") return "running";
  return "scheduled";
}

export function shouldChangeWalletMonitor(current: { enabled: boolean; taskUid?: string | null }, requestedEnabled: boolean) {
  if (requestedEnabled) return !current.enabled || !current.taskUid;
  return current.enabled || Boolean(current.taskUid);
}
