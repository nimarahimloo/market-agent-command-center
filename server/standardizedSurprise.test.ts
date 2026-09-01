import { describe, expect, it } from "vitest";
import { calculateStandardizedSurprise } from "../shared/standardizedSurprise";
import { calculateSurprise } from "../shared/surprise";

describe("standardized surprise", () => {
  it("returns a historical z-score and severity", () => {
    const result = calculateStandardizedSurprise(calculateSurprise({ actual: 1.5, forecast: 1 }), Array.from({ length: 10 }, (_, index) => ({ delta: index / 10, date: `2026-0${index + 1}-01` })));
    expect(result.status).toBe("ready");
    expect(result.zScore).not.toBeNull();
    expect(result.sampleCount).toBe(10);
    expect(result.baselineWindow.from).toBe("2026-01-01");
  });
  it("blocks low sample history and zero variance", () => {
    const surprise = calculateSurprise({ actual: 2, forecast: 1 });
    expect(calculateStandardizedSurprise(surprise, [{ delta: 0.2 }]).status).toBe("insufficient-history");
    expect(calculateStandardizedSurprise(surprise, Array.from({ length: 8 }, () => ({ delta: 0.2 }))).status).toBe("zero-variance");
  });
  it("keeps an extreme current delta bounded while using historical baseline", () => {
    const history = Array.from({ length: 20 }, (_, index) => ({ delta: index % 2 ? 0.1 : -0.1 }));
    const result = calculateStandardizedSurprise(calculateSurprise({ actual: 100, forecast: 0 }), history);
    expect(result.status).toBe("ready");
    expect(Math.abs(result.zScore ?? 0)).toBeLessThanOrEqual(6);
    expect(result.severity).toBe("extreme");
  });
});
