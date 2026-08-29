export type MassiveProviderState = {
  label: string;
  tone: "neutral" | "loading" | "connected" | "warning";
  copy: string;
};

export function getMassiveProviderState(input: {
  source: "demo" | "massive";
  fetching: boolean;
  hasData: boolean;
  errorMessage?: string;
  configured: boolean;
}): MassiveProviderState {
  if (input.source === "demo") return { label: "Demo fallback", tone: "neutral", copy: "No provider call; bundled bars are explicitly illustrative." };
  if (!input.configured) return { label: "Massive disconnected", tone: "warning", copy: "No server-side credential is configured; connect a read-only key before fetching." };
  if (input.fetching) return { label: "Connecting to Massive", tone: "loading", copy: "Fetching historical OHLCV server-side…" };
  if (input.errorMessage?.includes("rate limit")) return { label: "Rate limited", tone: "warning", copy: "Massive asked us to slow down; retry after the bounded backoff." };
  if (input.errorMessage?.includes("rejected")) return { label: "Entitlement required", tone: "warning", copy: "The key is valid, but this symbol or range is outside the provider plan." };
  if (input.errorMessage && /HTTP 5\d\d|unavailable|failed/i.test(input.errorMessage)) return { label: "Massive outage", tone: "warning", copy: "Massive appears temporarily unavailable; no bars were passed to the backtest." };
  if (input.errorMessage) return { label: "Provider unavailable", tone: "warning", copy: "Massive did not return usable historical data for this request." };
  if (input.hasData) return { label: "Massive connected", tone: "connected", copy: "Real OHLCV normalized server-side with provenance." };
  return { label: "Ready to connect", tone: "neutral", copy: "Run the request to fetch real historical bars." };
}
