import type { SurpriseResult } from "./surprise";

export type EconomicRegime = "rising-rates" | "easing-rates" | "restrictive" | "accommodative" | "unknown";
export type BaselineKey = { indicator: string; country: string; regime: EconomicRegime; unit: string | null };
export type HistoricalSurprise = { delta: number; date: string; actual?: number | null; forecast?: number | null; previous?: number | null; regime: EconomicRegime; indicator?: string; country?: string; unit?: string | null };
export type ContextualSurprise = {
  baselineKey: BaselineKey;
  fallbackLevel: "indicator-country-regime" | "indicator-country" | "indicator" | "unavailable";
  percentile: number | null;
  rank: number | null;
  comparableCount: number;
  comparableReleases: HistoricalSurprise[];
  distribution: Array<{ bin: string; count: number }>;
};

export function baselineKeyString(key: BaselineKey) { return `${key.indicator.toLowerCase()}|${key.country.toLowerCase()}|${key.regime}|${key.unit ?? "unknown"}`; }

export function classifyEconomicRegime(currentRate: number | null, priorRate: number | null): EconomicRegime {
  if (currentRate === null) return "unknown";
  if (priorRate !== null && currentRate - priorRate >= 0.1) return "rising-rates";
  if (priorRate !== null && priorRate - currentRate >= 0.1) return "easing-rates";
  return currentRate >= 4 ? "restrictive" : "accommodative";
}

export function percentileRank(value: number, history: number[]) {
  if (!history.length) return null;
  const lessOrEqual = history.filter(item => item <= value).length;
  return (lessOrEqual / history.length) * 100;
}

export function selectContextualBaseline(key: BaselineKey, delta: number | null, groups: Map<string, HistoricalSurprise[]>, minSample = 8): ContextualSurprise {
  const levels: Array<[ContextualSurprise["fallbackLevel"], BaselineKey]> = [
    ["indicator-country-regime", key],
    ["indicator-country", { ...key, regime: "unknown" }],
    ["indicator", { ...key, country: "all", regime: "unknown" }],
  ];
  for (const [fallbackLevel, candidate] of levels) {
    const history = (groups.get(baselineKeyString(candidate)) ?? []).filter(item => Number.isFinite(item.delta));
    if (history.length < minSample || delta === null) continue;
    const values = history.map(item => item.delta).sort((a, b) => a - b);
    const comparableReleases = history.slice().sort((a, b) => Math.abs(a.delta - delta) - Math.abs(b.delta - delta)).slice(0, 3);
    const min = values[0], max = values.at(-1) ?? min, width = max === min ? 1 : (max - min) / 8;
    const distribution = Array.from({ length: 8 }, (_, index) => ({ bin: `${(min + index * width).toFixed(2)}`, count: history.filter(item => index === 7 ? item.delta >= min + index * width : item.delta >= min + index * width && item.delta < min + (index + 1) * width).length }));
    return { baselineKey: key, fallbackLevel, percentile: percentileRank(delta, values), rank: values.filter(item => item < delta).length + 1, comparableCount: history.length, comparableReleases, distribution };
  }
  return { baselineKey: key, fallbackLevel: "unavailable", percentile: null, rank: null, comparableCount: 0, comparableReleases: [], distribution: [] };
}

export function buildBaselineGroups(rows: HistoricalSurprise[]) {
  const groups = new Map<string, HistoricalSurprise[]>();
  for (const row of rows) {
    const exactKey: BaselineKey = { indicator: row.indicator ?? "unknown", country: row.country ?? "unknown", regime: row.regime, unit: row.unit ?? null };
    const keys = [baselineKeyString(exactKey), baselineKeyString({ ...exactKey, regime: "unknown" }), baselineKeyString({ ...exactKey, country: "all", regime: "unknown" })];
    for (const key of keys) groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}
