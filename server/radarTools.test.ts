import { describe, expect, it } from "vitest";
import { applyCorroboration, applyOpportunityTransition, evaluatePaperAlert, paperAlertAuditPayload, shouldPersistPaperAlert, synthesizeEventImpact } from "../shared/radarTools";
import type { EarlyWarningItem } from "./intelligence";

const item = (overrides: Partial<EarlyWarningItem> = {}): EarlyWarningItem => ({
  id: "a", title: "Central bank signals market rate change", url: "https://one.example/a", publishedAt: new Date().toISOString(), retrievedAt: new Date().toISOString(), source: "one.example", sourceTier: "tier-1", severity: "high", markets: ["Rates"], entities: ["Rates"], tone: -4, corroboration: "single-source", confidence: 82, leadTimeEstimateMinutes: 30, freshness: "fresh", ...overrides,
});

describe("radar tools", () => {
  it("marks same normalized event as cross-source only when domains differ", () => {
    const result = applyCorroboration([item(), item({ id: "b", url: "https://two.example/b", source: "two.example" })]);
    expect(result.every(entry => entry.corroboration === "cross-source")).toBe(true);
    expect(applyCorroboration([item()])[0].corroboration).toBe("single-source");
  });

  it("exposes bounded impact scores plus disagreement and uncertainty", () => {
    const result = synthesizeEventImpact(item());
    expect(Object.values(result).filter((value): value is number => typeof value === "number").every(value => value >= 0 && value <= 100)).toBe(true);
    expect(result.lenses.length).toBeGreaterThanOrEqual(2);
    expect(result.disagreement).toBeGreaterThanOrEqual(0);
    expect(result.uncertainty).toBeGreaterThanOrEqual(0);
  });

  it("updates opportunity status and note without mutating the prior record", () => {
    const current = { status: "new" as const, note: null };
    const next = applyOpportunityTransition(current, { status: "reviewing", note: "Check eligibility" });
    expect(next).toEqual({ status: "reviewing", note: "Check eligibility" });
    expect(current).toEqual({ status: "new", note: null });
  });

  it("keeps paper-alert persistence idempotent and produces an auditable payload", () => {
    expect(shouldPersistPaperAlert([], "w-1")).toBe(true);
    expect(shouldPersistPaperAlert(["w-1"], "w-1")).toBe(false);
    expect(shouldPersistPaperAlert(["w-1"], "w-2")).toBe(true);
    expect(paperAlertAuditPayload({ warningId: "w-1", headline: "Rates event", confidence: 81 })).toEqual({ warningId: "w-1", headline: "Rates event", confidence: 81 });
  });

  it("creates no alert for stale, low-severity, or below-threshold events", () => {
    expect(evaluatePaperAlert(item({ freshness: "stale" }), 70)).toBeNull();
    expect(evaluatePaperAlert(item({ severity: "low" }), 70)).toBeNull();
    expect(evaluatePaperAlert(item({ confidence: 69 }), 70)).toBeNull();
    expect(evaluatePaperAlert(item({ confidence: 70 }), 70)?.warningId).toBe("a");
  });
});
