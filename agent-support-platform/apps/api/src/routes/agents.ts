import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../services/database";
import { recordEvent } from "../services/audit";
import { requireRole } from "../middleware/auth";

const router = Router();

// SECURITY.md §5.1 — verification states.
//   verified   — verifiedAt set, rejectedAt null. Trusted, normal flow.
//   pending    — verifiedAt null, rejectedAt null. Auto-created from an
//                unknown inbound number, awaiting admin promotion.
//   rejected   — rejectedAt set. Confirmed scammer/spammer. Stays
//                quarantined; future messages remain isolated.
type VerificationFilter = "verified" | "pending" | "rejected" | "all";

function parseVerification(raw: unknown): VerificationFilter {
  if (raw === "pending" || raw === "rejected" || raw === "all") return raw;
  return "verified"; // default — list view shows trusted agents only
}

function verificationWhere(v: VerificationFilter): Prisma.AgentWhereInput {
  switch (v) {
    case "verified":
      return { verifiedAt: { not: null }, rejectedAt: null };
    case "pending":
      return { verifiedAt: null, rejectedAt: null };
    case "rejected":
      return { rejectedAt: { not: null } };
    case "all":
      return {};
  }
}

// List/search agents. `q` fuzzy-matches across name, phone, and branch name.
// `verification` filters by trust state (default: verified only).
router.get("/", async (req: Request, res: Response) => {
  const { country, limit = "50", offset = "0" } = req.query;
  const q = (req.query.q || req.query.search) as string | undefined;
  const verification = parseVerification(req.query.verification);

  const where: Prisma.AgentWhereInput = { ...verificationWhere(verification) };
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

// Promote a quarantined agent into the normal flow (SECURITY.md §5.1).
// Restricted to admin/operations — support agents see quarantine traffic
// but cannot bless a new number on their own. Existing tickets the agent
// already has get an `agent_verified` audit event so the activity
// timeline reflects the change.
router.post(
  "/:id/verify",
  requireRole("admin", "operations"),
  async (req: Request, res: Response) => {
    const agent = await prisma.agent.findUnique({
      where: { id: req.params.id },
      select: { id: true, tickets: { select: { id: true } } },
    });
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const updated = await prisma.agent.update({
      where: { id: req.params.id },
      data: { verifiedAt: new Date(), rejectedAt: null },
    });

    for (const t of agent.tickets) {
      recordEvent({
        ticketId: t.id,
        action: "agent_verified",
        actor: req.user || null,
        payload: { agentId: updated.id },
      });
    }

    res.json({ agent: updated });
  }
);

// Mark an agent as a confirmed scammer/spammer. Admin-only — this is a
// stronger statement than "we don't know who this is" and the audit
// trail should make that clear. We don't hard-delete the row because
// foreign keys from Message.senderId and Ticket.agentId would break;
// the rejected flag is what the inbound pipeline checks.
router.post(
  "/:id/reject",
  requireRole("admin"),
  async (req: Request, res: Response) => {
    const agent = await prisma.agent.findUnique({
      where: { id: req.params.id },
      select: { id: true, tickets: { select: { id: true } } },
    });
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const updated = await prisma.agent.update({
      where: { id: req.params.id },
      data: { rejectedAt: new Date(), verifiedAt: null },
    });

    for (const t of agent.tickets) {
      recordEvent({
        ticketId: t.id,
        action: "agent_rejected",
        actor: req.user || null,
        payload: { agentId: updated.id },
      });
    }

    res.json({ agent: updated });
  }
);

export { router as agentRouter };
