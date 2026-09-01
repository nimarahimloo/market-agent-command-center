export type MacroEconomicObservation = { seriesId: string; label: string; date: string; value: number; source: "FRED"; url: string };
export type MacroRegime = { inflation: "rising" | "falling" | "stable" | "unknown"; growth: "expanding" | "contracting" | "stable" | "unknown"; asOf: string | null; evidence: string[] };

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
import { baselineKeyString, buildBaselineGroups, classifyEconomicRegime, selectContextualBaseline, type BaselineKey, type ContextualSurprise, type EconomicRegime, type HistoricalSurprise } from "../shared/historicalBaseline";

export type MacroCalendarEvent = MacroCalendarEventBase & { actual: number | null; forecast: number | null; previous: number | null; unit: string | null; country: string; regime: EconomicRegime; baselineKey: BaselineKey; surprise: SurpriseResult; standardizedSurprise: StandardizedSurprise; contextualSurprise: ContextualSurprise };
type MacroCalendarEventBase = { title: string; scheduledAt: string; source: "FRED Release Calendar" | "New York Fed Economic Indicators Calendar" | "TradingEconomics Calendar"; url: string; importance: "scheduled" };

export type MacroContext = {
  retrievedAt: number;
  calendar: MacroCalendarEvent[];
  rates: MacroRateObservation[];
  cpi: MacroEconomicObservation[];
  gdp: MacroEconomicObservation[];
  regime: MacroRegime;
  warnings: string[];
  provenance: string[];
};

const FRED_CALENDAR_URL = "https://fred.stlouisfed.org/releases/calendar";
const TRADING_ECONOMICS_CALENDAR_URL = "https://api.tradingeconomics.com/calendar/country/United%20States?c=guest:guest";
const NY_FED_CALENDAR_URL = "https://www.newyorkfed.org/research/calendars/nationalecon_cal";
const ECONOMIC_SERIES = [["CPIAUCSL", "Consumer Price Index"], ["GDP", "Gross Domestic Product"]] as const;
const SERIES = [
  ["DFF", "Federal Funds Effective Rate"],
  ["DFEDTARU", "Federal Funds Target Range Upper Limit"],
  ["DFEDTARL", "Federal Funds Target Range Lower Limit"],
] as const;

function csvRows(csv: string) {
  return csv.split(/\r?\n/).slice(1).map(line => line.split(",")).filter(row => row.length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(row[0]) && row[1] !== ".");
}

export function parseFredCsv(seriesId: string, label: string, csv: string, retrievedAt = Date.now(), maxRows = 365): MacroRateObservation[] {
  return csvRows(csv).slice(-maxRows).map(row => ({ seriesId, label, date: row[0], value: Number(row[1]), units: "percent" as const, source: "FRED" as const, url: `https://fred.stlouisfed.org/series/${seriesId}` })).filter(row => Number.isFinite(row.value));
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
    const country = source.includes("New York") ? "United States" : "United States";
    const baselineKey: BaselineKey = { indicator: title, country, regime: "unknown", unit: null };
    events.push({ title, scheduledAt: dateMatch ? dateMatch[0] : now.toISOString(), source, url: href, importance: "scheduled", actual: null, forecast: null, previous: null, unit: null, country, regime: "unknown", baselineKey, surprise: calculateSurprise({}), standardizedSurprise: calculateStandardizedSurprise(calculateSurprise({}), []), contextualSurprise: selectContextualBaseline(baselineKey, null, new Map()) });
    if (events.length >= 40) break;
  }
  return Array.from(new Map(events.map(event => [`${event.title}|${event.scheduledAt}`, event])).values());
}

type TradingEconomicsRecord = { Event?: string; Date?: string; Actual?: number | string | null; Forecast?: number | string | null; Previous?: number | string | null; Unit?: string | null; URL?: string | null; Country?: string | null };

function optionalNumber(value: unknown) { const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value.replace(/,/g, "")) : NaN; return Number.isFinite(number) ? number : null; }

export function parseTradingEconomicsCalendar(payload: unknown, retrievedAt = Date.now(), historical = new Map<string, Array<{ delta: number; date?: string }>>(), minSample = 8): MacroCalendarEvent[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap(record => {
    const row = record as TradingEconomicsRecord;
    if (!row.Event || !row.Date) return [];
    const actual = optionalNumber(row.Actual), forecast = optionalNumber(row.Forecast), previous = optionalNumber(row.Previous);
    const country = row.Country ?? "United States";
    const baselineKey: BaselineKey = { indicator: row.Event, country, regime: "unknown", unit: row.Unit ?? null };
    const surprise = calculateSurprise({ actual, forecast, previous, scale: "absolute" });
    return [{ title: row.Event, scheduledAt: row.Date, source: "TradingEconomics Calendar" as const, url: row.URL ?? "https://tradingeconomics.com/calendar", importance: "scheduled" as const, actual, forecast, previous, unit: row.Unit ?? null, country, regime: "unknown" as const, baselineKey, surprise, standardizedSurprise: calculateStandardizedSurprise(surprise, historical.get(row.Event) ?? [], minSample), contextualSurprise: selectContextualBaseline(baselineKey, surprise.delta, new Map()) }];
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
  const provenance: string[] = [FRED_CALENDAR_URL, NY_FED_CALENDAR_URL, TRADING_ECONOMICS_CALENDAR_URL, ...SERIES.map(([id]) => `https://fred.stlouisfed.org/series/${id}`)];
  const historyCalendarUrl = `https://api.tradingeconomics.com/calendar/country/United%20States?d1=${new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)}&d2=${new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)}&c=guest:guest`;
  const [fredCalendar, nyFedCalendar, tradingEconomicsCalendar, tradingEconomicsHistory, ...providerResults] = await Promise.all([
    fetchText(FRED_CALENDAR_URL).catch(error => { warnings.push(`FRED calendar unavailable: ${error instanceof Error ? error.message : "unknown error"}`); return ""; }),
    fetchText(NY_FED_CALENDAR_URL).catch(error => { warnings.push(`New York Fed calendar unavailable: ${error instanceof Error ? error.message : "unknown error"}`); return ""; }),
    fetchText("https://api.tradingeconomics.com/calendar/country/United%20States?c=guest:guest").catch(error => { warnings.push(`TradingEconomics calendar unavailable: ${error instanceof Error ? error.message : "unknown error"}`); return ""; }),
    fetchText(historyCalendarUrl).catch(error => { warnings.push(`TradingEconomics history unavailable: ${error instanceof Error ? error.message : "unknown error"}`); return ""; }),
    ...SERIES.map(([id, label]) => fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)}&coed=${new Date().toISOString().slice(0, 10)}`).then(csv => parseFredCsv(id, label, csv, retrievedAt)).catch(error => { warnings.push(`${id} unavailable: ${error instanceof Error ? error.message : "unknown error"}`); return []; })),
    ...ECONOMIC_SERIES.map(([id, label]) => fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${new Date(Date.now() - 5 * 365 * 86_400_000).toISOString().slice(0, 10)}&coed=${new Date().toISOString().slice(0, 10)}`).then(csv => parseFredCsv(id, label, csv, retrievedAt)).catch(error => { warnings.push(`${id} unavailable: ${error instanceof Error ? error.message : "unknown error"}`); return []; })),
  ]);
  const providerSeries = providerResults.flat();
  const rates = providerSeries.filter(row => SERIES.some(([id]) => id === row.seriesId));
  const cpi = providerSeries.filter(row => row.seriesId === "CPIAUCSL");
  const gdp = providerSeries.filter(row => row.seriesId === "GDP");
  const inflationValues = cpi.slice(-13);
  const latestCpi = inflationValues.at(-1)?.value ?? null;
  const priorYearCpi = inflationValues.length >= 13 ? inflationValues[0]?.value ?? null : null;
  const inflationChange = latestCpi !== null && priorYearCpi !== null ? latestCpi - priorYearCpi : null;
  const inflation = inflationChange === null ? "unknown" : inflationChange > 0.5 ? "rising" : inflationChange < -0.5 ? "falling" : "stable";
  const latestGdp = gdp.at(-1)?.value ?? null;
  const priorGdp = gdp.length >= 2 ? gdp.at(-2)?.value ?? null : null;
  const growthChange = latestGdp !== null && priorGdp !== null ? latestGdp - priorGdp : null;
  const growth = growthChange === null ? "unknown" : growthChange > 0 ? "expanding" : growthChange < 0 ? "contracting" : "stable";
  const regime: MacroRegime = { inflation, growth, asOf: cpi.at(-1)?.date ?? gdp.at(-1)?.date ?? null, evidence: [cpi.at(-1)?.date ? "FRED CPIAUCSL" : "", gdp.at(-1)?.date ? "FRED GDP" : ""].filter(Boolean) };
  const fedRates = rates.filter(rate => rate.seriesId === "DFF").sort((a, b) => a.date.localeCompare(b.date));
  const regimeAt = (date: string): EconomicRegime => { const observations = fedRates.filter(rate => rate.date <= date); const current = observations.at(-1)?.value ?? null; const prior = observations.length > 20 ? observations.at(-21)?.value ?? null : observations.at(0)?.value ?? null; return classifyEconomicRegime(current, prior); };
  let tradingEconomicsEvents: MacroCalendarEvent[] = [];
  let historicalByEvent = new Map<string, Array<{ delta: number; date?: string }>>();
  let historicalGroups = new Map<string, HistoricalSurprise[]>();
  if (tradingEconomicsHistory) { try { const historyRows = parseTradingEconomicsCalendar(JSON.parse(tradingEconomicsHistory), retrievedAt, new Map(), 0); for (const event of historyRows) { if (event.surprise.delta === null) continue; const regime = regimeAt(event.scheduledAt); const row: HistoricalSurprise = { delta: event.surprise.delta, date: event.scheduledAt, actual: event.actual, forecast: event.forecast, previous: event.previous, regime, indicator: event.title, country: event.country, unit: event.unit }; const existing = historicalByEvent.get(event.title) ?? []; existing.push({ delta: row.delta, date: row.date }); historicalByEvent.set(event.title, existing); historicalGroups = buildBaselineGroups([...Array.from(historicalGroups.values()).flat(), row]); } } catch { warnings.push("TradingEconomics historical calendar returned invalid JSON; standardized surprise is unavailable."); } }
  if (tradingEconomicsCalendar) { try { const parsed = parseTradingEconomicsCalendar(JSON.parse(tradingEconomicsCalendar), retrievedAt, historicalByEvent); tradingEconomicsEvents = parsed.map(event => { const regime = regimeAt(event.scheduledAt); const baselineKey: BaselineKey = { ...event.baselineKey, regime }; return { ...event, regime, baselineKey, contextualSurprise: selectContextualBaseline(baselineKey, event.surprise.delta, historicalGroups) }; }); } catch { warnings.push("TradingEconomics calendar returned invalid JSON; surprise fields are unavailable."); } }
  const fallbackCalendar = [
    ...parseCalendarHtml(fredCalendar, "FRED Release Calendar", FRED_CALENDAR_URL),
    ...parseCalendarHtml(nyFedCalendar, "New York Fed Economic Indicators Calendar", NY_FED_CALENDAR_URL),
  ];
  const calendar = [...tradingEconomicsEvents, ...(tradingEconomicsEvents.length ? [] : fallbackCalendar)].slice(0, 60);
  if (!calendar.length) warnings.push("No economic calendar events were returned; macro agent must not infer upcoming releases.");
  if (!rates.length) warnings.push("No FRED rate observations were returned; policy-rate conclusions are unavailable.");
  if (!cpi.length) warnings.push("No FRED CPI observations were returned; inflation regime is unknown.");
  if (!gdp.length) warnings.push("No FRED GDP observations were returned; growth regime is unknown.");
  return { retrievedAt, calendar, rates, cpi, gdp, regime, warnings, provenance };
}
