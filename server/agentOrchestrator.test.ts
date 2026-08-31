import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const payload = {
    stance: "bullish",
    confidence: 72,
    impactScore: 68,
    horizonMinutes: 120,
    rationale: "The supplied event may affect the named market, but confirmation is required.",
    risks: ["Headline may be incomplete"],
    evidenceRefs: ["https://example.com/event"],
    missingData: ["Price and volume confirmation"],
    dataRefs: ["Massive:as-of"],
  };
  return {
    listLLMModels: vi.fn(async () => ({ data: [{ id: "gpt-5-mini", object: "model", created: 1, owned_by: "openai" }] })),
    invokeLLM: vi.fn(async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] })),
  };
});
vi.mock("./_core/llm", () => mocks);
vi.mock("./marketContext", () => ({ buildMarketContext: vi.fn(async () => []) }));
vi.mock("./macroContext", () => ({ buildMacroContext: vi.fn(async () => ({ retrievedAt: 1, calendar: [], rates: [], warnings: [], provenance: [] })) }));
const { runAgentArmy, runAgentArmyBatch } = await import("./agentOrchestrator");

const event = {
  id: "event-1", title: "Central bank signals rate change", url: "https://example.com/event", publishedAt: "2026-08-29T10:00:00Z", retrievedAt: "2026-08-29T10:01:00Z", source: "example.com", sourceTier: "financial-media" as const, severity: "high" as const, markets: ["Rates", "FX"], entities: ["central bank"], tone: -4, corroboration: "single-source" as const, confidence: 78, leadTimeEstimateMinutes: 30, freshness: "fresh" as const,
};

describe("agent army orchestrator", () => {
  it("fans out six independent roles and returns a consensus gate", async () => {
    const result = await runAgentArmy(event);
    expect(mocks.listLLMModels).toHaveBeenCalledOnce();
    expect(mocks.invokeLLM).toHaveBeenCalledTimes(6);
    expect(result.analyses).toHaveLength(6);
    expect(result.analyses.every(agent => agent.status === "completed")).toBe(true);
    expect(result.consensus.stance).toBe("bullish");
    expect(result.consensus.canPaperTest).toBe(true);
    expect(result.consensus.dissent).toEqual([]);
    expect(result.consensus.evidenceRefs).toEqual(["https://example.com/event"]);
  });

  it("enforces the batch cap and isolates one event failure from the other event", async () => {
    await expect(runAgentArmyBatch(Array.from({ length: 6 }, (_, index) => ({ ...event, id: `event-${index}` })))).rejects.toThrow("between 1 and 5");
    mocks.invokeLLM.mockRejectedValueOnce(new Error("one event unavailable"));
    const results = await runAgentArmyBatch([{ ...event, id: "batch-a" }, { ...event, id: "batch-b" }]);
    expect(results).toHaveLength(2);
    expect(results.some(entry => entry.error)).toBe(false);
    expect(results.every(entry => entry.result)).toBe(true);
  });

  it("converts a failed structured call into a no-signal analysis and blocks paper testing", async () => {
    let calls = 0;
    mocks.invokeLLM.mockImplementation(async () => { calls += 1; if (calls === 1 || calls === 7) throw new Error("upstream unavailable"); return { choices: [{ message: { content: JSON.stringify(payload) } }] }; });
    const result = await runAgentArmy(event);
    expect(result.analyses.some(agent => agent.status === "failed")).toBe(true);
    expect(result.consensus.canPaperTest).toBe(false);
    expect(result.consensus.reasons.join(" ")).toContain("failed");
    mocks.invokeLLM.mockClear();
  });

  it("stops a batch before invoking another event when cancellation is requested", async () => {
    const results = await runAgentArmyBatch([{ ...event, id: "cancel-a" }, { ...event, id: "cancel-b" }], { shouldCancel: () => true });
    expect(results).toEqual([{ event: expect.objectContaining({ id: "cancel-a" }), error: "Batch cancelled by user" }, { event: expect.objectContaining({ id: "cancel-b" }), error: "Batch cancelled by user" }]);
  });

  it("marks every role as failed when the provider exceeds the configured timeout", async () => {
    mocks.invokeLLM.mockImplementation(() => new Promise(() => undefined));
    const result = await runAgentArmy(event, { retryCount: 0, timeoutMs: 5_000 });
    expect(result.analyses.every(agent => agent.status === "failed")).toBe(true);
    expect(result.consensus.stance).toBe("no-signal");
    expect(result.consensus.reasons.join(" ")).toContain("failed");
  }, 15_000);
});
