export type HistoricalBar = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type BacktestConfig = {
  initialCash: number;
  universe?: string;
  commissionBps: number;
  slippageBps: number;
  positionFraction: number;
  allowShort: boolean;
  dataProvenance?: { source: string; datasetName?: string; sha256?: string; firstTimestamp?: number; lastTimestamp?: number; warnings?: string[] };
};

export type BacktestTrade = {
  entryTime: number;
  exitTime: number;
  side: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  grossPnl: number;
  commission: number;
  slippageCost: number;
  netPnl: number;
  returnPct: number;
};

export type BacktestResult = {
  assumptions: {
    universe: string;
    commissionBps: number;
    slippageBps: number;
    positionFraction: number;
    allowShort: boolean;
    startTime: number;
    endTime: number;
    barCount: number;
    dataProvenance?: BacktestConfig["dataProvenance"];
  };
  equityCurve: Array<{ timestamp: number; equity: number }>;
  trades: BacktestTrade[];
  metrics: {
    initialCash: number;
    finalEquity: number;
    grossReturnPct: number;
    netReturnPct: number;
    totalCommission: number;
    totalSlippageCost: number;
    maxDrawdownPct: number;
    winRatePct: number;
    profitFactor: number;
    sharpeLike: number;
    tradeCount: number;
  };
  warnings: string[];
};

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function std(values: number[]) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map(value => (value - average) ** 2)));
}

export type ChunkedBacktestOptions = { signal?: AbortSignal; onProgress?: (processedBars: number) => void };

export async function runBacktestChunked(chunks: AsyncIterable<{ bars: readonly HistoricalBar[]; signals: readonly number[] }>, config: BacktestConfig, options: ChunkedBacktestOptions = {}): Promise<BacktestResult> {
  const bars: HistoricalBar[] = []; const signals: number[] = [];
  for await (const chunk of chunks) {
    if (options.signal?.aborted) throw new Error("Backtest cancelled");
    if (chunk.bars.length !== chunk.signals.length) throw new Error("Chunk bars and signals must have the same length");
    bars.push(...chunk.bars); signals.push(...chunk.signals); options.onProgress?.(bars.length);
    await Promise.resolve();
  }
  if (options.signal?.aborted) throw new Error("Backtest cancelled");
  return runBacktest(bars, signals, config);
}

export function runBacktest(bars: readonly HistoricalBar[], signals: readonly number[], config: BacktestConfig): BacktestResult {
  if (bars.length < 2) throw new Error("At least two historical bars are required");
  if (bars.length !== signals.length) throw new Error("Bars and signals must have the same length");
  if (config.initialCash <= 0) throw new Error("Initial cash must be positive");
  if (config.commissionBps < 0 || config.slippageBps < 0) throw new Error("Costs cannot be negative");
  if (config.positionFraction <= 0 || config.positionFraction > 1) throw new Error("Position fraction must be between 0 and 1");

  const commissionRate = config.commissionBps / 10_000;
  const slippageRate = config.slippageBps / 10_000;
  let cash = config.initialCash;
  let position = 0;
  let entryPrice = 0;
  let entryTime = 0;
  let entryQuantity = 0;
  let entryCommission = 0;
  let entrySlippage = 0;
  const trades: BacktestTrade[] = [];
  const equityCurve: Array<{ timestamp: number; equity: number }> = [];
  let peak = config.initialCash;
  let maxDrawdown = 0;
  let grossPnl = 0;
  let totalCommission = 0;
  let totalSlippageCost = 0;
  const dailyReturns: number[] = [];
  let previousEquity = config.initialCash;

  const closePosition = (bar: HistoricalBar) => {
    if (!position) return;
    const side = position > 0 ? "long" : "short";
    const exitPrice = position > 0 ? bar.close * (1 - slippageRate) : bar.close * (1 + slippageRate);
    const quantity = Math.abs(position);
    const notional = exitPrice * quantity;
    const exitCommission = notional * commissionRate;
    const exitSlippage = Math.abs(bar.close - exitPrice) * quantity;
    const pnl = side === "long" ? (exitPrice - entryPrice) * quantity : (entryPrice - exitPrice) * quantity;
    const commission = entryCommission + exitCommission;
    const slippageCost = entrySlippage + exitSlippage;
    const netPnl = pnl - commission;
    trades.push({ entryTime, exitTime: bar.timestamp, side, entryPrice, exitPrice, quantity, grossPnl: pnl, commission, slippageCost, netPnl, returnPct: entryPrice > 0 ? (netPnl / (entryPrice * quantity)) * 100 : 0 });
    grossPnl += pnl;
    totalCommission += commission;
    totalSlippageCost += slippageCost;
    cash += side === "long" ? exitPrice * quantity - exitCommission : (entryPrice - exitPrice) * quantity - exitCommission;
    position = 0;
    entryPrice = 0;
    entryQuantity = 0;
    entryCommission = 0;
    entrySlippage = 0;
  };

  const openPosition = (bar: HistoricalBar, desired: number) => {
    if (!desired) return;
    const side = desired > 0 ? "long" : "short";
    const notional = Math.max(0, cash) * config.positionFraction;
    const price = side === "long" ? bar.close * (1 + slippageRate) : bar.close * (1 - slippageRate);
    const quantity = notional / price;
    const commission = price * quantity * commissionRate;
    const slippageCost = Math.abs(price - bar.close) * quantity;
    if (side === "long") cash -= price * quantity + commission;
    else cash -= commission;
    position = side === "long" ? quantity : -quantity;
    entryPrice = price;
    entryTime = bar.timestamp;
    entryQuantity = quantity;
    entryCommission = commission;
    entrySlippage = slippageCost;
  };

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    const rawSignal = signals[index] ?? 0;
    const desired = config.allowShort ? Math.max(-1, Math.min(1, rawSignal)) : Math.max(0, Math.min(1, rawSignal));
    const currentDirection = position === 0 ? 0 : position > 0 ? 1 : -1;
    if (desired !== currentDirection) {
      closePosition(bar);
      openPosition(bar, desired);
    }
    const markedPositionValue = position > 0 ? position * bar.close : position < 0 ? (entryPrice - bar.close) * Math.abs(position) : 0;
    const equity = cash + markedPositionValue;
    equityCurve.push({ timestamp: bar.timestamp, equity });
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
    if (previousEquity > 0) dailyReturns.push((equity - previousEquity) / previousEquity);
    previousEquity = equity;
  }
  closePosition(bars[bars.length - 1]);
  const finalEquity = cash;
  const wins = trades.filter(trade => trade.netPnl > 0).length;
  const grossWins = trades.filter(trade => trade.netPnl > 0).reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLosses = Math.abs(trades.filter(trade => trade.netPnl < 0).reduce((sum, trade) => sum + trade.netPnl, 0));
  const volatility = std(dailyReturns);
  const warnings: string[] = ["Results are only as reliable as the historical data, timestamp alignment, fees, and slippage assumptions."];
  if (bars.length < 30) warnings.push("Short sample: fewer than 30 bars can make performance statistics unstable.");
  if (trades.length === 0) warnings.push("No completed trades were generated by the supplied signals.");

  return {
    assumptions: {
      universe: config.universe ?? "unspecified",
      commissionBps: config.commissionBps,
      slippageBps: config.slippageBps,
      positionFraction: config.positionFraction,
      allowShort: config.allowShort,
      startTime: bars[0].timestamp,
      endTime: bars[bars.length - 1].timestamp,
      barCount: bars.length,
      dataProvenance: config.dataProvenance,
    },
    equityCurve,
    trades,
    metrics: {
      initialCash: config.initialCash,
      finalEquity,
      grossReturnPct: (grossPnl / config.initialCash) * 100,
      netReturnPct: ((finalEquity - config.initialCash) / config.initialCash) * 100,
      totalCommission,
      totalSlippageCost,
      maxDrawdownPct: maxDrawdown,
      winRatePct: trades.length ? (wins / trades.length) * 100 : 0,
      profitFactor: grossLosses ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0,
      sharpeLike: volatility ? (mean(dailyReturns) / volatility) * Math.sqrt(dailyReturns.length) : 0,
      tradeCount: trades.length,
    },
    warnings,
  };
}
