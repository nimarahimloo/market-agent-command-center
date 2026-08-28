import { boolean, decimal, int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const instruments = mysqlTable("instruments", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  assetClass: varchar("assetClass", { length: 32 }).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const agentOutputs = mysqlTable("agentOutputs", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  role: varchar("role", { length: 64 }).notNull(),
  instrumentId: int("instrumentId"),
  stance: varchar("stance", { length: 32 }).notNull(),
  confidence: int("confidence").notNull(),
  rationale: text("rationale").notNull(),
  evidenceRefs: json("evidenceRefs"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const signals = mysqlTable("signals", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  instrumentId: int("instrumentId").notNull(),
  direction: varchar("direction", { length: 32 }).notNull(),
  confidence: int("confidence").notNull(),
  rationale: text("rationale").notNull(),
  invalidationLevel: decimal("invalidationLevel", { precision: 20, scale: 8 }),
  riskReward: decimal("riskReward", { precision: 8, scale: 3 }),
  status: mysqlEnum("status", ["research", "paper_approved", "archived"]).default("research").notNull(),
  reasoningRefs: json("reasoningRefs"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const intelligenceItems = mysqlTable("intelligenceItems", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  sourceName: varchar("sourceName", { length: 128 }).notNull(),
  sourceUrl: text("sourceUrl").notNull(),
  headline: text("headline").notNull(),
  entities: json("entities"),
  affectedMarkets: json("affectedMarkets"),
  sentiment: decimal("sentiment", { precision: 5, scale: 3 }),
  publishedAt: timestamp("publishedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const riskControls = mysqlTable("riskControls", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull().unique(),
  positionSizeLimit: decimal("positionSizeLimit", { precision: 8, scale: 4 }).default("0.5000").notNull(),
  dailyLossLimit: decimal("dailyLossLimit", { precision: 8, scale: 4 }).default("2.0000").notNull(),
  exposureCap: decimal("exposureCap", { precision: 8, scale: 4 }).default("10.0000").notNull(),
  killSwitchArmed: boolean("killSwitchArmed").default(true).notNull(),
  liveTradingEnabled: boolean("liveTradingEnabled").default(false).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const simulations = mysqlTable("simulations", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  universe: json("universe"),
  lookbackSessions: int("lookbackSessions").notNull(),
  status: mysqlEnum("status", ["queued", "running", "completed", "failed"]).default("queued").notNull(),
  returnPct: decimal("returnPct", { precision: 10, scale: 4 }),
  maxDrawdownPct: decimal("maxDrawdownPct", { precision: 10, scale: 4 }),
  winRatePct: decimal("winRatePct", { precision: 10, scale: 4 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const integrations = mysqlTable("integrations", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  provider: varchar("provider", { length: 64 }).notNull(),
  credentialRef: text("credentialRef"),
  isConnected: boolean("isConnected").default(false).notNull(),
  isReadOnly: boolean("isReadOnly").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const auditEvents = mysqlTable("auditEvents", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  eventType: varchar("eventType", { length: 64 }).notNull(),
  entityType: varchar("entityType", { length: 64 }).notNull(),
  entityId: int("entityId"),
  payload: json("payload"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});