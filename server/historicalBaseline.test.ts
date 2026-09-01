import { describe, expect, it } from "vitest";
import { buildBaselineGroups, classifyEconomicRegime, percentileRank, selectContextualBaseline } from "../shared/historicalBaseline";

describe("historical multidimensional baselines", () => {
  it("classifies observable rate regimes and unknown data safely", () => {
    expect(classifyEconomicRegime(5.25, 4.9)).toBe("rising-rates");
    expect(classifyEconomicRegime(3.5, 4)).toBe("easing-rates");
    expect(classifyEconomicRegime(5.25, 5.25)).toBe("restrictive");
    expect(classifyEconomicRegime(null, null)).toBe("unknown");
  });
  it("computes empirical percentile with ties", () => expect(percentileRank(2, [1, 2, 2, 3])).toBe(75));
  it("groups exact country/regime and falls back to country then global", () => {
    const rows = Array.from({ length: 8 }, (_, index) => ({ indicator: "CPI", country: "US", regime: "restrictive" as const, unit: "%", delta: index + 1, date: `2026-0${(index % 9) + 1}-01` }));
    const groups = buildBaselineGroups(rows);
    const exact = selectContextualBaseline({ indicator: "CPI", country: "US", regime: "restrictive", unit: "%" }, 9, groups);
    expect(exact.fallbackLevel).toBe("indicator-country-regime");
    expect(exact.percentile).toBe(100);
    expect(exact.comparableReleases).toHaveLength(3);
    const fallback = selectContextualBaseline({ indicator: "CPI", country: "US", regime: "accommodative", unit: "%" }, 9, groups);
    expect(fallback.fallbackLevel).toBe("indicator-country");
  });
  it("blocks insufficient historical evidence", () => {
    const groups = buildBaselineGroups([{ indicator: "GDP", country: "DE", regime: "unknown", unit: "%", delta: 1, date: "2026-01-01" }]);
    expect(selectContextualBaseline({ indicator: "GDP", country: "DE", regime: "unknown", unit: "%" }, 2, groups).fallbackLevel).toBe("unavailable");
  });
});
