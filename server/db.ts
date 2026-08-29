import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, agentOutputs, auditEvents, historicalDataRuns, intelligenceItems, integrations, instruments, riskControls, signals, simulations, users } from "../drizzle/schema";
import { ENV } from './_core/env';
import { ownerScoped } from "../shared/ownership";

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
