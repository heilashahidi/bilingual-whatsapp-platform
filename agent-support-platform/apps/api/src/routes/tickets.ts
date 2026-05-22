import { Router, Request, Response } from "express";
import { prisma } from "../services/database";
import { emitTicketEvent } from "../services/realtime";
import { indexResolvedTicket } from "../services/kb-indexer";
import { sendAgentResponse } from "../integrations/whatsapp";
import { requireRole } from "../middleware/auth";

const router = Router();

// ─── GET /api/tickets ───────────────────────────────────────
// List tickets with filters, sorted by severity then SLA deadline

router.get("/", async (req: Request, res: Response) => {
  const {
    status,
    severity,
    category,
    country,
    assignedTo,
    limit = "50",
    offset = "0",
  } = req.query;

  const where: any = { deletedAt: null };
  if (status) where.status = status;
  if (severity) where.severity = severity;
  if (category) where.category = category;
  if (assignedTo) where.assignedTo = assignedTo;
  if (country) where.agent = { country };

  const tickets = await prisma.ticket.findMany({
    where,
    include: {
      agent: { include: { branch: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
      incident: true,
    },
    orderBy: [
      { severity: "asc" }, // critical first
      { slaFirstResponseDeadline: "asc" }, // nearest SLA deadline first
    ],
    take: parseInt(limit as string),
    skip: parseInt(offset as string),
  });

  const total = await prisma.ticket.count({ where });

  res.json({ tickets, total });
});

// ─── GET /api/tickets/:id ───────────────────────────────────
// Full ticket detail with messages and suggested resolutions

router.get("/:id", async (req: Request, res: Response) => {
  const ticket = await prisma.ticket.findFirst({
    where: { id: req.params.id, deletedAt: null },
    include: {
      agent: { include: { branch: true } },
      messages: { orderBy: { createdAt: "asc" } },
      incident: true,
      suggestedResolutions: {
        include: { article: true },
        orderBy: { similarityScore: "desc" },
      },
      botConversation: true,
      notes: {
        include: { author: { select: { id: true, name: true, role: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  res.json(ticket);
});

// ─── POST /api/tickets/:id/messages ─────────────────────────
// Send a response from the US team to the agent

router.post("/:id/messages", async (req: Request, res: Response) => {
  const { text, senderId } = req.body;

  if (!text) {
    return res.status(400).json({ error: "text is required" });
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id: req.params.id },
    include: { agent: true },
  });

  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  try {
    // Translate and send via WhatsApp
    const { messageSid, translatedText } = await sendAgentResponse(
      ticket.agent.phoneNumber,
      text,
      ticket.agent.preferredLanguage,
      ticket.agent.country
    );

    // Store the outbound message
    const message = await prisma.message.create({
      data: {
        ticketId: ticket.id,
        direction: "outbound",
        senderType: "internal_user",
        senderId,
        originalText: text,
        originalLanguage: "en",
        translatedText,
        contentType: "text",
        whatsappMessageId: messageSid,
      },
    });

    // Update ticket status
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        status: "waiting_on_agent",
        slaFirstResponseMet: ticket.slaFirstResponseMet === null ? true : ticket.slaFirstResponseMet,
      },
    });

    emitTicketEvent("message", ticket.id);

    res.json({ message, translatedText });
  } catch (error) {
    console.error("Failed to send response:", error);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// ─── PATCH /api/tickets/:id ─────────────────────────────────
// Update ticket metadata (status, severity, category, assignment, etc.)

router.patch("/:id", async (req: Request, res: Response) => {
  const { status, severity, category, assignedTo, tags, incidentId } = req.body;

  const data: any = {};
  if (status) data.status = status;
  if (severity) data.severity = severity;
  if (category) data.category = category;
  if (assignedTo !== undefined) data.assignedTo = assignedTo;
  if (tags) data.tags = tags;
  if (incidentId !== undefined) data.incidentId = incidentId;

  if (status === "resolved") {
    data.resolvedAt = new Date();
  }

  const ticket = await prisma.ticket.update({
    where: { id: req.params.id },
    data,
    include: { agent: true },
  });

  emitTicketEvent("updated", ticket.id);

  res.json(ticket);
});

// ─── POST /api/tickets/:id/notes ────────────────────────────
// Add an internal team-only note. Never sent to the agent.

router.post("/:id/notes", async (req: Request, res: Response) => {
  const { text, authorId } = req.body;

  if (!text || typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "text is required" });
  }

  const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  const note = await prisma.note.create({
    data: {
      ticketId: req.params.id,
      authorId: authorId || null,
      text: text.trim(),
    },
    include: { author: { select: { id: true, name: true, role: true } } },
  });

  emitTicketEvent("updated", req.params.id);

  res.json(note);
});

// ─── POST /api/tickets/:id/resolve ──────────────────────────
// Resolve a ticket with a resolution summary (feeds knowledge base)

router.post("/:id/resolve", async (req: Request, res: Response) => {
  const { resolutionSummary } = req.body;

  const ticket = await prisma.ticket.update({
    where: { id: req.params.id },
    data: {
      status: "resolved",
      resolvedAt: new Date(),
      resolutionSummary: resolutionSummary || null,
    },
  });

  // Drafts a KnowledgeArticle from this resolved ticket so the team can
  // approve it for future suggestion. Async-fire-and-log so a slow KB
  // step doesn't block the response to the dashboard.
  if (resolutionSummary) {
    indexResolvedTicket(ticket.id).catch((err) =>
      console.error("  ✗ KB indexer failed:", err)
    );
  }

  emitTicketEvent("updated", ticket.id);

  res.json(ticket);
});

// ─── DELETE /api/tickets/:id (admin only) ───────────────────
// Soft delete — sets deletedAt + deletedBy. The row stays in the
// database for compliance/audit; queries filter it out by default.
// Hard delete is intentionally NOT exposed via the API.

router.delete("/:id", requireRole("admin"), async (req: Request, res: Response) => {
  const existing = await prisma.ticket.findFirst({
    where: { id: req.params.id, deletedAt: null },
  });
  if (!existing) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  const ticket = await prisma.ticket.update({
    where: { id: req.params.id },
    data: {
      deletedAt: new Date(),
      deletedBy: req.user?.userId || req.user?.email || null,
    },
  });

  emitTicketEvent("updated", ticket.id);

  res.json({ id: ticket.id, deletedAt: ticket.deletedAt });
});

export { router as ticketRouter };
