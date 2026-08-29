import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { appendAuditEventToDb, getAgentOutputsByOwner, getAuditEventsByOwner, getHistoricalDataRunsByOwner, getHistoricalDatasetsByOwner, getIntegrationsByOwner, getIntelligenceByOwner, getInstrumentsByOwner, getRiskControlsByOwner, getSignalsByOwner, getSimulationsByOwner, recordHistoricalDataRun, recordHistoricalDataset } from "./db";
import { fetchMassiveHistorical } from "./massiveData";
import { parseFlatFileChunks, type FlatFileMapping } from "../shared/flatFile";
import { createHash } from "node:crypto";
import { storagePut } from "./storage";
import { ENV } from "./_core/env";

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
    agents: protectedProcedure.query(({ ctx }) => getAgentOutputsByOwner(ctx.user.id)),
    risk: protectedProcedure.query(({ ctx }) => getRiskControlsByOwner(ctx.user.id)),
    simulations: protectedProcedure.query(({ ctx }) => getSimulationsByOwner(ctx.user.id)),
    integrations: protectedProcedure.query(({ ctx }) => getIntegrationsByOwner(ctx.user.id)),
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
