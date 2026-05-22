import { Router, Request, Response } from "express";
import { prisma } from "../services/database";

const router = Router();

// ─── GET /api/agents ────────────────────────────────────────

router.get("/", async (req: Request, res: Response) => {
  const { country, search, limit = "50", offset = "0" } = req.query;

  const where: any = {};
  if (country) where.country = country;
  if (search) {
    where.OR = [
      { name: { contains: search as string, mode: "insensitive" } },
      { phoneNumber: { contains: search as string } },
    ];
  }

  const agents = await prisma.agent.findMany({
    where,
    include: {
      branch: true,
      _count: { select: { tickets: true } },
    },
    orderBy: { name: "asc" },
    take: parseInt(limit as string),
    skip: parseInt(offset as string),
  });

  res.json(agents);
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
