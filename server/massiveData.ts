import { ENV } from "./_core/env";
import type { HistoricalBar } from "../shared/backtest";

export type HistoricalDataRequest = {
  symbol: string;
  from: string;
  to: string;
  multiplier?: number;
  timespan?: "minute" | "hour" | "day" | "week" | "month";
  adjusted?: boolean;
  limit?: number;
};

export type HistoricalDataResult = {
  provider: "Massive";
  symbol: string;
  bars: HistoricalBar[];
  provenance: {
    endpoint: string;
    retrievedAt: number;
    timezone: "UTC";
    adjusted: boolean;
    multiplier: number;
    timespan: string;
    sourceFirstBarTimestamp?: number;
    sourceLastBarTimestamp?: number;
    warnings: string[];
  };
};

const cache = new Map<string, { result: HistoricalDataResult; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

function validateDate(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${field} must be an ISO date (YYYY-MM-DD)`);
  }
}

export function normalizeMassiveAggregates(payload: unknown, request: HistoricalDataRequest, endpoint: string, retrievedAt = Date.now()): HistoricalDataResult {
  const data = payload as { results?: Array<{ t?: number; o?: number; h?: number; l?: number; c?: number; v?: number }>; status?: string };
  const warnings: string[] = [];
  const rawResults = Array.isArray(data.results) ? data.results : [];
  const bars = rawResults
    .filter(row => [row.t, row.o, row.h, row.l, row.c].every(value => typeof value === "number" && Number.isFinite(value)))
    .map(row => ({ timestamp: row.t as number, open: row.o as number, high: row.h as number, low: row.l as number, close: row.c as number }));
  if (!bars.length) warnings.push("Provider returned no complete OHLC bars for this range.");
  for (let index = 1; index < bars.length; index += 1) {
    if (bars[index].timestamp <= bars[index - 1].timestamp) warnings.push("Provider response contains duplicate or out-of-order timestamps.");
  }
  if (bars.some(bar => bar.low > bar.high || bar.low > bar.open || bar.low > bar.close || bar.high < bar.open || bar.high < bar.close)) {
    warnings.push("At least one OHLC bar violates high/low consistency.");
  }
  if (data.status && data.status !== "OK" && data.status !== "DELAYED") warnings.push(`Provider status: ${data.status}`);
  if (bars.length) {
    const requestedEnd = Date.parse(`${request.to}T00:00:00Z`);
    const lastBarTimestamp = bars[bars.length - 1].timestamp;
    if (requestedEnd - lastBarTimestamp > 3 * 86_400_000) warnings.push("Returned data ends materially before the requested end date; treat the dataset as stale for this range.");
    warnings.push("Provider aggregates are not guaranteed point-in-time snapshots; verify corporate actions, delistings, and adjustment policy before relying on causal results.");
  }
  const intervalMs = (request.multiplier ?? 1) * ({ minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000 }[request.timespan ?? "day"]);
  for (let index = 1; index < bars.length; index += 1) {
    const delta = bars[index].timestamp - bars[index - 1].timestamp;
    const threshold = (request.timespan ?? "day") === "day" ? intervalMs * 4 : intervalMs * 1.5;
    if (delta > threshold) {
      warnings.push(`Potential historical data gap between ${new Date(bars[index - 1].timestamp).toISOString()} and ${new Date(bars[index].timestamp).toISOString()}.`);
      break;
    }
  }
  return {
    provider: "Massive",
    symbol: request.symbol,
    bars,
    provenance: {
      endpoint,
      retrievedAt,
      timezone: "UTC",
      adjusted: request.adjusted ?? true,
      multiplier: request.multiplier ?? 1,
      timespan: request.timespan ?? "day",
      sourceFirstBarTimestamp: bars[0]?.timestamp,
      sourceLastBarTimestamp: bars[bars.length - 1]?.timestamp,
      warnings,
    },
  };
}

export async function fetchMassiveHistorical(request: HistoricalDataRequest): Promise<HistoricalDataResult> {
  if (!ENV.massiveApiKey) throw new Error("Massive API key is not configured");
  validateDate(request.from, "from");
  validateDate(request.to, "to");
  if (!/^[A-Za-z0-9._/-]{1,40}$/.test(request.symbol)) throw new Error("Invalid symbol");
  const multiplier = request.multiplier ?? 1;
  const timespan = request.timespan ?? "day";
  const endpoint = `https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(request.symbol)}/range/${multiplier}/${timespan}/${request.from}/${request.to}`;
  const url = new URL(endpoint);
  url.searchParams.set("adjusted", String(request.adjusted ?? true));
  url.searchParams.set("sort", "asc");
  url.searchParams.set("limit", String(Math.min(request.limit ?? 5000, 50_000)));
  const cacheKey = url.toString();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(url, { headers: { Authorization: `Bearer ${ENV.massiveApiKey}` } });
    if (response.ok || (response.status !== 429 && response.status < 500)) break;
    await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
  }
  if (!response?.ok) {
    if (response?.status === 403) throw new Error("Massive rejected this dataset or plan; check product entitlements for the requested symbol.");
    if (response?.status === 429) throw new Error("Massive rate limit reached after bounded retries; try again shortly.");
    throw new Error(`Massive request failed with HTTP ${response?.status ?? "unknown"}`);
  }
  const result = normalizeMassiveAggregates(await response.json(), request, endpoint, Date.now());
  cache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}
