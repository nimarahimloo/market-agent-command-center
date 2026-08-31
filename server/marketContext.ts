import { fetchMassiveHistorical } from "./massiveData";
import type { HistoricalBar } from "../shared/backtest";
import type { EarlyWarningItem } from "./intelligence";

export type MarketContext = {
  market: string;
  symbol: string;
  proxy: string;
  bars: number;
  asOf: number | null;
  lastClose: number | null;
  return1d: number | null;
  return5d: number | null;
  sma20: number | null;
  sma50: number | null;
  volatility20: number | null;
  range20: number | null;
  warnings: string[];
  provenance: { provider: string; endpoint?: string; retrievedAt?: number; sourceFirstBarTimestamp?: number; sourceLastBarTimestamp?: number };
};

const PROXIES: Record<string, { symbol: string; label: string }> = {
  Crypto: { symbol: "X:BTCUSD", label: "BTC spot proxy" },
  Equities: { symbol: "SPY", label: "S&P 500 ETF proxy" },
  Indices: { symbol: "SPY", label: "S&P 500 ETF proxy" },
  Oil: { symbol: "USO", label: "WTI ETF proxy" },
  Gold: { symbol: "GLD", label: "gold ETF proxy" },
  Silver: { symbol: "SLV", label: "silver ETF proxy" },
  FX: { symbol: "UUP", label: "US dollar ETF proxy" },
  Rates: { symbol: "TLT", label: "long-duration Treasury ETF proxy" },
};

function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function returns(bars: HistoricalBar[], lookback: number) { if (bars.length <= lookback) return null; const from = bars[bars.length - 1 - lookback].close; return from ? ((bars[bars.length - 1].close / from) - 1) * 100 : null; }
function volatility20(bars: HistoricalBar[]) { const changes = bars.slice(-21).map((bar, index, values) => index === 0 ? null : values[index - 1].close ? (bar.close / values[index - 1].close) - 1 : null).filter((value): value is number => value !== null); if (changes.length < 2) return null; const mean = average(changes) ?? 0; return Math.sqrt(average(changes.map(value => (value - mean) ** 2)) ?? 0) * Math.sqrt(252) * 100; }

export function summarizeMarketContext(market: string, symbol: string, proxy: string, bars: HistoricalBar[], provenance: MarketContext["provenance"], warnings: string[] = []): MarketContext {
  const closes = bars.map(bar => bar.close);
  const last = bars.at(-1)?.close ?? null;
  return { market, symbol, proxy, bars: bars.length, asOf: provenance.sourceLastBarTimestamp ?? null, lastClose: last, return1d: returns(bars, 1), return5d: returns(bars, 5), sma20: average(closes.slice(-20)), sma50: average(closes.slice(-50)), volatility20: volatility20(bars), range20: bars.length ? ((Math.max(...bars.slice(-20).map(bar => bar.high)) - Math.min(...bars.slice(-20).map(bar => bar.low))) / (last || 1)) * 100 : null, warnings: [...warnings, ...(bars.length < 50 ? ["Fewer than 50 bars; long-horizon indicators are incomplete."] : [])], provenance };
}

export async function buildMarketContext(item: Pick<EarlyWarningItem, "markets">, options: { from?: string; to?: string; limit?: number } = {}): Promise<MarketContext[]> {
  const uniqueMarkets = Array.from(new Set(item.markets)).filter(market => PROXIES[market]).slice(0, 4);
  const to = options.to ?? new Date().toISOString().slice(0, 10);
  const from = options.from ?? new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  return Promise.all(uniqueMarkets.map(async market => {
    const proxy = PROXIES[market];
    try {
      const result = await fetchMassiveHistorical({ symbol: proxy.symbol, from, to, timespan: "day", adjusted: true, limit: options.limit ?? 120 });
      return summarizeMarketContext(market, proxy.symbol, proxy.label, result.bars, { provider: result.provider, endpoint: result.provenance.endpoint, retrievedAt: result.provenance.retrievedAt, sourceFirstBarTimestamp: result.provenance.sourceFirstBarTimestamp, sourceLastBarTimestamp: result.provenance.sourceLastBarTimestamp }, result.provenance.warnings);
    } catch (error) {
      return summarizeMarketContext(market, proxy.symbol, proxy.label, [], { provider: "Massive", retrievedAt: Date.now() }, [error instanceof Error ? error.message : "Market provider unavailable."]); 
    }
  }));
}
