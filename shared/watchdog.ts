export const WATCHDOG_HEARTBEAT_STALE_AFTER_MS = 3 * 60_000;
export const WATCHDOG_MAX_ATTEMPTS = 3;
export const WATCHDOG_RETRY_DELAYS_MS = [0, 1_000, 5_000] as const;

export type WatchdogCheckStatus = "healthy" | "degraded" | "failed" | "skipped";

export type WatchdogCheck = {
  name: string;
  status: WatchdogCheckStatus;
  observedAt: string;
  ageMs?: number;
  message: string;
  attempts?: number;
};

export function heartbeatAgeMs(lastHeartbeatAt: Date | string | number | null | undefined, now = Date.now()) {
  if (!lastHeartbeatAt) return null;
  const timestamp = new Date(lastHeartbeatAt).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, now - timestamp);
}

export function evaluateHeartbeat(
  lastHeartbeatAt: Date | string | number | null | undefined,
  now = Date.now(),
  staleAfterMs = WATCHDOG_HEARTBEAT_STALE_AFTER_MS,
): WatchdogCheck {
  const observedAt = new Date(now).toISOString();
  const ageMs = heartbeatAgeMs(lastHeartbeatAt, now);
  if (ageMs === null) {
    return { name: "wallet-heartbeat", status: "failed", observedAt, message: "No valid heartbeat has been recorded." };
  }
  if (ageMs > staleAfterMs) {
    return { name: "wallet-heartbeat", status: "degraded", observedAt, ageMs, message: `Heartbeat is stale by ${Math.round(ageMs / 1000)} seconds.` };
  }
  return { name: "wallet-heartbeat", status: "healthy", observedAt, ageMs, message: `Heartbeat is fresh (${Math.round(ageMs / 1000)} seconds old).` };
}

export async function withBoundedRetry<T>(
  task: (attempt: number) => Promise<T>,
  options: { maxAttempts?: number; delaysMs?: readonly number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ value: T; attempts: number }> {
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? WATCHDOG_MAX_ATTEMPTS, WATCHDOG_MAX_ATTEMPTS));
  const delays = options.delaysMs ?? WATCHDOG_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) await sleep(delays[Math.min(attempt - 1, delays.length - 1)] ?? 0);
    try {
      return { value: await task(attempt), attempts: attempt };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Watchdog task failed after bounded retries.");
}

export function summarizeWatchdog(checks: WatchdogCheck[]) {
  if (checks.some(check => check.status === "failed")) return "failed" as const;
  if (checks.some(check => check.status === "degraded")) return "degraded" as const;
  if (checks.some(check => check.status === "healthy")) return "healthy" as const;
  return "skipped" as const;
}
