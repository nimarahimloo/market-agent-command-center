export type SurpriseDirection = "above-forecast" | "below-forecast" | "in-line" | "unavailable";

export type SurpriseInput = {
  actual?: number | null;
  forecast?: number | null;
  previous?: number | null;
  scale?: "absolute" | "percent";
};

export type SurpriseResult = {
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  delta: number | null;
  percentDelta: number | null;
  direction: SurpriseDirection;
  basis: "actual-vs-forecast" | "actual-vs-previous" | "unavailable";
};

export function calculateSurprise(input: SurpriseInput): SurpriseResult {
  const actual = Number.isFinite(input.actual) ? Number(input.actual) : null;
  const forecast = Number.isFinite(input.forecast) ? Number(input.forecast) : null;
  const previous = Number.isFinite(input.previous) ? Number(input.previous) : null;
  if (actual === null) return { actual, forecast, previous, delta: null, percentDelta: null, direction: "unavailable", basis: "unavailable" };
  const comparator = forecast ?? previous;
  const basis = forecast !== null ? "actual-vs-forecast" : previous !== null ? "actual-vs-previous" : "unavailable";
  if (comparator === null) return { actual, forecast, previous, delta: null, percentDelta: null, direction: "unavailable", basis };
  const delta = actual - comparator;
  const percentDelta = comparator === 0 ? null : (delta / Math.abs(comparator)) * 100;
  const tolerance = input.scale === "percent" ? 0.01 : Math.max(0.000001, Math.abs(comparator) * 0.0005);
  const direction = Math.abs(delta) <= tolerance ? "in-line" : delta > 0 ? "above-forecast" : "below-forecast";
  return { actual, forecast, previous, delta, percentDelta, direction, basis };
}
