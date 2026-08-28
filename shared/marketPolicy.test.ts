import { describe, expect, it } from "vitest";
import { MARKET_POLICY } from "./marketPolicy";

describe("market execution policy", () => {
  it("keeps live trading disabled by default", () => {
    expect(MARKET_POLICY.liveTradingEnabled).toBe(false);
    expect(MARKET_POLICY.paperTradingEnabled).toBe(true);
  });

  it("requires human approval for any future live order path", () => {
    expect(MARKET_POLICY.humanApprovalRequiredForLiveOrders).toBe(true);
    expect(MARKET_POLICY.immutableAuditRequired).toBe(true);
  });
});
