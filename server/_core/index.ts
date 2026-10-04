import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { parseFlatFileChunks, type FlatFileMapping } from "../../shared/flatFile";
import { createHash } from "node:crypto";
import { storagePut } from "../storage";
import { appendAuditEventToDb, getWalletConnectionByTaskUid, markWalletHeartbeat, recordHistoricalDataset } from "../db";
import { runWatchdog } from "../watchdog";
import { fetchReadOnlyWalletPortfolio } from "../wallet";
import { sdk } from "./sdk";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.post("/api/flat-files/upload", express.raw({ type: ["text/csv", "application/x-ndjson"], limit: "25mb" }), async (req, res) => {
    try {
      const ctx = await createContext({ req, res, info: {} } as Parameters<typeof createContext>[0]);
      if (!ctx.user) return res.status(401).json({ message: "Authentication required" });
      const format = req.headers["x-flat-file-format"] === "ndjson" ? "ndjson" : "csv";
      const symbol = String(req.headers["x-flat-file-symbol"] ?? "UNKNOWN").slice(0, 40);
      const source = String(req.headers["x-flat-file-source"] ?? "user-upload").slice(0, 160);
      const interval = String(req.headers["x-flat-file-interval"] ?? "day") as "minute" | "hour" | "day" | "week" | "month";
      const name = String(req.headers["x-flat-file-name"] ?? "dataset").slice(0, 160);
      const content = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? "");
      const sha256 = createHash("sha256").update(content).digest("hex");
      const chunks = async function* () { for (let offset = 0; offset < content.length; offset += 256 * 1024) yield content.subarray(offset, Math.min(offset + 256 * 1024, content.length)); };
      const parsed = await parseFlatFileChunks(chunks(), format, {} as Partial<FlatFileMapping>, interval);
      const stored = await storagePut(`${ctx.user.id}-datasets/${name}`, content, format === "csv" ? "text/csv" : "application/x-ndjson");
      await recordHistoricalDataset({ ownerId: ctx.user.id, name, format, source, storageKey: stored.key, sha256, byteSize: content.length, rowCount: parsed.bars.length, symbol, timezone: "UTC", firstTimestamp: parsed.firstTimestamp ? new Date(parsed.firstTimestamp) : null, lastTimestamp: parsed.lastTimestamp ? new Date(parsed.lastTimestamp) : null, status: parsed.errors.length ? "rejected" : "validated", warnings: parsed.warnings, errors: parsed.errors });
      return res.json({ ...parsed, storageKey: stored.key, sha256, byteSize: content.length, status: parsed.errors.length ? "rejected" : "validated" });
    } catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : "Flat File upload failed" }); }
  });
  app.post("/api/scheduled/watchdog", async (req, res) => {
    try {
      const actor = await sdk.authenticateRequest(req);
      if (!actor.isCron || !actor.taskUid) return res.status(403).json({ message: "Cron session required" });
      const result = await runWatchdog();
      if (!result.ok) return res.status(500).json(result);
      return res.json({ ...result, taskUid: actor.taskUid });
    } catch (error) {
      return res.status(500).json({ ok: false, message: error instanceof Error ? error.message : "Watchdog failed" });
    }
  });
  app.post("/api/scheduled/walletMonitor", async (req, res) => {
    try {
      const actor = await sdk.authenticateRequest(req);
      if (!actor.isCron || !actor.taskUid) return res.status(403).json({ message: "Cron session required" });
      const connection = await getWalletConnectionByTaskUid(actor.taskUid);
      if (!connection || !connection.monitorEnabled) return res.json({ ok: true, status: "off" });
      const portfolio = await fetchReadOnlyWalletPortfolio({ network: connection.network, address: connection.publicAddress });
      await markWalletHeartbeat(connection.ownerId);
      await appendAuditEventToDb({ ownerId: connection.ownerId, eventType: "wallet_monitor_heartbeat", entityType: "public_wallet", payload: { taskUid: actor.taskUid, network: portfolio.network, address: portfolio.address, provider: portfolio.provider, scope: portfolio.scope, retrievedAt: portfolio.retrievedAt, mode: "read-only-paper-only" } });
      return res.json({ ok: true, status: "running", network: portfolio.network, retrievedAt: portfolio.retrievedAt, scope: portfolio.scope, warnings: portfolio.warnings });
    } catch (error) {
      return res.status(500).json({ ok: false, message: error instanceof Error ? error.message : "Wallet monitor failed" });
    }
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
