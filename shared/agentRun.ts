export function buildCancelledRunPatch(now: Date = new Date()) {
  return { status: "cancelled" as const, finishedAt: now };
}

export function buildAgentBatchCancelledAudit(ownerId: number, runId: number) {
  return { ownerId, eventType: "agent_batch_cancelled", entityType: "agent_run", entityId: runId, payload: { runId } };
}
