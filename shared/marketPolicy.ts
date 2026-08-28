export const MARKET_POLICY = {
  liveTradingEnabled: false,
  paperTradingEnabled: true,
  humanApprovalRequiredForLiveOrders: true,
  immutableAuditRequired: true,
} as const;

export type MarketPolicy = typeof MARKET_POLICY;
