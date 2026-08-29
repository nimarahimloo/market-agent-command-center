import { describe, expect, it } from "vitest";
import { getMassiveProviderState } from "../shared/massiveProviderState";

describe("Massive provider state mapping", () => {
  const base = { source: "massive" as const, fetching: false, hasData: false, configured: true };
  it("distinguishes demo, disconnected, loading, connected, entitlement, rate-limit, and outage", () => {
    expect(getMassiveProviderState({ ...base, source: "demo" }).label).toBe("Demo fallback");
    expect(getMassiveProviderState({ ...base, configured: false }).label).toBe("Massive disconnected");
    expect(getMassiveProviderState({ ...base, fetching: true }).label).toBe("Connecting to Massive");
    expect(getMassiveProviderState({ ...base, hasData: true }).label).toBe("Massive connected");
    expect(getMassiveProviderState({ ...base, errorMessage: "Massive rejected this dataset or plan" }).label).toBe("Entitlement required");
    expect(getMassiveProviderState({ ...base, errorMessage: "Massive rate limit reached" }).label).toBe("Rate limited");
    expect(getMassiveProviderState({ ...base, errorMessage: "Massive request failed with HTTP 503" }).label).toBe("Massive outage");
  });
});
