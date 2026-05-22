import http from "node:http";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { webhookRouter } from "./routes/webhooks";
import { ticketRouter } from "./routes/tickets";
import { agentRouter } from "./routes/agents";
import { userRouter } from "./routes/users";
import { prisma } from "./services/database";
import { initRealtime } from "./services/realtime";

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

app.use("/webhooks", webhookRouter);
app.use("/api/tickets", ticketRouter);
app.use("/api/agents", agentRouter);
app.use("/api/users", userRouter);

// ─── Start ──────────────────────────────────────────────────

const httpServer = http.createServer(app);
initRealtime(httpServer);

httpServer.listen(PORT, () => {
  console.log(`✓ API server running on http://localhost:${PORT}`);
  console.log(`✓ Socket.IO ready on ws://localhost:${PORT}`);
  console.log(`✓ Twilio webhook URL: http://localhost:${PORT}/webhooks/whatsapp`);
  console.log(`  → Use ngrok to expose this for Twilio: ngrok http ${PORT}`);
});

export default app;
