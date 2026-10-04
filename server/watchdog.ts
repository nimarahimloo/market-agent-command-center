import { getEnabledWalletConnections, getUserByOpenId, markWalletHeartbeat, appendAuditEventToDb } from "./db";
import { fetchEarlyWarnings } from "./intelligence";
import { buildMacroContext } from "./macroContext";
import { fetchReadOnlyWalletPortfolio } from "./wallet";
import { ENV } from "./_core/env";
import { evaluateHeartbeat, summarizeWatchdog, withBoundedRetry, type WatchdogCheck } from "../shared/watchdog";

export async function runWatchdog(now = Date.now()) {
  const checks: WatchdogCheck[] = [];
  const owner = ENV.ownerOpenId ? await getUserByOpenId(ENV.ownerOpenId) : undefined;
  const ownerId = owner?.id;
  const observedAt = new Date(now).toISOString();

  try {
    const result = await withBoundedRetry(() => fetchEarlyWarnings(undefined));
    const staleCount = result.value.filter(item => item.freshness === "stale").length;
    checks.push({
      name: "news-radar",
      status: staleCount === result.value.length && result.value.length > 0 ? "degraded" : "healthy",
      observedAt,
      message: `${result.value.length} events received; ${staleCount} stale.`,
      attempts: result.attempts,
    });
  } catch (error) {
    checks.push({ name: "news-radar", status: "failed", observedAt, message: error instanceof Error ? error.message : "News radar failed." });
  }

  try {
    const context = await withBoundedRetry(() => buildMacroContext());
    checks.push({
      name: "macro-context",
      status: context.value.providerStatus === "stale" ? "degraded" : context.value.providerStatus === "partial" ? "degraded" : "healthy",
      observedAt,
      message: `Macro provider is ${context.value.providerStatus ?? "fresh"}${context.value.fallbackUsed ? " with fallback" : ""}.`,
      attempts: context.attempts,
    });
  } catch (error) {
    checks.push({ name: "macro-context", status: "failed", observedAt, message: error instanceof Error ? error.message : "Macro context failed." });
  }

  const connections = await getEnabledWalletConnections();
  for (const connection of connections) {
    const checkName = `wallet:${connection.network}`;
    try {
      const result = await withBoundedRetry(() => fetchReadOnlyWalletPortfolio({ network: connection.network, address: connection.publicAddress }));
      await markWalletHeartbeat(connection.ownerId);
      const heartbeat = evaluateHeartbeat(new Date(), now);
      checks.push({ ...heartbeat, name: checkName, message: `Wallet refresh succeeded via ${result.value.provider}.`, attempts: result.attempts });
      await appendAuditEventToDb({ ownerId: connection.ownerId, eventType: "watchdog_wallet_refresh", entityType: "watchdog", payload: { check: checkName, status: "healthy", attempts: result.attempts, provider: result.value.provider, retrievedAt: result.value.retrievedAt, taskUid: connection.monitorTaskUid } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wallet refresh failed.";
      checks.push({ name: checkName, status: "failed", observedAt, message });
      await appendAuditEventToDb({ ownerId: connection.ownerId, eventType: "watchdog_wallet_failure", entityType: "watchdog", payload: { check: checkName, status: "failed", message, taskUid: connection.monitorTaskUid } });
    }
  }

  const status = summarizeWatchdog(checks);
  if (ownerId) {
    await appendAuditEventToDb({ ownerId, eventType: "watchdog_run", entityType: "watchdog", payload: { status, checks, enabledWallets: connections.length, observedAt } });
  }
  return { ok: status !== "failed", status, checks, enabledWallets: connections.length, observedAt };
}
