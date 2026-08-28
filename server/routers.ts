import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { appendAuditEventToDb, getAgentOutputsByOwner, getAuditEventsByOwner, getIntegrationsByOwner, getIntelligenceByOwner, getInstrumentsByOwner, getRiskControlsByOwner, getSignalsByOwner, getSimulationsByOwner } from "./db";

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
    appendAudit: protectedProcedure.input(z.object({
      eventType: z.string().min(1).max(64),
      entityType: z.string().min(1).max(64),
      entityId: z.number().int().positive().optional(),
      payload: z.unknown().optional(),
    })).mutation(({ ctx, input }) => appendAuditEventToDb({ ...input, ownerId: ctx.user.id })),
  }),
});

export type AppRouter = typeof appRouter;
