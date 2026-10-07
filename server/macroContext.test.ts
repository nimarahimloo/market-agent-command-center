import { describe, expect, it, vi } from "vitest";
import {
  buildMacroContext,
  clearMacroContextCacheForTests,
  parseTradingEconomicsCalendar,
  parseCalendarHtml,
} from "./macroContext";
import { calculateSurprise } from "../shared/surprise";

describe("macro surprise analysis", () => {
  it("calculates above-forecast surprise and relative delta", () => {
    const result = calculateSurprise({
      actual: 3.2,
      forecast: 2.8,
      previous: 2.7,
    });
    expect(result.delta).toBeCloseTo(0.4, 10);
    expect(result).toMatchObject({
      direction: "above-forecast",
      basis: "actual-vs-forecast",
    });
    expect(
      calculateSurprise({ actual: 3.2, forecast: 2.8 }).percentDelta
    ).toBeCloseTo(14.2857, 3);
  });
  it("falls back to previous only when forecast is absent", () =>
    expect(calculateSurprise({ actual: 98, previous: 100 })).toMatchObject({
      delta: -2,
      direction: "below-forecast",
      basis: "actual-vs-previous",
    }));
  it("does not infer a surprise when actual or comparator is missing", () => {
    expect(calculateSurprise({ forecast: 2 })).toMatchObject({
      direction: "unavailable",
      basis: "unavailable",
    });
    expect(calculateSurprise({ actual: 2 })).toMatchObject({
      direction: "unavailable",
      basis: "unavailable",
    });
  });

  it("serves the last verified context as stale when all live providers fail", async () => {
    vi.useFakeTimers();
    clearMacroContextCacheForTests();
    const goodResponse = async (url: string) => {
      if (url.includes("fredgraph.csv"))
        return new Response(
          "DATE,VALUE\n2026-01-01,100\n2026-02-01,101\n2026-03-01,102\n2026-04-01,103\n2026-05-01,104\n2026-06-01,105\n2026-07-01,106\n2026-08-01,107",
          { status: 200 }
        );
      if (url.includes("tradingeconomics"))
        return new Response("[]", { status: 200 });
      return new Response('<a href="/release">CPI release Jan 1</a>', {
        status: 200,
      });
    };
    const fetchMock = vi.fn(goodResponse);
    vi.stubGlobal("fetch", fetchMock);
    const fresh = await buildMacroContext();
    expect(fresh.providerStatus).toBe("fresh");
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
    fetchMock.mockRejectedValue(new Error("provider outage"));
    const stalePromise = buildMacroContext();
    await vi.advanceTimersByTimeAsync(300);
    const stale = await stalePromise;
    expect(stale.providerStatus).toBe("stale");
    expect(stale.fallbackUsed).toBe(true);
    expect(stale.rates.length).toBeGreaterThan(0);
    expect(
      stale.warnings.some(warning =>
        warning.includes("last verified macro context")
      )
    ).toBe(true);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearMacroContextCacheForTests();
  });
  it("does not use retrieval time as a release time when fallback HTML omits a date", () => {
    const result = parseCalendarHtml(
      '<a href="/release">SOFR Averages and Index Data</a>',
      "FRED Release Calendar",
      "https://fred.stlouisfed.org/releases/calendar",
      new Date("2026-10-08T00:00:00Z")
    );
    expect(result[0]?.scheduledAt).toBe("not published by fallback calendar");
  });

  it("normalizes real calendar rows without inventing missing values", () => {
    const parsed = parseTradingEconomicsCalendar([
      {
        Event: "CPI",
        Date: "2026-09-01T12:30:00Z",
        Actual: "3.2",
        Forecast: "3.0",
        Previous: "2.9",
        Unit: "%",
        URL: "https://example.test/cpi",
      },
      {
        Event: "FOMC",
        Date: "2026-09-02T18:00:00Z",
        Actual: null,
        Forecast: null,
        Previous: null,
      },
    ]);
    expect(parsed[0].surprise.delta).toBeCloseTo(0.2, 10);
    expect(parsed[0].surprise.direction).toBe("above-forecast");
    expect(parsed[1].surprise.direction).toBe("unavailable");
    expect(parsed[1].actual).toBeNull();
  });
});
