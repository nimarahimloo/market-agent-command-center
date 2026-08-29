import type { HistoricalBar } from "./backtest";

export type FlatFileFormat = "csv" | "ndjson";
export type FlatFileMapping = {
  timestamp: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
};
export type FlatFileInterval = "minute" | "hour" | "day" | "week" | "month";

export type FlatFileParseResult = {
  bars: HistoricalBar[];
  rowCount: number;
  firstTimestamp?: number;
  lastTimestamp?: number;
  warnings: string[];
  errors: string[];
};

const defaultMapping: FlatFileMapping = { timestamp: "timestamp", open: "open", high: "high", low: "low", close: "close", volume: "volume" };

function toTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const numeric = Number(text);
  if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function toNumber(value: unknown): number | undefined {
  const number = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(number) ? number : undefined;
}

function splitCsv(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') { field += '"'; i += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === "," && !quoted) { fields.push(field.trim()); field = ""; continue; }
    field += char;
  }
  fields.push(field.trim());
  return fields;
}

async function* readableChunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try { while (true) { const next = await reader.read(); if (next.done) break; if (next.value) yield next.value; } }
  finally { reader.releaseLock(); }
}

export async function parseFlatFileChunks(chunks: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>, format: FlatFileFormat, mapping: Partial<FlatFileMapping> = {}, expectedInterval: FlatFileInterval = "day"): Promise<FlatFileParseResult> {
  const selected = { ...defaultMapping, ...mapping };
  const iterable: AsyncIterable<Uint8Array> = typeof (streamOrIterable(chunks) as { getReader?: unknown }).getReader === "function" ? readableChunks(chunks as ReadableStream<Uint8Array>) : chunks as AsyncIterable<Uint8Array>;
  const decoder = new TextDecoder();
  let carry = "";
  let headers: string[] | undefined;
  const bars: HistoricalBar[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const seen = new Set<number>();
  let rowNumber = 0;

  const parseRecord = (record: Record<string, unknown>, line: number) => {
    const timestamp = toTimestamp(record[selected.timestamp]);
    const open = toNumber(record[selected.open]); const high = toNumber(record[selected.high]); const low = toNumber(record[selected.low]); const close = toNumber(record[selected.close]);
    const volume = selected.volume ? toNumber(record[selected.volume]) : undefined;
    if (timestamp === undefined || open === undefined || high === undefined || low === undefined || close === undefined) { errors.push(`Row ${line} is missing a valid timestamp or OHLC value.`); return; }
    if (seen.has(timestamp)) warnings.push(`Duplicate timestamp at row ${line}.`);
    seen.add(timestamp);
    if (bars.length && timestamp < bars[bars.length - 1].timestamp) warnings.push(`Out-of-order timestamp at row ${line}.`);
    if (high < Math.max(open, close) || low > Math.min(open, close) || low > high) warnings.push(`Invalid OHLC geometry at row ${line}.`);
    bars.push({ timestamp, open, high, low, close });
  };

  const processLine = (raw: string) => {
    const line = raw.replace(/\r$/, "").trim(); if (!line) return;
    rowNumber += 1;
    if (format === "ndjson") { try { const record = JSON.parse(line) as Record<string, unknown>; parseRecord(record, rowNumber); } catch { errors.push(`Row ${rowNumber} is not valid NDJSON.`); } return; }
    const values = splitCsv(line);
    if (!headers) { headers = values; return; }
    const record = Object.fromEntries(headers.map((header, index) => [header.trim(), values[index] ?? ""]));
    parseRecord(record, rowNumber);
  };

  for await (const chunk of iterable) { carry += decoder.decode(chunk, { stream: true }); const lines = carry.split("\n"); carry = lines.pop() ?? ""; lines.forEach(processLine); }
  carry += decoder.decode(); if (carry.trim()) processLine(carry);
  if (!bars.length) warnings.push("No complete OHLC bars were found in the Flat File.");
  if (bars.length > 1) {
    const intervalMs = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000 }[expectedInterval];
    for (let i = 1; i < bars.length; i += 1) {
      const delta = bars[i].timestamp - bars[i - 1].timestamp;
      if ((expectedInterval === "day" && delta > 4 * intervalMs) || (expectedInterval !== "day" && Math.abs(delta - intervalMs) > intervalMs * 0.25)) warnings.push(`Flat File interval mismatch or gap near row ${i + 2}; expected ${expectedInterval}.`);
      if (warnings.some(warning => warning.startsWith("Flat File interval mismatch"))) break;
    }
  }
  return { bars, rowCount: rowNumber, firstTimestamp: bars[0]?.timestamp, lastTimestamp: bars[bars.length - 1]?.timestamp, warnings: Array.from(new Set(warnings)), errors, };
}

function streamOrIterable(value: unknown): unknown { return value; }
