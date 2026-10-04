import { applyCorroboration } from "../shared/radarTools";

export type EarlyWarningItem = {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  retrievedAt: string;
  source: string;
  sourceTier: "discovery" | "financial-media" | "official";
  severity: "low" | "medium" | "high";
  markets: string[];
  entities: string[];
  tone: number;
  corroboration: "single-source" | "cross-source";
  confidence: number;
  leadTimeEstimateMinutes: number;
  freshness: "fresh" | "aging" | "stale";
};
function parseSourceDate(value: string) {
  if (/^\d{14}$/.test(value)) {
    const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}Z`;
    return Date.parse(iso);
  }
  return Date.parse(value);
}
export function classifyFreshness(publishedAt: string, retrievedAt: string) {
  const ageMinutes = Math.max(
    0,
    (Date.parse(retrievedAt) - parseSourceDate(publishedAt)) / 60_000
  );
  return ageMinutes <= 15
    ? ("fresh" as const)
    : ageMinutes <= 60
      ? ("aging" as const)
      : ("stale" as const);
}
export function shouldAlert(
  item: Pick<EarlyWarningItem, "severity" | "confidence" | "freshness">,
  threshold: {
    minConfidence: number;
    severities: Array<EarlyWarningItem["severity"]>;
  }
) {
  return (
    item.freshness !== "stale" &&
    item.confidence >= threshold.minConfidence &&
    threshold.severities.includes(item.severity)
  );
}
const GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const GDELT_TIMEOUT_MS = 8_000;
const GDELT_CACHE_TTL_MS = 60_000;
const GDELT_STALE_CACHE_MAX_MS = 15 * 60_000;
const cache = new Map<
  string,
  { expiresAt: number; cachedAt: number; items: EarlyWarningItem[] }
>();
async function fetchGdelt(url: URL) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GDELT_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (response.ok) return response;
      if (response.status < 500)
        throw new Error(
          `Global news discovery unavailable (${response.status})`
        );
      lastError = new Error(
        `Global news discovery unavailable (${response.status})`
      );
    } catch (error) {
      lastError =
        error instanceof Error && error.name === "AbortError"
          ? new Error("GDELT request timed out")
          : error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Global news discovery unavailable");
}
export function clearEarlyWarningCacheForTests() {
  cache.clear();
}
function classifyMarkets(text: string) {
  const value = text.toLowerCase();
  const markets: string[] = [];
  if (/bitcoin|crypto|ethereum|digital asset/.test(value))
    markets.push("Crypto");
  if (/oil|crude|opec|energy/.test(value)) markets.push("Oil");
  if (/gold/.test(value)) markets.push("Gold");
  if (/silver/.test(value)) markets.push("Silver");
  if (
    /precious metal/.test(value) &&
    !markets.includes("Gold") &&
    !markets.includes("Silver")
  )
    markets.push("Metals");
  if (/forex|currency|dollar|yen|euro|fx/.test(value)) markets.push("FX");
  if (/nasdaq|s&p|dow|index|indices/.test(value)) markets.push("Indices");
  if (/stock|equity|shares/.test(value)) markets.push("Equities");
  if (/rate|central bank|inflation|treasury|bond/.test(value))
    markets.push("Rates");
  return markets.length ? markets : ["Cross-market"];
}
function sourceTierFor(domain: string): EarlyWarningItem["sourceTier"] {
  if (
    /gov|centralbank|federalreserve|sec\.gov|ecb\.europa/.test(
      domain.toLowerCase()
    )
  )
    return "official";
  if (/cnbc|reuters|bloomberg|ft\.com|wsj\.com/.test(domain.toLowerCase()))
    return "financial-media";
  return "discovery";
}
function severityFor(tone: number, markets: string[]) {
  if (Math.abs(tone) >= 7 || markets.length >= 3) return "high" as const;
  if (Math.abs(tone) >= 3 || markets.length === 2) return "medium" as const;
  return "low" as const;
}
export async function fetchEarlyWarnings(
  query = "(oil OR gold OR stocks OR forex OR crypto OR central bank)"
) {
  const key = query.trim();
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.items;
  const url = new URL(GDELT_URL);
  url.searchParams.set("query", key);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", "30");
  url.searchParams.set("sort", "datedesc");
  let response: Response;
  try {
    response = await fetchGdelt(url);
  } catch (error) {
    if (cached && now - cached.cachedAt <= GDELT_STALE_CACHE_MAX_MS)
      return cached.items.map(item => ({
        ...item,
        freshness: "stale" as const,
      }));
    throw new Error(
      `Global news discovery unavailable: ${error instanceof Error ? error.message : "unknown provider error"}`
    );
  }
  const body = (await response.json()) as {
    articles?: Array<{
      url?: string;
      title?: string;
      seendate?: string;
      domain?: string;
      tone?: number;
    }>;
  };
  const retrievedAt = new Date().toISOString();
  const seenUrls = new Set<string>();
  const items = (body.articles ?? [])
    .filter(item => item.url && item.title)
    .filter(item => {
      if (seenUrls.has(item.url!)) return false;
      seenUrls.add(item.url!);
      return true;
    })
    .map((item, index) => {
      const title = item.title ?? "";
      const markets = classifyMarkets(title);
      const tone = Number(item.tone ?? 0);
      const confidence = Math.min(
        92,
        Math.max(
          25,
          Math.round(
            48 + Math.abs(tone) * 3 + Math.max(0, markets.length - 1) * 5
          )
        )
      );
      const leadTimeEstimateMinutes = Math.max(
        5,
        Math.round(30 - Math.abs(tone) * 1.5)
      );
      const publishedAt = item.seendate ?? retrievedAt;
      const freshness = classifyFreshness(publishedAt, retrievedAt);
      return {
        id: `gdelt-${index}-${Buffer.from(item.url!).toString("base64url").slice(0, 10)}`,
        title,
        url: item.url!,
        publishedAt,
        retrievedAt,
        source: item.domain ?? "GDELT discovery",
        sourceTier: sourceTierFor(item.domain ?? ""),
        severity: severityFor(tone, markets),
        markets,
        entities: markets,
        tone,
        corroboration: "single-source" as const,
        confidence,
        leadTimeEstimateMinutes,
        freshness,
      };
    });
  const corroboratedItems = applyCorroboration(items);
  cache.set(key, {
    expiresAt: now + GDELT_CACHE_TTL_MS,
    cachedAt: now,
    items: corroboratedItems,
  });
  return corroboratedItems;
}
