import { invokeLLM, listLLMModels } from "./_core/llm";
import type { EarlyWarningItem } from "./intelligence";
import { buildMarketContext, type MarketContext } from "./marketContext";
import { buildMacroContext, type MacroContext } from "./macroContext";

export const AGENT_ROLES = [
  { id: "technical", label: "Technical analyst", mandate: "Assess price/market-structure implications and state what market data is missing." },
  { id: "macro", label: "Macro and news analyst", mandate: "Assess policy, rates, inflation, geopolitics, and source credibility implications." },
  { id: "event", label: "Event-impact analyst", mandate: "Estimate immediate event impact, affected markets, transmission path, and time horizon." },
  { id: "cross-market", label: "Cross-market analyst", mandate: "Map spillovers across crypto, commodities, equities, FX, indices, and rates." },
  { id: "risk", label: "Risk officer", mandate: "Identify invalidation conditions, tail risks, data gaps, and whether paper testing should be blocked." },
  { id: "skeptic", label: "Skeptic and dissent reviewer", mandate: "Actively challenge the strongest interpretation, search for alternative explanations, and assign no-signal when evidence is insufficient." },
] as const;

type AgentRole = typeof AGENT_ROLES[number]["id"];

export type AgentAnalysis = {
  role: AgentRole;
  stance: "bullish" | "bearish" | "mixed" | "neutral" | "no-signal";
  confidence: number;
  impactScore: number;
  horizonMinutes: number;
  rationale: string;
  risks: string[];
  evidenceRefs: string[];
  missingData: string[];
  dataRefs: string[];
  status: "completed" | "failed";
  error?: string;
  model: string;
};

export type AgentArmyResult = {
  eventId: string;
  runId: string;
  model: string;
  analyses: AgentAnalysis[];
  consensus: {
    stance: AgentAnalysis["stance"];
    confidence: number;
    impactScore: number;
    disagreement: number;
    uncertainty: number;
    canPaperTest: boolean;
    reasons: string[];
    dissent: string[];
    evidenceRefs: string[];
  };
  createdAt: string;
};

const MAX_BATCH_EVENTS = 5;
export const AGENT_TIMEOUT_MS = 45_000;
export const MAX_AGENT_RETRIES = 2;
export const MAX_AGENT_BUDGET = 6;
export type AgentRunOptions = { modelId?: string; agentBudget?: number; retryCount?: number; timeoutMs?: number };

const outputSchema = {
  name: "market_agent_analysis",
  strict: true,
  schema: {
    type: "object",
    properties: {
      stance: { type: "string", enum: ["bullish", "bearish", "mixed", "neutral", "no-signal"] },
      confidence: { type: "integer", minimum: 0, maximum: 100 },
      impactScore: { type: "integer", minimum: 0, maximum: 100 },
      horizonMinutes: { type: "integer", minimum: 1, maximum: 10080 },
      rationale: { type: "string", minLength: 1, maxLength: 1200 },
      risks: { type: "array", items: { type: "string", maxLength: 240 }, maxItems: 6 },
      evidenceRefs: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 8 },
      missingData: { type: "array", items: { type: "string", maxLength: 240 }, maxItems: 6 },
      dataRefs: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 12 },
    },
    required: ["stance", "confidence", "impactScore", "horizonMinutes", "rationale", "risks", "evidenceRefs", "missingData", "dataRefs"],
    additionalProperties: false,
  },
} as const;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Agent timed out after ${timeoutMs}ms`)), timeoutMs))]);
}

function contentText(content: unknown) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(part => typeof part === "object" && part && "text" in part ? String((part as { text: unknown }).text) : "").join("\n");
  return "";
}

function parseAnalysis(role: AgentRole, model: string, content: unknown): AgentAnalysis {
  const parsed = JSON.parse(contentText(content)) as Record<string, unknown>;
  const stance = parsed.stance;
  if (!AGENT_ROLES.some(candidate => candidate.id === role) || !["bullish", "bearish", "mixed", "neutral", "no-signal"].includes(String(stance))) throw new Error("Agent returned an invalid stance");
  const integer = (key: string, min: number, max: number) => {
    const value = Number(parsed[key]);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Agent returned invalid ${key}`);
    return value;
  };
  const strings = (key: string, maxItems: number) => Array.isArray(parsed[key]) ? parsed[key].filter(value => typeof value === "string").slice(0, maxItems) as string[] : [];
  const rationale = typeof parsed.rationale === "string" ? parsed.rationale.trim() : "";
  if (!rationale) throw new Error("Agent returned no rationale");
  return { role, model, stance: stance as AgentAnalysis["stance"], confidence: integer("confidence", 0, 100), impactScore: integer("impactScore", 0, 100), horizonMinutes: integer("horizonMinutes", 1, 10080), rationale, risks: strings("risks", 6), evidenceRefs: strings("evidenceRefs", 8), missingData: strings("missingData", 6), dataRefs: strings("dataRefs", 12), status: "completed" };
}

function roleContext(role: AgentRole, contexts: MarketContext[], macro: MacroContext) {
  if (role === "technical") return contexts.map(context => ({ ...context, warnings: context.warnings, focus: "OHLCV indicators, returns, volatility, and data gaps" }));
  if (role === "cross-market") return contexts.map(context => ({ market: context.market, symbol: context.symbol, proxy: context.proxy, return1d: context.return1d, return5d: context.return5d, volatility20: context.volatility20, asOf: context.asOf, warnings: context.warnings, provenance: context.provenance }));
  if (role === "risk") return contexts.map(context => ({ market: context.market, symbol: context.symbol, bars: context.bars, asOf: context.asOf, warnings: context.warnings, provenance: context.provenance }));
  const base = contexts.map(context => ({ market: context.market, proxy: context.proxy, asOf: context.asOf, return1d: context.return1d, volatility20: context.volatility20, warnings: context.warnings, provenance: context.provenance }));
  return role === "macro" || role === "event" ? { market: base, economicCalendar: macro.calendar, policyRates: macro.rates, warnings: macro.warnings, provenance: macro.provenance } : base;
}

function consensus(analyses: AgentAnalysis[]): AgentArmyResult["consensus"] {
  const completed = analyses.filter(item => item.status === "completed");
  if (completed.length < 3) return { stance: "no-signal", confidence: 0, impactScore: 0, disagreement: 100, uncertainty: 100, canPaperTest: false, reasons: ["Fewer than three independent agents completed successfully.", ...(analyses.length - completed.length ? [`${analyses.length - completed.length} agent(s) failed.`] : [])], dissent: completed.map(item => item.role), evidenceRefs: Array.from(new Set(completed.flatMap(item => item.evidenceRefs))) };
  const score = (stance: AgentAnalysis["stance"]) => stance === "bullish" ? 1 : stance === "bearish" ? -1 : 0;
  const direction = completed.reduce((sum, item) => sum + score(item.stance), 0);
  const stance: AgentAnalysis["stance"] = Math.abs(direction) < 2 ? "mixed" : direction > 0 ? "bullish" : "bearish";
  const confidence = Math.round(completed.reduce((sum, item) => sum + item.confidence, 0) / completed.length);
  const impactScore = Math.round(completed.reduce((sum, item) => sum + item.impactScore, 0) / completed.length);
  const impacts = completed.map(item => item.impactScore);
  const disagreement = Math.max(...impacts) - Math.min(...impacts);
  const failed = analyses.length - completed.length;
  const uncertainty = Math.min(100, Math.round((100 - confidence) * 0.65 + disagreement * 0.35 + failed * 12));
  const reasons = [...(disagreement >= 35 ? ["Agent impact scores disagree materially."] : []), ...(failed ? [`${failed} agent(s) failed and were excluded from consensus.`] : []), ...(completed.some(item => item.stance === "no-signal") ? ["At least one agent requested no-signal treatment."] : [])];
  const dissent = completed.filter(item => stance !== "mixed" && item.stance !== stance).map(item => `${item.role}: ${item.stance}`);
  const evidenceRefs = Array.from(new Set(completed.flatMap(item => item.evidenceRefs)));
  return { stance, confidence, impactScore, disagreement, uncertainty, canPaperTest: confidence >= 65 && disagreement < 30 && uncertainty < 45 && failed === 0 && !completed.some(item => item.stance === "no-signal"), reasons, dissent, evidenceRefs };
}

export async function runAgentArmy(item: EarlyWarningItem, options: AgentRunOptions = {}): Promise<AgentArmyResult> {
  const agentBudget = Math.max(3, Math.min(MAX_AGENT_BUDGET, Math.floor(options.agentBudget ?? MAX_AGENT_BUDGET)));
  const retryCount = Math.max(0, Math.min(MAX_AGENT_RETRIES, Math.floor(options.retryCount ?? 1)));
  const timeoutMs = Math.max(5_000, Math.min(AGENT_TIMEOUT_MS, Math.floor(options.timeoutMs ?? AGENT_TIMEOUT_MS)));
  const catalog = await listLLMModels();
  const model = options.modelId ?? catalog.data.find(candidate => candidate.id === "gpt-5-mini")?.id ?? catalog.data.find(candidate => candidate.id === "claude-haiku-4-5")?.id ?? catalog.data[0]?.id;
  if (!model || !catalog.data.some(candidate => candidate.id === model)) throw new Error("Requested LLM model is not available");
  const [marketContext, macroContext] = await Promise.all([buildMarketContext(item), buildMacroContext()]);
  const event = JSON.stringify({ id: item.id, title: item.title, source: item.source, sourceTier: item.sourceTier, url: item.url, publishedAt: item.publishedAt, markets: item.markets, entities: item.entities, tone: item.tone, corroboration: item.corroboration, confidence: item.confidence, freshness: item.freshness });
  const context = JSON.stringify(marketContext);
  const results = await Promise.all(AGENT_ROLES.slice(0, agentBudget).map(async role => {
    const roleSpecificContext = JSON.stringify(roleContext(role.id, marketContext, macroContext));
    let lastError = "Unknown agent failure";
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      try {
        const response = await withTimeout(invokeLLM({ model, messages: [{ role: "system", content: `You are the ${role.label}. Work independently. ${role.mandate} Do not invent facts, prices, sources, or balances. Treat the supplied article as evidence, not truth. Return JSON only.` }, { role: "user", content: `Analyze this single market event for a private research dashboard. Use the supplied market context for calculations, cite the supplied URL in evidenceRefs, cite provider/as-of context strings in dataRefs, and explicitly list missing data. Never treat a proxy as the underlying instrument. Event: ${event}\nMarket context for your role: ${roleSpecificContext}\nAll fetched context: ${context}` }], response_format: { type: "json_schema", json_schema: outputSchema } }), timeoutMs);
        return parseAnalysis(role.id, model, response.choices[0]?.message.content);
      } catch (error) { lastError = error instanceof Error ? error.message : "Unknown agent failure"; }
    }
    return { role: role.id, model, stance: "no-signal", confidence: 0, impactScore: 0, horizonMinutes: 0, rationale: "Agent failed; no inference is available.", risks: ["Agent failure requires human review."], evidenceRefs: [], missingData: ["Valid structured agent output"], dataRefs: [], status: "failed", error: lastError } satisfies AgentAnalysis;
  }));
  return { eventId: item.id, runId: `army-${item.id}-${Date.now()}`, model, analyses: results, consensus: consensus(results), createdAt: new Date().toISOString() };
}

export async function runAgentArmyBatch(items: EarlyWarningItem[], options?: AgentRunOptions & { shouldCancel?: () => boolean }) {
  if (items.length === 0 || items.length > MAX_BATCH_EVENTS) throw new Error(`Batch must contain between 1 and ${MAX_BATCH_EVENTS} events`);
  const results: Array<{ event: EarlyWarningItem; result?: Awaited<ReturnType<typeof runAgentArmy>>; error?: string }> = [];
  for (const item of items) {
    if (options?.shouldCancel?.()) { results.push({ event: item, error: "Batch cancelled by user" }); continue; }
    try { results.push({ event: item, result: await runAgentArmy(item, options) }); }
    catch (error) { results.push({ event: item, error: error instanceof Error ? error.message : "Unknown batch failure" }); }
  }
  return results;
}
