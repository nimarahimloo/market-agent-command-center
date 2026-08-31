import { describe, expect, it } from "vitest";
import { parseTradingEconomicsCalendar } from "./macroContext";
import { calculateSurprise } from "../shared/surprise";

describe("macro surprise analysis", () => {
  it("calculates above-forecast surprise and relative delta", () => {
    const result = calculateSurprise({ actual: 3.2, forecast: 2.8, previous: 2.7 });
    expect(result.delta).toBeCloseTo(0.4, 10);
    expect(result).toMatchObject({ direction: "above-forecast", basis: "actual-vs-forecast" });
    expect(calculateSurprise({ actual: 3.2, forecast: 2.8 }).percentDelta).toBeCloseTo(14.2857, 3);
  });
  it("falls back to previous only when forecast is absent", () => expect(calculateSurprise({ actual: 98, previous: 100 })).toMatchObject({ delta: -2, direction: "below-forecast", basis: "actual-vs-previous" }));
  it("does not infer a surprise when actual or comparator is missing", () => {
    expect(calculateSurprise({ forecast: 2 })).toMatchObject({ direction: "unavailable", basis: "unavailable" });
    expect(calculateSurprise({ actual: 2 })).toMatchObject({ direction: "unavailable", basis: "unavailable" });
  });
  it("normalizes real calendar rows without inventing missing values", () => {
    const parsed = parseTradingEconomicsCalendar([{ Event: "CPI", Date: "2026-09-01T12:30:00Z", Actual: "3.2", Forecast: "3.0", Previous: "2.9", Unit: "%", URL: "https://example.test/cpi" }, { Event: "FOMC", Date: "2026-09-02T18:00:00Z", Actual: null, Forecast: null, Previous: null }]);
    expect(parsed[0].surprise.delta).toBeCloseTo(0.2, 10);
    expect(parsed[0].surprise.direction).toBe("above-forecast");
    expect(parsed[1].surprise.direction).toBe("unavailable");
    expect(parsed[1].actual).toBeNull();
  });
});
