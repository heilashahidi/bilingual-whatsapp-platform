import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../services/database";

const router = Router();

// ─── GET /api/agents ────────────────────────────────────────
// List/search agents. Accepts ?q=<string> for fuzzy match across name,
// phone, and branch name (powers the New Ticket modal picker).
// Returns { agents: [...] } so the response shape matches the rest of
// the API.

router.get("/", async (req: Request, res: Response) => {
  const { country, limit = "50", offset = "0" } = req.query;
  // Accept both `q` (new modal) and `search` (older callers)
  const q = (req.query.q || req.query.search) as string | undefined;

  const where: Prisma.AgentWhereInput = {};
  if (country === "HT" || country === "DO" || country === "CD") {
    where.country = country;
  }
  if (q && q.trim()) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { phoneNumber: { contains: q } },
      { branch: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  const agents = await prisma.agent.findMany({
    where,
    include: {
      branch: true,
    },
    orderBy: { name: "asc" },
    take: parseInt(limit as string),
    skip: parseInt(offset as string),
  });

  res.json({ agents });
});

// ─── GET /api/agents/:id ───────────────────────────────────

router.get("/:id", async (req: Request, res: Response) => {
  const agent = await prisma.agent.findUnique({
    where: { id: req.params.id },
    include: {
      branch: true,
      tickets: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
      botConversations: {
        orderBy: { startedAt: "desc" },
        take: 10,
      },
    },
  });

  if (!agent) {
    return res.status(404).json({ error: "Agent not found" });
  }

  res.json(agent);
});

export { router as agentRouter };
