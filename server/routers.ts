import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { appendAuditEventToDb, createAgentRun, createAgentRunEvent, getAgentOutputsByOwner, getAgentRunEventsByOwner, getAgentRunsByOwner, getAuditEventsByOwner, getHistoricalDataRunsByOwner, getHistoricalDatasetsByOwner, getIntegrationsByOwner, getIntelligenceByOwner, getInstrumentsByOwner, getOpportunityHistoryByOwner, getOpportunityRecordsByOwner, getPaperAlertsByOwner, getRiskControlsByOwner, getSignalsByOwner, getSimulationsByOwner, getWalletConnectionByOwner, getWalletConnectionByTaskUid, markWalletHeartbeat, markWalletReadAt, recordAgentOutput, recordHistoricalDataRun, recordHistoricalDataset, recordPaperAlert, updateAgentRun, updateOpportunityRecord, updateWalletMonitor, upsertOpportunityRecord, upsertWalletConnection } from "./db";
import { fetchMassiveHistorical } from "./massiveData";
import { runAgentArmy, runAgentArmyBatch } from "./agentOrchestrator";
import { parseFlatFileChunks, type FlatFileMapping } from "../shared/flatFile";
import { createHash } from "node:crypto";
import { storagePut } from "./storage";
import { ENV } from "./_core/env";
import { fetchEarlyWarnings, type EarlyWarningItem } from "./intelligence";
import { listLLMModels } from "./_core/llm";
import { buildAgentBatchCancelledAudit, buildCancelledRunPatch } from "../shared/agentRun";
import { buildMacroContext } from "./macroContext";
import { calculatePostReleaseReaction, calibrateSurpriseSeverity } from "../shared/marketReaction";
import { fetchReadOnlyWalletPortfolio, validatePublicWalletAddress, walletNetworkSchema } from "./wallet";
import { getSessionTokenFromRequest } from "./sessionToken";
import { deriveWalletMonitorState, shouldChangeWalletMonitor } from "../shared/walletMonitor";
import { createHeartbeatJob, updateHeartbeatJob } from "./_core/heartbeat";

const radarEventInput = z.object({ provider: z.enum(["gdelt", "google-news", "stale-cache"]).default("gdelt"), id: z.string().max(160), title: z.string().min(1).max(500), url: z.string().url(), publishedAt: z.string(), retrievedAt: z.string(), source: z.string(), sourceTier: z.enum(["discovery", "financial-media", "official"]), severity: z.enum(["low", "medium", "high"]), markets: z.array(z.string()).max(12), entities: z.array(z.string()).max(24), tone: z.number(), corroboration: z.enum(["single-source", "cross-source"]), confidence: z.number().int().min(0).max(100), leadTimeEstimateMinutes: z.number().int().min(1), freshness: z.enum(["fresh", "aging", "stale"]) });
const MAX_AGENT_BATCH_EVENTS = 5;
const activeBatchCancels = new Map<number, { cancelled: boolean }>();
const agentRunOptionsInput = z.object({ modelId: z.string().min(1).max(120).optional(), agentBudget: z.number().int().min(3).max(6).optional(), retryCount: z.number().int().min(0).max(2).optional(), timeoutMs: z.number().int().min(5_000).max(45_000).optional() }).optional();

async function persistArmyResults(ownerId: number, runId: number | undefined, results: Array<{ event: EarlyWarningItem; result?: Awaited<ReturnType<typeof runAgentArmy>>; error?: string }>) {
  for (const entry of results) {
    const runEventId = runId ? await createAgentRunEvent({ ownerId, runId, eventId: entry.event.id, status: entry.result ? "completed" : "failed", consensus: entry.result?.consensus, error: entry.error }) : undefined;
    if (entry.result) {
      await Promise.all(entry.result.analyses.filter(agent => agent.status === "completed").map(agent => recordAgentOutput({ ownerId, runId, eventId: entry.result!.eventId, role: agent.role, stance: agent.stance, confidence: agent.confidence, rationale: agent.rationale, evidenceRefs: { model: agent.model, impactScore: agent.impactScore, horizonMinutes: agent.horizonMinutes, risks: agent.risks, missingData: agent.missingData, evidenceRefs: agent.evidenceRefs, dataRefs: agent.dataRefs } })));
      await appendAuditEventToDb({ ownerId, eventType: "agent_army_consensus", entityType: "early_warning", entityId: runEventId, payload: { eventId: entry.result.eventId, runId: entry.result.runId, model: entry.result.model, consensus: entry.result.consensus } });
    }
  }
}

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  market: router({
    watchlist: protectedProcedure.query(({ ctx }) => getInstrumentsByOwner(ctx.user.id)),
    audit: protectedProcedure.query(({ ctx }) => getAuditEventsByOwner(ctx.user.id)),
    signals: protectedProcedure.query(({ ctx }) => getSignalsByOwner(ctx.user.id)),
    intelligence: protectedProcedure.query(({ ctx }) => getIntelligenceByOwner(ctx.user.id)),
    earlyWarnings: protectedProcedure.input(z.object({ query: z.string().min(3).max(240).optional() }).optional()).query(({ input }) => fetchEarlyWarnings(input?.query)),
    agentRuns: protectedProcedure.query(({ ctx }) => getAgentRunsByOwner(ctx.user.id)),
    agentRunEvents: protectedProcedure.input(z.object({ runId: z.number().int().positive().optional() }).optional()).query(({ ctx, input }) => getAgentRunEventsByOwner(ctx.user.id, input?.runId)),
    agentModels: protectedProcedure.query(async () => (await listLLMModels()).data.map(model => ({ id: model.id, owner: model.owned_by }))),
    macroContext: protectedProcedure.query(() => buildMacroContext()),
    analyzeEvent: protectedProcedure.input(z.object({ event: radarEventInput, options: agentRunOptionsInput })).mutation(async ({ ctx, input }) => { const startedAt = new Date(); const runId = await createAgentRun({ ownerId: ctx.user.id, mode: "single", status: "running", requestedCount: 1, maxCalls: (input.options?.agentBudget ?? 6) * (1 + (input.options?.retryCount ?? 1)), budgetUnits: input.options?.agentBudget ?? 6, startedAt }); try { const result = await runAgentArmy(input.event, input.options); await persistArmyResults(ctx.user.id, runId, [{ event: input.event, result }]); await updateAgentRun(ctx.user.id, runId ?? 0, { status: result.consensus.canPaperTest ? "completed" : "partial", completedCount: result.analyses.filter(agent => agent.status === "completed").length, failedCount: result.analyses.filter(agent => agent.status === "failed").length, finishedAt: new Date() }); return result; } catch (error) { if (runId) await updateAgentRun(ctx.user.id, runId, { status: "failed", failedCount: 1, finishedAt: new Date() }); throw error; } }),
    analyzeBatch: protectedProcedure.input(z.object({ events: z.array(radarEventInput).min(1).max(MAX_AGENT_BATCH_EVENTS), options: agentRunOptionsInput })).mutation(async ({ ctx, input }) => { const startedAt = new Date(); const runId = await createAgentRun({ ownerId: ctx.user.id, mode: "batch", status: "running", requestedCount: input.events.length, maxCalls: input.events.length * (input.options?.agentBudget ?? 6) * (1 + (input.options?.retryCount ?? 1)), budgetUnits: input.events.length * (input.options?.agentBudget ?? 6), startedAt }); const cancelToken = { cancelled: false }; if (runId) activeBatchCancels.set(runId, cancelToken); try { const results = await runAgentArmyBatch(input.events, { ...input.options, shouldCancel: () => cancelToken.cancelled }); await persistArmyResults(ctx.user.id, runId, results); const completed = results.filter(entry => entry.result).length; if (runId) await updateAgentRun(ctx.user.id, runId, { status: cancelToken.cancelled ? "cancelled" : completed === results.length ? "completed" : completed ? "partial" : "failed", completedCount: completed, failedCount: results.length - completed, finishedAt: new Date() }); return { runId, results }; } finally { if (runId) activeBatchCancels.delete(runId); } }),
    cancelBatch: protectedProcedure.input(z.object({ runId: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const token = activeBatchCancels.get(input.runId); if (token) token.cancelled = true; await updateAgentRun(ctx.user.id, input.runId, buildCancelledRunPatch()); await appendAuditEventToDb(buildAgentBatchCancelledAudit(ctx.user.id, input.runId)); return { runId: input.runId, cancelled: true }; }),
    paperAlerts: protectedProcedure.query(({ ctx }) => getPaperAlertsByOwner(ctx.user.id)),
    recordPaperAlert: protectedProcedure.input(z.object({ warningId: z.string().max(160), headline: z.string().min(1).max(500), severity: z.enum(["low", "medium", "high"]), confidence: z.number().int().min(0).max(100), reason: z.string().min(1).max(500) })).mutation(({ ctx, input }) => recordPaperAlert({ ...input, ownerId: ctx.user.id })),
    opportunities: protectedProcedure.query(({ ctx }) => getOpportunityRecordsByOwner(ctx.user.id)),
    saveOpportunity: protectedProcedure.input(z.object({ externalKey: z.string().max(64), title: z.string().min(1).max(180), url: z.string().url(), source: z.string().min(1).max(180), verification: z.string().min(1).max(1000), status: z.enum(["new", "reviewing", "verified", "dismissed"]).optional(), note: z.string().max(2000).nullable().optional() })).mutation(({ ctx, input }) => upsertOpportunityRecord({ ...input, ownerId: ctx.user.id })),
    updateOpportunity: protectedProcedure.input(z.object({ id: z.number().int().positive(), status: z.enum(["new", "reviewing", "verified", "dismissed"]).optional(), note: z.string().max(2000).nullable().optional() })).mutation(({ ctx, input }) => updateOpportunityRecord({ ...input, ownerId: ctx.user.id })),
    opportunityHistory: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(({ ctx, input }) => getOpportunityHistoryByOwner(ctx.user.id, input.id)),
    agents: protectedProcedure.query(({ ctx }) => getAgentOutputsByOwner(ctx.user.id)),
    risk: protectedProcedure.query(({ ctx }) => getRiskControlsByOwner(ctx.user.id)),
    simulations: protectedProcedure.query(({ ctx }) => getSimulationsByOwner(ctx.user.id)),
    integrations: protectedProcedure.query(({ ctx }) => getIntegrationsByOwner(ctx.user.id)),
    walletConnection: protectedProcedure.query(async ({ ctx }) => {
      const connection = await getWalletConnectionByOwner(ctx.user.id);
      if (!connection) return null;
      return { ...connection, monitorStatus: deriveWalletMonitorState({ enabled: connection.monitorEnabled, status: connection.monitorStatus, lastHeartbeatAt: connection.lastHeartbeatAt }) };
    }),
    saveWalletConnection: protectedProcedure.input(z.object({ network: walletNetworkSchema, publicAddress: z.string().min(1).max(64) })).mutation(async ({ ctx, input }) => {
      if (!validatePublicWalletAddress(input.network, input.publicAddress)) throw new Error(`Invalid public ${input.network} address`);
      const connection = await upsertWalletConnection({ ownerId: ctx.user.id, network: input.network, publicAddress: input.publicAddress.trim(), isActive: true });
      await appendAuditEventToDb({ ownerId: ctx.user.id, eventType: "wallet_connection_saved", entityType: "public_wallet", payload: { network: input.network, address: input.publicAddress.trim(), readOnly: true, custody: false } });
      return connection;
    }),
    walletMonitor: protectedProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
      const connection = await getWalletConnectionByOwner(ctx.user.id);
      if (!connection) throw new Error("Save a public wallet address before enabling the monitor");
      const sessionToken = getSessionTokenFromRequest(ctx.req);
      let taskUid = connection.monitorTaskUid;
      if (!shouldChangeWalletMonitor({ enabled: connection.monitorEnabled, taskUid }, input.enabled)) return connection;
      if (input.enabled) {
        if (taskUid) {
          await updateHeartbeatJob(taskUid, { enable: true }, sessionToken);
        } else {
          const job = await createHeartbeatJob({ name: `wallet-monitor-${ctx.user.id}`, cron: "0 * * * * *", path: "/api/scheduled/walletMonitor", description: "Read-only public wallet refresh; no orders, transfers, or custody." }, sessionToken);
          taskUid = job.taskUid;
        }
      } else if (taskUid) {
        await updateHeartbeatJob(taskUid, { enable: false }, sessionToken);
      }
      const updated = await updateWalletMonitor(ctx.user.id, { monitorEnabled: input.enabled, monitorTaskUid: taskUid, monitorStatus: input.enabled ? "scheduled" : "off" });
      await appendAuditEventToDb({ ownerId: ctx.user.id, eventType: input.enabled ? "wallet_monitor_enabled" : "wallet_monitor_disabled", entityType: "public_wallet", payload: { taskUid, cadence: "60s", mode: "read-only-paper-only" } });
      return updated;
    }),
    walletPortfolio: protectedProcedure.input(z.object({ network: walletNetworkSchema, address: z.string().min(1).max(64) })).query(async ({ ctx, input }) => {
      const portfolio = await fetchReadOnlyWalletPortfolio(input);
      await markWalletReadAt(ctx.user.id);
      await appendAuditEventToDb({ ownerId: ctx.user.id, eventType: "wallet_read_only_refresh", entityType: "public_wallet", payload: { network: portfolio.network, address: portfolio.address, provider: portfolio.provider, retrievedAt: portfolio.retrievedAt, scope: portfolio.scope } });
      return portfolio;
    }),
    providerStatus: protectedProcedure.query(() => ({ provider: "Massive" as const, configured: Boolean(ENV.massiveApiKey), liveTradingEnabled: false as const })),
    historicalBars: protectedProcedure.input(z.object({
      symbol: z.string().min(1).max(40),
      from: z.string(),
      to: z.string(),
      multiplier: z.number().int().min(1).max(60).optional(),
      timespan: z.enum(["minute", "hour", "day", "week", "month"]).optional(),
      adjusted: z.boolean().optional(),
      limit: z.number().int().min(1).max(50_000).optional(),
    })).query(async ({ ctx, input }) => {
      const result = await fetchMassiveHistorical(input);
      await recordHistoricalDataRun({ ownerId: ctx.user.id, provider: result.provider, symbol: result.symbol, fromDate: input.from, toDate: input.to, timespan: result.provenance.timespan, adjusted: result.provenance.adjusted, barsCount: result.bars.length, provenance: result.provenance });
      return result;
    }),
    historicalRuns: protectedProcedure.query(({ ctx }) => getHistoricalDataRunsByOwner(ctx.user.id)),
    priceReaction: protectedProcedure.input(z.object({ symbol: z.string().min(1).max(40), releaseTimestamp: z.number().int().positive(), surpriseZScore: z.number().finite().nullable().optional(), from: z.string(), to: z.string(), multiplier: z.number().int().min(1).max(60).default(1), timespan: z.enum(["minute", "hour", "day"]).default("minute") })).query(async ({ ctx, input }) => { const result = await fetchMassiveHistorical({ symbol: input.symbol, from: input.from, to: input.to, multiplier: input.multiplier, timespan: input.timespan, adjusted: true, limit: 50_000 }); const reaction = calculatePostReleaseReaction(result.bars, input.releaseTimestamp); const calibration = calibrateSurpriseSeverity(input.surpriseZScore ?? null, reaction.points); await appendAuditEventToDb({ ownerId: ctx.user.id, eventType: "market_reaction_calibration", entityType: "economic_release", payload: { symbol: input.symbol, releaseTimestamp: input.releaseTimestamp, surpriseZScore: input.surpriseZScore ?? null, calibration, provenance: result.provenance } }); return { ...reaction, calibration, provider: result.provider, symbol: input.symbol, provenance: result.provenance }; }),
    flatFileDatasets: protectedProcedure.query(({ ctx }) => getHistoricalDatasetsByOwner(ctx.user.id)),
    uploadFlatFile: protectedProcedure.input(z.object({
      name: z.string().min(1).max(160), format: z.enum(["csv", "ndjson"]), source: z.string().min(1).max(160).default("user-upload"), symbol: z.string().min(1).max(40), timezone: z.string().min(1).max(64).default("UTC"), interval: z.enum(["minute", "hour", "day", "week", "month"]).default("day"), contentBase64: z.string().min(1).max(35_000_000), mapping: z.record(z.string(), z.string()).optional(),
    })).mutation(async ({ ctx, input }) => {
      const content = Buffer.from(input.contentBase64, "base64");
      if (content.length > 25 * 1024 * 1024) throw new Error("Flat File exceeds the 25 MB MVP upload limit; split the dataset into time partitions.");
      const sha256 = createHash("sha256").update(content).digest("hex");
      async function* chunks() { for (let offset = 0; offset < content.length; offset += 256 * 1024) yield content.subarray(offset, Math.min(offset + 256 * 1024, content.length)); }
      const parsed = await parseFlatFileChunks(chunks(), input.format, input.mapping as Partial<FlatFileMapping> | undefined, input.interval);
      const stored = await storagePut(`${ctx.user.id}-datasets/${input.name}`, content, input.format === "csv" ? "text/csv" : "application/x-ndjson");
      await recordHistoricalDataset({ ownerId: ctx.user.id, name: input.name, format: input.format, source: input.source, storageKey: stored.key, sha256, byteSize: content.length, rowCount: parsed.bars.length, symbol: input.symbol, timezone: input.timezone, firstTimestamp: parsed.firstTimestamp ? new Date(parsed.firstTimestamp) : null, lastTimestamp: parsed.lastTimestamp ? new Date(parsed.lastTimestamp) : null, status: parsed.errors.length ? "rejected" : "validated", warnings: parsed.warnings, errors: parsed.errors });
      return { ...parsed, storageKey: stored.key, sha256, byteSize: content.length, status: parsed.errors.length ? "rejected" as const : "validated" as const };
    }),
    appendAudit: protectedProcedure.input(z.object({
      eventType: z.string().min(1).max(64),
      entityType: z.string().min(1).max(64),
      entityId: z.number().int().positive().optional(),
      payload: z.unknown().optional(),
    })).mutation(({ ctx, input }) => appendAuditEventToDb({ ...input, ownerId: ctx.user.id })),
  }),
});

export type AppRouter = typeof appRouter;
