export type MacroCalendarEvent = {
  title: string;
  scheduledAt: string;
  source: "FRED Release Calendar" | "New York Fed Economic Indicators Calendar";
  url: string;
  importance: "scheduled";
};

export type MacroRateObservation = {
  seriesId: string;
  label: string;
  date: string;
  value: number;
  units: "percent";
  source: "FRED";
  url: string;
};

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
    events.push({ title, scheduledAt: dateMatch ? dateMatch[0] : now.toISOString(), source, url: href, importance: "scheduled" });
    if (events.length >= 40) break;
  }
  return Array.from(new Map(events.map(event => [`${event.title}|${event.scheduledAt}`, event])).values());
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
  const [fredCalendar, nyFedCalendar, ...rateResults] = await Promise.all([
    fetchText(FRED_CALENDAR_URL).catch(error => { warnings.push(`FRED calendar unavailable: ${error instanceof Error ? error.message : "unknown error"}`); return ""; }),
    fetchText(NY_FED_CALENDAR_URL).catch(error => { warnings.push(`New York Fed calendar unavailable: ${error instanceof Error ? error.message : "unknown error"}`); return ""; }),
    ...SERIES.map(([id, label]) => fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)}&coed=${new Date().toISOString().slice(0, 10)}`).then(csv => parseFredCsv(id, label, csv, retrievedAt)).catch(error => { warnings.push(`${id} unavailable: ${error instanceof Error ? error.message : "unknown error"}`); return []; })),
  ]);
  const calendar = [
    ...parseCalendarHtml(fredCalendar, "FRED Release Calendar", FRED_CALENDAR_URL),
    ...parseCalendarHtml(nyFedCalendar, "New York Fed Economic Indicators Calendar", NY_FED_CALENDAR_URL),
  ].slice(0, 60);
  const rates = rateResults.flat();
  if (!calendar.length) warnings.push("No economic calendar events were returned; macro agent must not infer upcoming releases.");
  if (!rates.length) warnings.push("No FRED rate observations were returned; policy-rate conclusions are unavailable.");
  return { retrievedAt, calendar, rates, warnings, provenance };
}
