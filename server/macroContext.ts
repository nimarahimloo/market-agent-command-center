export type MacroRateObservation = {
  seriesId: string;
  label: string;
  date: string;
  value: number;
  units: "percent";
  source: "FRED";
  url: string;
};

import { calculateSurprise, type SurpriseResult } from "../shared/surprise";
import { calculateStandardizedSurprise, type StandardizedSurprise } from "../shared/standardizedSurprise";

export type MacroCalendarEvent = MacroCalendarEventBase & { actual: number | null; forecast: number | null; previous: number | null; unit: string | null; surprise: SurpriseResult; standardizedSurprise: StandardizedSurprise };
type MacroCalendarEventBase = { title: string; scheduledAt: string; source: "FRED Release Calendar" | "New York Fed Economic Indicators Calendar" | "TradingEconomics Calendar"; url: string; importance: "scheduled" };

export type MacroContext = {
  retrievedAt: number;
  calendar: MacroCalendarEvent[];
  rates: MacroRateObservation[];
  warnings: string[];
  provenance: string[];
};

const FRED_CALENDAR_URL = "https://fred.stlouisfed.org/releases/calendar";
const NY_FED_CALENDAR_URL = "https://www.newyorkfed.org/research/calendars/nationalecon_cal";
const SERIES = [
  ["DFF", "Federal Funds Effective Rate"],
  ["DFEDTARU", "Federal Funds Target Range Upper Limit"],
  ["DFEDTARL", "Federal Funds Target Range Lower Limit"],
] as const;

function csvRows(csv: string) {
  return csv.split(/\r?\n/).slice(1).map(line => line.split(",")).filter(row => row.length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(row[0]) && row[1] !== ".");
}

export function parseFredCsv(seriesId: string, label: string, csv: string, retrievedAt = Date.now()): MacroRateObservation[] {
  return csvRows(csv).slice(-90).map(row => ({ seriesId, label, date: row[0], value: Number(row[1]), units: "percent" as const, source: "FRED" as const, url: `https://fred.stlouisfed.org/series/${seriesId}` })).filter(row => Number.isFinite(row.value));
}

export function parseCalendarHtml(html: string, source: MacroCalendarEvent["source"], sourceUrl: string, now = new Date()): MacroCalendarEvent[] {
  const events: MacroCalendarEvent[] = [];
  const linkPattern = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]{3,160})<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(html))) {
    const title = match[2].replace(/\s+/g, " ").trim();
    if (!/(rate|FOMC|CPI|PPI|GDP|employment|claims|sales|income|inflation|trade|manufacturing|consumer|retail|jobs|payroll|ECB|SOFR|funds)/i.test(title)) continue;
    const href = match[1].startsWith("http") ? match[1] : new URL(match[1], sourceUrl).toString();
    const nearby = html.slice(Math.max(0, match.index - 220), Math.min(html.length, match.index + 220)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const dateMatch = nearby.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}|\d{1,2}\/\d{1,2}/i);
    events.push({ title, scheduledAt: dateMatch ? dateMatch[0] : now.toISOString(), source, url: href, importance: "scheduled", actual: null, forecast: null, previous: null, unit: null, surprise: calculateSurprise({}), standardizedSurprise: calculateStandardizedSurprise(calculateSurprise({}), []) });
    if (events.length >= 40) break;
  }
  return Array.from(new Map(events.map(event => [`${event.title}|${event.scheduledAt}`, event])).values());
}

type TradingEconomicsRecord = { Event?: string; Date?: string; Actual?: number | string | null; Forecast?: number | string | null; Previous?: number | string | null; Unit?: string | null; URL?: string | null };

function optionalNumber(value: unknown) { const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value.replace(/,/g, "")) : NaN; return Number.isFinite(number) ? number : null; }

export function parseTradingEconomicsCalendar(payload: unknown, retrievedAt = Date.now(), historical = new Map<string, Array<{ delta: number; date?: string }>>(), minSample = 8): MacroCalendarEvent[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap(record => {
    const row = record as TradingEconomicsRecord;
    if (!row.Event || !row.Date) return [];
    const actual = optionalNumber(row.Actual), forecast = optionalNumber(row.Forecast), previous = optionalNumber(row.Previous);
    return [{ title: row.Event, scheduledAt: row.Date, source: "TradingEconomics Calendar" as const, url: row.URL ?? "https://tradingeconomics.com/calendar", importance: "scheduled" as const, actual, forecast, previous, unit: row.Unit ?? null, surprise: calculateSurprise({ actual, forecast, previous, scale: "absolute" }), standardizedSurprise: calculateStandardizedSurprise(calculateSurprise({ actual, forecast, previous, scale: "absolute" }), historical.get(row.Event) ?? [], minSample) }];
  });
}

async function fetchText(url: string) {
  const response = await fetch(url, { headers: { Accept: "text/csv,text/html" } });
  if (!response.ok) throw new Error(`Macro provider returned HTTP ${response.status}`);
  return response.text();
}

export async function buildMacroContext(): Promise<MacroContext> {
  const retrievedAt = Date.now();
  const warnings: string[] = [];
  const provenance: string[] = [FRED_CALENDAR_URL, NY_FED_CALENDAR_URL, ...SERIES.map(([id]) => `https://fred.stlouisfed.org/series/${id}`)];
  const historyCalendarUrl = `https://api.tradingeconomics.com/calendar/country/United%20States?d1=${new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)}&d2=${new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)}&c=guest:guest`;
  const [fredCalendar, nyFedCalendar, tradingEconomicsCalendar, tradingEconomicsHistory, ...rateResults] = await Promise.all([
    fetchText(FRED_CALENDAR_URL).catch(error => { warnings.push(`FRED calendar unavailable: ${error instanceof Error ? error.message : "unknown error"}`); return ""; }),
    fetchText(NY_FED_CALENDAR_URL).catch(error => { warnings.push(`New York Fed calendar unavailable: ${error instanceof Error ? error.message : "unknown error"}`); return ""; }),
    fetchText("https://api.tradingeconomics.com/calendar/country/United%20States?c=guest:guest").catch(error => { warnings.push(`TradingEconomics calendar unavailable: ${error instanceof Error ? error.message : "unknown error"}`); return ""; }),
    fetchText(historyCalendarUrl).catch(error => { warnings.push(`TradingEconomics history unavailable: ${error instanceof Error ? error.message : "unknown error"}`); return ""; }),
    ...SERIES.map(([id, label]) => fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)}&coed=${new Date().toISOString().slice(0, 10)}`).then(csv => parseFredCsv(id, label, csv, retrievedAt)).catch(error => { warnings.push(`${id} unavailable: ${error instanceof Error ? error.message : "unknown error"}`); return []; })),
  ]);
  let tradingEconomicsEvents: MacroCalendarEvent[] = [];
  let historicalByEvent = new Map<string, Array<{ delta: number; date?: string }>>();
  if (tradingEconomicsHistory) { try { const historyRows = parseTradingEconomicsCalendar(JSON.parse(tradingEconomicsHistory), retrievedAt, new Map(), 0); for (const event of historyRows) { if (event.surprise.delta === null) continue; const existing = historicalByEvent.get(event.title) ?? []; existing.push({ delta: event.surprise.delta, date: event.scheduledAt }); historicalByEvent.set(event.title, existing); } } catch { warnings.push("TradingEconomics historical calendar returned invalid JSON; standardized surprise is unavailable."); } }
  if (tradingEconomicsCalendar) { try { tradingEconomicsEvents = parseTradingEconomicsCalendar(JSON.parse(tradingEconomicsCalendar), retrievedAt, historicalByEvent); } catch { warnings.push("TradingEconomics calendar returned invalid JSON; surprise fields are unavailable."); } }
  const fallbackCalendar = [
    ...parseCalendarHtml(fredCalendar, "FRED Release Calendar", FRED_CALENDAR_URL),
    ...parseCalendarHtml(nyFedCalendar, "New York Fed Economic Indicators Calendar", NY_FED_CALENDAR_URL),
  ];
  const calendar = [...tradingEconomicsEvents, ...(tradingEconomicsEvents.length ? [] : fallbackCalendar)].slice(0, 60);
  const rates = rateResults.flat();
  if (!calendar.length) warnings.push("No economic calendar events were returned; macro agent must not infer upcoming releases.");
  if (!rates.length) warnings.push("No FRED rate observations were returned; policy-rate conclusions are unavailable.");
  return { retrievedAt, calendar, rates, warnings, provenance };
}
