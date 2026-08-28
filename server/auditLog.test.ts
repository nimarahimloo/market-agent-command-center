import { describe, expect, it } from "vitest";
import { appendAuditEvent, isAppendOnly } from "../shared/auditLog";

describe("append-only audit log", () => {
  it("appends a new event without changing prior entries", () => {
    const first = [{ id: 1, timestamp: 100, type: "POLICY_CHECK", detail: "live disabled" }];
    const next = appendAuditEvent(first, { timestamp: 200, type: "SIGNAL_CREATED", detail: "SR-042" });
    expect(next).toHaveLength(2);
    expect(next[1]?.id).toBe(2);
    expect(isAppendOnly(first, next)).toBe(true);
  });

  it("rejects a reordered or mutated history", () => {
    const before = [
      { id: 1, timestamp: 100, type: "POLICY_CHECK", detail: "live disabled" },
      { id: 2, timestamp: 200, type: "SIGNAL_CREATED", detail: "SR-042" },
    ];
    const reordered = [before[1], before[0]];
    const mutated = [{ id: 1, timestamp: 100, type: "POLICY_CHECK", detail: "changed" }, before[1]];
    expect(isAppendOnly(before, reordered)).toBe(false);
    expect(isAppendOnly(before, mutated)).toBe(false);
  });
});
