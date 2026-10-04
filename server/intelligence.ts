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
const GOOGLE_NEWS_RSS_URL = "https://news.google.com/rss/search";
const PROVIDER_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 60_000;
const STALE_CACHE_MAX_MS = 15 * 60_000;
const cache = new Map<
  string,
  { expiresAt: number; cachedAt: number; items: EarlyWarningItem[] }
>();

async function fetchWithRetry(url: URL, accept: string, label: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { accept },
        signal: controller.signal,
      });
      if (response.ok) return response;
      if (response.status < 500 && response.status !== 429)
        throw new Error(`${label} unavailable (${response.status})`);
      lastError = new Error(`${label} unavailable (${response.status})`);
    } catch (error) {
      lastError =
        error instanceof Error && error.name === "AbortError"
          ? new Error(`${label} request timed out`)
          : error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`${label} unavailable`);
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}
function xmlField(block: string, tag: string) {
  const match = block.match(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i")
  );
  return match
    ? decodeXml(match[1])
        .replace(/<[^>]+>/g, " ")
        .trim()
    : "";
}
function parseGoogleNewsRss(xml: string, retrievedAt: string) {
  return Array.from(
    xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)
  ).flatMap((match, index) => {
    const block = match[1];
    const title = xmlField(block, "title");
    const url = xmlField(block, "link");
    const publishedAt = xmlField(block, "pubDate") || retrievedAt;
    const source = xmlField(block, "source") || "Google News RSS";
    if (!title || !url) return [];
    return [{ title, url, publishedAt, source, index }];
  });
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
function normalizeGdelt(
  body: {
    articles?: Array<{
      url?: string;
      title?: string;
      seendate?: string;
      domain?: string;
      tone?: number;
    }>;
  },
  retrievedAt: string
) {
  return (body.articles ?? [])
    .filter(item => item.url && item.title)
    .map((item, index) => ({
      title: item.title!,
      url: item.url!,
      publishedAt: item.seendate ?? retrievedAt,
      source: item.domain ?? "GDELT discovery",
      tone: Number(item.tone ?? 0),
      index,
    }));
}
function normalizeItems(
  raw: Array<{
    title: string;
    url: string;
    publishedAt: string;
    source: string;
    tone: number;
    index: number;
  }>,
  provider: "gdelt" | "google-news",
  retrievedAt: string
) {
  const seenUrls = new Set<string>();
  return raw
    .filter(item => {
      if (seenUrls.has(item.url)) return false;
      seenUrls.add(item.url);
      return true;
    })
    .map(item => {
      const markets = classifyMarkets(item.title);
      const confidenceBase = provider === "gdelt" ? 48 : 36;
      const confidence = Math.min(
        92,
        Math.max(
          25,
          Math.round(
            confidenceBase +
              Math.abs(item.tone) * 3 +
              Math.max(0, markets.length - 1) * 5
          )
        )
      );
      return {
        id: `${provider}-${item.index}-${Buffer.from(item.url).toString("base64url").slice(0, 10)}`,
        title: item.title,
        url: item.url,
        publishedAt: item.publishedAt,
        retrievedAt,
        source: item.source,
        sourceTier: sourceTierFor(item.source),
        severity: severityFor(item.tone, markets),
        markets,
        entities: markets,
        tone: item.tone,
        corroboration: "single-source" as const,
        confidence,
        leadTimeEstimateMinutes: Math.max(
          5,
          Math.round(30 - Math.abs(item.tone) * 1.5)
        ),
        freshness: classifyFreshness(item.publishedAt, retrievedAt),
      };
    });
}

export async function fetchEarlyWarnings(
  query = "(oil OR gold OR stocks OR forex OR crypto OR central bank)"
) {
  const key = query.trim();
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.items;
  const retrievedAt = new Date().toISOString();
  const gdeltUrl = new URL(GDELT_URL);
  gdeltUrl.searchParams.set("query", key);
  gdeltUrl.searchParams.set("mode", "artlist");
  gdeltUrl.searchParams.set("format", "json");
  gdeltUrl.searchParams.set("maxrecords", "30");
  gdeltUrl.searchParams.set("sort", "datedesc");
  try {
    const response = await fetchWithRetry(
      gdeltUrl,
      "application/json",
      "GDELT news discovery"
    );
    const items = normalizeItems(
      normalizeGdelt(
        (await response.json()) as {
          articles?: Array<{
            url?: string;
            title?: string;
            seendate?: string;
            domain?: string;
            tone?: number;
          }>;
        },
        retrievedAt
      ),
      "gdelt",
      retrievedAt
    );
    if (items.length) {
      const corroborated = applyCorroboration(items);
      cache.set(key, {
        expiresAt: now + CACHE_TTL_MS,
        cachedAt: now,
        items: corroborated,
      });
      return corroborated;
    }
    throw new Error("GDELT returned no articles");
  } catch (gdeltError) {
    const rssUrl = new URL(GOOGLE_NEWS_RSS_URL);
    rssUrl.searchParams.set("q", key);
    rssUrl.searchParams.set("hl", "en-US");
    rssUrl.searchParams.set("gl", "US");
    rssUrl.searchParams.set("ceid", "US:en");
    try {
      const response = await fetchWithRetry(
        rssUrl,
        "application/rss+xml, application/xml, text/xml",
        "Google News RSS fallback"
      );
      const items = normalizeItems(
        parseGoogleNewsRss(await response.text(), retrievedAt).map(item => ({
          ...item,
          tone: 0,
        })),
        "google-news",
        retrievedAt
      );
      if (!items.length)
        throw new Error("Google News RSS returned no articles");
      const corroborated = applyCorroboration(items);
      cache.set(key, {
        expiresAt: now + CACHE_TTL_MS,
        cachedAt: now,
        items: corroborated,
      });
      return corroborated;
    } catch (secondaryError) {
      if (cached && now - cached.cachedAt <= STALE_CACHE_MAX_MS)
        return cached.items.map(item => ({
          ...item,
          freshness: "stale" as const,
        }));
      throw new Error(
        `News discovery unavailable: GDELT failed (${gdeltError instanceof Error ? gdeltError.message : "unknown error"}); secondary RSS failed (${secondaryError instanceof Error ? secondaryError.message : "unknown error"})`
      );
    }
  }
}
