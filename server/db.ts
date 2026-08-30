import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, agentOutputs, agentRunEvents, agentRuns, auditEvents, historicalDataRuns, historicalDatasets, intelligenceItems, integrations, instruments, opportunityHistory, opportunityRecords, paperAlerts, riskControls, signals, simulations, users } from "../drizzle/schema";
import { ENV } from './_core/env';
import { ownerScoped } from "../shared/ownership";
import { paperAlertAuditPayload, shouldPersistPaperAlert } from "../shared/radarTools";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getInstrumentsByOwner(ownerId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(instruments).where(eq(instruments.ownerId, ownerId));
  return ownerScoped(rows, ownerId);
}

export async function getAuditEventsByOwner(ownerId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(auditEvents).where(eq(auditEvents.ownerId, ownerId));
  return ownerScoped(rows, ownerId);
}

export async function getSignalsByOwner(ownerId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(signals).where(eq(signals.ownerId, ownerId));
  return ownerScoped(rows, ownerId);
}

export async function getIntelligenceByOwner(ownerId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(intelligenceItems).where(eq(intelligenceItems.ownerId, ownerId));
  return ownerScoped(rows, ownerId);
}

export async function recordAgentOutput(input: {
  ownerId: number;
  role: string;
  stance: string;
  confidence: number;
  rationale: string;
  evidenceRefs: unknown;
  runId?: number;
  eventId?: string;
}) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.insert(agentOutputs).values({ ownerId: input.ownerId, runId: input.runId, eventId: input.eventId, role: input.role, stance: input.stance, confidence: input.confidence, rationale: input.rationale, evidenceRefs: input.evidenceRefs });
  await appendAuditEventToDb({ ownerId: input.ownerId, eventType: "agent_output_created", entityType: "agent_output", payload: { role: input.role, stance: input.stance, confidence: input.confidence, evidenceRefs: input.evidenceRefs } });
  return result;
}

export async function createAgentRun(input: typeof agentRuns.$inferInsert) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.insert(agentRuns).values(input);
  return Number(result[0].insertId);
}

export async function updateAgentRun(ownerId: number, id: number, patch: Partial<typeof agentRuns.$inferInsert>) {
  const db = await getDb();
  if (!db) return undefined;
  await db.update(agentRuns).set(patch).where(and(eq(agentRuns.id, id), eq(agentRuns.ownerId, ownerId)));
  return id;
}

export async function createAgentRunEvent(input: typeof agentRunEvents.$inferInsert) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.insert(agentRunEvents).values(input);
  return Number(result[0].insertId);
}

export async function updateAgentRunEvent(ownerId: number, id: number, patch: Partial<typeof agentRunEvents.$inferInsert>) {
  const db = await getDb();
  if (!db) return undefined;
  await db.update(agentRunEvents).set(patch).where(and(eq(agentRunEvents.id, id), eq(agentRunEvents.ownerId, ownerId)));
  return id;
}

export async function getAgentRunsByOwner(ownerId: number) {
  const db = await getDb();
  if (!db) return [];
  return ownerScoped(await db.select().from(agentRuns).where(eq(agentRuns.ownerId, ownerId)), ownerId);
}

export async function getAgentRunEventsByOwner(ownerId: number, runId?: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(agentRunEvents).where(runId === undefined ? eq(agentRunEvents.ownerId, ownerId) : and(eq(agentRunEvents.ownerId, ownerId), eq(agentRunEvents.runId, runId)));
  return ownerScoped(rows, ownerId);
}

export async function getAgentOutputsByOwner(ownerId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(agentOutputs).where(eq(agentOutputs.ownerId, ownerId));
  return ownerScoped(rows, ownerId);
}

export async function getRiskControlsByOwner(ownerId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(riskControls).where(eq(riskControls.ownerId, ownerId));
  return ownerScoped(rows, ownerId);
}

export async function getSimulationsByOwner(ownerId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(simulations).where(eq(simulations.ownerId, ownerId));
  return ownerScoped(rows, ownerId);
}

export async function getIntegrationsByOwner(ownerId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(integrations).where(eq(integrations.ownerId, ownerId));
  return ownerScoped(rows, ownerId);
}

export async function recordHistoricalDataRun(input: {
  ownerId: number;
  provider: string;
  symbol: string;
  fromDate: string;
  toDate: string;
  timespan: string;
  adjusted: boolean;
  barsCount: number;
  provenance: unknown;
}) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.insert(historicalDataRuns).values(input);
  return result;
}

export async function recordHistoricalDataset(input: typeof historicalDatasets.$inferInsert) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.insert(historicalDatasets).values(input);
  return result;
}

export async function getHistoricalDatasetsByOwner(ownerId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(historicalDatasets).where(eq(historicalDatasets.ownerId, ownerId));
  return ownerScoped(rows, ownerId);
}

export async function getHistoricalDataRunsByOwner(ownerId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(historicalDataRuns).where(eq(historicalDataRuns.ownerId, ownerId));
  return ownerScoped(rows, ownerId);
}

export async function appendAuditEventToDb(input: {
  ownerId: number;
  eventType: string;
  entityType: string;
  entityId?: number;
  payload?: unknown;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.insert(auditEvents).values({
    ownerId: input.ownerId,
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: input.entityId,
    payload: input.payload,
  });
  const rows = await db.select().from(auditEvents).where(eq(auditEvents.ownerId, input.ownerId));
  return rows[rows.length - 1];
}

export async function getPaperAlertsByOwner(ownerId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(paperAlerts).where(eq(paperAlerts.ownerId, ownerId));
  return ownerScoped(rows, ownerId);
}

export async function recordPaperAlert(input: typeof paperAlerts.$inferInsert) {
  const db = await getDb();
  if (!db) return undefined;
  const existing = await db.select().from(paperAlerts).where(and(eq(paperAlerts.ownerId, input.ownerId), eq(paperAlerts.warningId, input.warningId))).limit(1);
  if (!shouldPersistPaperAlert(existing.map(alert => alert.warningId), input.warningId)) return existing[0];
  await db.insert(paperAlerts).values(input);
  await appendAuditEventToDb({ ownerId: input.ownerId, eventType: "paper_alert_triggered", entityType: "paper_alert", payload: paperAlertAuditPayload(input) });
  const rows = await db.select().from(paperAlerts).where(and(eq(paperAlerts.ownerId, input.ownerId), eq(paperAlerts.warningId, input.warningId))).limit(1);
  return rows[0];
}

export async function getOpportunityRecordsByOwner(ownerId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(opportunityRecords).where(eq(opportunityRecords.ownerId, ownerId));
  return ownerScoped(rows, ownerId);
}

export async function upsertOpportunityRecord(input: { ownerId: number; externalKey: string; title: string; url: string; source: string; verification: string; status?: "new" | "reviewing" | "verified" | "dismissed"; note?: string | null }) {
  const db = await getDb();
  if (!db) return undefined;
  const found = await db.select().from(opportunityRecords).where(and(eq(opportunityRecords.ownerId, input.ownerId), eq(opportunityRecords.externalKey, input.externalKey))).limit(1);
  if (!found[0]) {
    await db.insert(opportunityRecords).values(input);
    const created = (await db.select().from(opportunityRecords).where(and(eq(opportunityRecords.ownerId, input.ownerId), eq(opportunityRecords.externalKey, input.externalKey))).limit(1))[0];
    if (created) await db.insert(opportunityHistory).values({ ownerId: input.ownerId, opportunityId: created.id, action: "created", payload: input });
    return created;
  }
  return found[0];
}

export async function updateOpportunityRecord(input: { ownerId: number; id: number; status?: "new" | "reviewing" | "verified" | "dismissed"; note?: string | null }) {
  const db = await getDb();
  if (!db) return undefined;
  const current = (await db.select().from(opportunityRecords).where(and(eq(opportunityRecords.ownerId, input.ownerId), eq(opportunityRecords.id, input.id))).limit(1))[0];
  if (!current) return undefined;
  const patch = { ...(input.status ? { status: input.status } : {}), ...(input.note !== undefined ? { note: input.note } : {}) };
  await db.update(opportunityRecords).set(patch).where(and(eq(opportunityRecords.ownerId, input.ownerId), eq(opportunityRecords.id, input.id)));
  await db.insert(opportunityHistory).values({ ownerId: input.ownerId, opportunityId: input.id, action: "updated", payload: { before: { status: current.status, note: current.note }, after: patch } });
  await appendAuditEventToDb({ ownerId: input.ownerId, eventType: "opportunity_updated", entityType: "opportunity", entityId: input.id, payload: patch });
  return (await db.select().from(opportunityRecords).where(and(eq(opportunityRecords.ownerId, input.ownerId), eq(opportunityRecords.id, input.id))).limit(1))[0];
}

export async function getOpportunityHistoryByOwner(ownerId: number, opportunityId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(opportunityHistory).where(and(eq(opportunityHistory.ownerId, ownerId), eq(opportunityHistory.opportunityId, opportunityId)));
  return ownerScoped(rows, ownerId);
}
