import http from "node:http";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { webhookRouter } from "./routes/webhooks";
import { ticketRouter } from "./routes/tickets";
import { agentRouter } from "./routes/agents";
import { userRouter } from "./routes/users";
import { knowledgeRouter } from "./routes/knowledge";
import { incidentRouter } from "./routes/incidents";
import { prisma } from "./services/database";
import { initRealtime } from "./services/realtime";
import { startInboundWorker, stopInboundWorker } from "./services/queue-worker";
import { closeQueue } from "./services/queue";
import { requireAuth } from "./middleware/auth";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ──────────────────────────────────────────────

// Twilio sends form-encoded data, so we need both parsers
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Health check ───────────────────────────────────────────

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ status: "error", message: "Database unreachable" });
  }
});

// ─── Routes ─────────────────────────────────────────────────

// Webhooks stay open — they use Twilio signature validation instead of JWT.
app.use("/webhooks", webhookRouter);

// All /api/* routes require a valid NextAuth-issued Bearer token.
// /api/users is the one exception: NextAuth's signIn callback needs to
// look up emails on the InternalUser table BEFORE a session exists,
// so we keep it accessible. It returns only id/name/email/role — no PII.
app.use("/api/users", userRouter);
app.use("/api/tickets", requireAuth, ticketRouter);
app.use("/api/agents", requireAuth, agentRouter);
app.use("/api/knowledge", requireAuth, knowledgeRouter);
app.use("/api/incidents", requireAuth, incidentRouter);

// ─── Start ──────────────────────────────────────────────────

const httpServer = http.createServer(app);
initRealtime(httpServer);

// Start the BullMQ worker that drains the inbound-whatsapp queue.
// No-op when REDIS_URL isn't set (the queue helper falls back to
// inline processing in that case).
startInboundWorker();

httpServer.listen(PORT, () => {
  console.log(`✓ API server running on http://localhost:${PORT}`);
  console.log(`✓ Socket.IO ready on ws://localhost:${PORT}`);
  console.log(`✓ Twilio webhook URL: http://localhost:${PORT}/webhooks/whatsapp`);
  console.log(`  → Use ngrok to expose this for Twilio: ngrok http ${PORT}`);
});

// Graceful shutdown: let the worker finish in-flight jobs before the
// process exits, otherwise those jobs sit in "active" until BullMQ's
// stalled-job recovery picks them up ~30s later. Railway sends SIGTERM
// on deploy; we have ~5–10s to clean up before SIGKILL.
async function shutdown(signal: NodeJS.Signals) {
  console.log(`\n${signal} received — shutting down…`);
  try {
    await stopInboundWorker();
    await closeQueue();
    await prisma.$disconnect();
  } catch (err) {
    console.error("Error during shutdown:", err);
  } finally {
    httpServer.close(() => process.exit(0));
    // Hard exit if httpServer.close takes too long.
    setTimeout(() => process.exit(0), 5_000).unref();
  }
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
