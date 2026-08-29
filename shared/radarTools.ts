import type { EarlyWarningItem } from "../server/intelligence";

export type EventImpactSynthesis = {
  technical: number;
  macro: number;
  event: number;
  crossMarket: number;
  risk: number;
  disagreement: number;
  uncertainty: number;
  lenses: Array<{ role: string; score: number }>;
};

export type PaperAlert = { id: string; warningId: string; triggeredAt: string; reason: string; acknowledged: boolean };

export function shouldPersistPaperAlert(existingWarningIds: string[], warningId: string) {
  return !existingWarningIds.includes(warningId);
}

export function paperAlertAuditPayload(input: { warningId: string; headline: string; confidence: number }) {
  return { warningId: input.warningId, headline: input.headline, confidence: input.confidence };
}

export type ImpactLensInput = { role: string; score: number };

export function synthesizeEventImpact(item: Pick<EarlyWarningItem, "tone" | "confidence" | "markets" | "severity">, lensOutputs: ImpactLensInput[] = []): EventImpactSynthesis {
  const breadth = Math.min(15, item.markets.length * 3);
  const technical = Math.min(95, Math.round(item.confidence * 0.8 + Math.abs(item.tone) * 1.5));
  const macro = Math.min(95, Math.round(item.confidence * 0.65 + breadth));
  const event = item.severity === "high" ? 84 : item.severity === "medium" ? 68 : 48;
  const crossMarket = Math.min(95, Math.round(item.confidence * 0.7 + breadth * 1.5));
  const risk = Math.max(20, Math.round(100 - item.confidence + (item.severity === "high" ? 20 : 8)));
  const baseByRole: Record<string, number> = { technical, macro, event, crossMarket, risk };
  const lenses = (lensOutputs.length >= 2 ? lensOutputs : Object.entries(baseByRole).map(([role, score]) => ({ role, score }))).map(lens => {
    const role = lens.role.toLowerCase();
    const eventAdjustment = item.tone * (role.includes("technical") ? 1.5 : role.includes("risk") ? -1 : 0.6) + breadth * (role.includes("cross") ? 1.2 : 0.25) + (item.severity === "high" && role.includes("event") ? 8 : 0);
    return { role: lens.role, score: Math.max(0, Math.min(100, Math.round(lens.score + eventAdjustment))) };
  });
  const scores = lenses.map(lens => lens.score);
  const disagreement = Math.max(...scores) - Math.min(...scores);
  return { technical, macro, event, crossMarket, risk, disagreement, uncertainty: Math.min(90, Math.round(100 - item.confidence + disagreement / 2)), lenses };
}

export function evaluatePaperAlert(item: Pick<EarlyWarningItem, "id" | "severity" | "confidence" | "freshness">, threshold: number): PaperAlert | null {
  if (item.freshness === "stale" || item.confidence < threshold || item.severity === "low") return null;
  return { id: `alert-${item.id}`, warningId: item.id, triggeredAt: new Date().toISOString(), reason: `${item.severity} event at ${item.confidence}% confidence`, acknowledged: false };
}

export function applyOpportunityTransition<T extends { status: "new" | "reviewing" | "verified" | "dismissed"; note?: string | null }>(current: T, patch: Partial<Pick<T, "status" | "note">>) {
  return { ...current, ...patch };
}

export function applyCorroboration(items: EarlyWarningItem[]) {
  const groups = new Map<string, EarlyWarningItem[]>();
  for (const item of items) {
    const key = item.title.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 5).join(" ");
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return items.map(item => {
    const key = item.title.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 5).join(" ");
    const sources = new Set((groups.get(key) ?? []).map(groupItem => groupItem.source));
    return { ...item, corroboration: sources.size > 1 ? "cross-source" as const : "single-source" as const };
  });
}
