import { describe, expect, it } from "vitest";
import { MARKET_POLICY } from "../shared/marketPolicy";

describe("market execution policy", () => {
  it("keeps live trading disabled by default", () => {
    expect(MARKET_POLICY.liveTradingEnabled).toBe(false);
    expect(MARKET_POLICY.paperTradingEnabled).toBe(true);
  });

  it("requires human approval and an audit trail for future live orders", () => {
    expect(MARKET_POLICY.humanApprovalRequiredForLiveOrders).toBe(true);
    expect(MARKET_POLICY.immutableAuditRequired).toBe(true);
  });
});
