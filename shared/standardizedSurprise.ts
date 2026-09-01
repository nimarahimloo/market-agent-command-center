import type { SurpriseResult } from "./surprise";

export type StandardizedSurprise = {
  zScore: number | null;
  severity: "normal" | "notable" | "extreme" | "unavailable";
  sampleCount: number;
  meanDelta: number | null;
  standardDeviation: number | null;
  baselineWindow: { from: string | null; to: string | null };
  status: "ready" | "insufficient-history" | "zero-variance" | "missing-surprise";
};

function mean(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / values.length; }

export function calculateStandardizedSurprise(surprise: SurpriseResult, history: Array<{ delta: number; date?: string }>, minSample = 8): StandardizedSurprise {
  const usable = history.filter(item => Number.isFinite(item.delta));
  const dates = usable.map(item => item.date).filter((date): date is string => Boolean(date)).sort();
  const base = { sampleCount: usable.length, baselineWindow: { from: dates[0] ?? null, to: dates.at(-1) ?? null } };
  if (surprise.delta === null) return { ...base, zScore: null, severity: "unavailable", meanDelta: null, standardDeviation: null, status: "missing-surprise" };
  if (usable.length < minSample) return { ...base, zScore: null, severity: "unavailable", meanDelta: null, standardDeviation: null, status: "insufficient-history" };
  const sorted = usable.map(item => item.delta).sort((a, b) => a - b);
  const trim = Math.floor(sorted.length * 0.1);
  const winsorized = sorted.map((value, index) => index < trim ? sorted[trim] : index >= sorted.length - trim ? sorted[sorted.length - trim - 1] : value);
  const meanDelta = mean(winsorized);
  const variance = mean(winsorized.map(value => (value - meanDelta) ** 2));
  const standardDeviation = Math.sqrt(variance);
  if (!Number.isFinite(standardDeviation) || standardDeviation < 1e-9) return { ...base, zScore: null, severity: "unavailable", meanDelta, standardDeviation: 0, status: "zero-variance" };
  const zScore = Math.max(-6, Math.min(6, (surprise.delta - meanDelta) / standardDeviation));
  const magnitude = Math.abs(zScore);
  return { ...base, zScore, severity: magnitude >= 2 ? "extreme" : magnitude >= 1 ? "notable" : "normal", meanDelta, standardDeviation, status: "ready" };
}
