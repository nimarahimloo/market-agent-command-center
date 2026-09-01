import { describe, expect, it } from "vitest";
import { calculatePostReleaseReaction, summarizeReactions } from "../shared/marketReaction";

describe("post-release market reaction", () => {
  it("aligns real bars to post-release horizons", () => {
    const release = Date.parse("2026-09-01T12:00:00Z");
    const bars = [release - 60_000, release + 5 * 60_000, release + 30 * 60_000, release + 2 * 3_600_000, release + 86_400_000].map((timestamp, index) => ({ timestamp, open: 100 + index, high: 101 + index, low: 99 + index, close: 100 + index }));
    const result = calculatePostReleaseReaction(bars, release);
    expect(result.baselineClose).toBe(100);
    expect(result.points[0].horizon).toBe("5m");
    expect(result.points[0].returnPct).toBeCloseTo(1, 10);
    expect(result.points[0].status).toBe("ready");
    expect(result.points[3].status).toBe("ready");
  });
  it("marks missing baseline and future bars explicitly", () => {
    const result = calculatePostReleaseReaction([], Date.parse("2026-09-01T12:00:00Z"));
    expect(result.points.every(point => point.status === "no-baseline")).toBe(true);
  });
  it("summarizes observed reactions without inventing missing points", () => {
    expect(summarizeReactions([[{ returnPct: 1 }, { returnPct: -1 }, { returnPct: null }]])).toMatchObject({ sampleCount: 2, meanReturnPct: 0, directionHitRate: 0.5 });
  });
});
