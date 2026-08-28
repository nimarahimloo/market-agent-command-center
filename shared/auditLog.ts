export type AuditEvent = {
  id: number;
  timestamp: number;
  type: string;
  detail: string;
};

export function appendAuditEvent(log: readonly AuditEvent[], event: Omit<AuditEvent, "id">): AuditEvent[] {
  const nextId = log.length === 0 ? 1 : Math.max(...log.map(item => item.id)) + 1;
  const next = { ...event, id: nextId };
  return [...log, next];
}

export function isAppendOnly(before: readonly AuditEvent[], after: readonly AuditEvent[]): boolean {
  return after.length >= before.length && before.every((event, index) => {
    const candidate = after[index];
    return candidate?.id === event.id && candidate.timestamp === event.timestamp && candidate.type === event.type && candidate.detail === event.detail;
  });
}
