import type { HistoricalBar } from "./backtest";

export type ReactionHorizon = "5m" | "30m" | "2h" | "1d";
export type ReactionPoint = { horizon: ReactionHorizon; targetTimestamp: number; close: number | null; returnPct: number | null; status: "ready" | "missing-bar" | "no-baseline" };

const HORIZONS: Array<[ReactionHorizon, number]> = [["5m", 5 * 60_000], ["30m", 30 * 60_000], ["2h", 2 * 3_600_000], ["1d", 86_400_000]];

export function calculatePostReleaseReaction(bars: HistoricalBar[], releaseTimestamp: number, toleranceMs = 15 * 60_000) {
  const sorted = bars.filter(bar => Number.isFinite(bar.timestamp) && Number.isFinite(bar.close)).slice().sort((a, b) => a.timestamp - b.timestamp);
  const baseline = [...sorted].reverse().find(bar => bar.timestamp <= releaseTimestamp)?.close ?? null;
  return {
    baselineClose: baseline,
    releaseTimestamp,
    points: HORIZONS.map(([horizon, offset]) => {
      const targetTimestamp = releaseTimestamp + offset;
      const bar = sorted.find(item => item.timestamp >= targetTimestamp && item.timestamp <= targetTimestamp + toleranceMs);
      if (baseline === null) return { horizon, targetTimestamp, close: null, returnPct: null, status: "no-baseline" as const };
      if (!bar) return { horizon, targetTimestamp, close: null, returnPct: null, status: "missing-bar" as const };
      return { horizon, targetTimestamp, close: bar.close, returnPct: ((bar.close / baseline) - 1) * 100, status: "ready" as const };
    }),
  };
}

export function summarizeReactions(reactions: Array<{ returnPct: number | null }[]>) {
  const points = reactions.flat().map(point => point.returnPct).filter((value): value is number => value !== null && Number.isFinite(value));
  if (!points.length) return { sampleCount: 0, meanReturnPct: null, medianReturnPct: null, directionHitRate: null };
  const sorted = points.slice().sort((a, b) => a - b);
  const medianReturnPct = sorted[Math.floor(sorted.length / 2)];
  return { sampleCount: points.length, meanReturnPct: points.reduce((sum, value) => sum + value, 0) / points.length, medianReturnPct, directionHitRate: points.filter(value => value > 0).length / points.length };
}
