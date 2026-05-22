import { Router, Request, Response } from "express";
import { EXTENDED_SLA_COUNTRIES, SLA_DEFAULTS } from "@asp/shared";
import { prisma } from "../services/database";
import { emitTicketEvent } from "../services/realtime";
import { indexResolvedTicket } from "../services/kb-indexer";
import { recordEvent } from "../services/audit";
import { notifyMention } from "../services/notifier";
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
      incident: {
        select: {
          id: true,
          title: true,
          status: true,
          severity: true,
          _count: { select: { tickets: true } },
        },
      },
    },
    orderBy: [
      { severity: "asc" }, // critical first
      { slaFirstResponseDeadline: "asc" }, // nearest SLA deadline first
    ],
    take: parseInt(limit as string),
    skip: parseInt(offset as string),
  });

  // Flatten incident._count.tickets → incident.ticketCount so the
  // dashboard doesn't have to reach into Prisma's nested count shape.
  const mapped = tickets.map((t) => {
    if (!t.incident) return t;
    const { _count, ...rest } = t.incident as typeof t.incident & {
      _count?: { tickets?: number };
    };
    return {
      ...t,
      incident: {
        ...rest,
        ticketCount: _count?.tickets ?? 0,
      },
    };
  });

  const total = await prisma.ticket.count({ where });

  res.json({ tickets: mapped, total });
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
      events: {
        orderBy: { createdAt: "desc" },
        take: 50,
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

  // Resolve the target language from the most recent inbound message
  // rather than the agent's registration-time preferredLanguage. If the
  // agent wrote this conversation in French (even though they registered
  // as a Creole speaker), the reply tracks them. Falls back to
  // preferredLanguage if no inbound message exists yet.
  const lastInbound = await prisma.message.findFirst({
    where: { ticketId: ticket.id, direction: "inbound" },
    orderBy: { createdAt: "desc" },
    select: { originalLanguage: true },
  });
  const targetLanguage =
    lastInbound?.originalLanguage || ticket.agent.preferredLanguage;

  try {
    // Translate (if needed) and send via WhatsApp. sendAgentResponse
    // short-circuits translation when targetLanguage === "en".
    const { messageSid, translatedText } = await sendAgentResponse(
      ticket.agent.phoneNumber,
      text,
      targetLanguage,
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

    recordEvent({
      ticketId: ticket.id,
      action: "message_sent",
      actor: req.user,
      payload: { translatedTo: targetLanguage },
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

  // Read before-state so the audit log can record what changed.
  const before = await prisma.ticket.findUnique({
    where: { id: req.params.id },
    select: { status: true, severity: true, category: true, assignedTo: true, tags: true },
  });
  if (!before) return res.status(404).json({ error: "Ticket not found" });

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

  // Record one audit row per dimension that actually changed.
  if (status && status !== before.status) {
    recordEvent({
      ticketId: ticket.id,
      action: "status_changed",
      actor: req.user,
      payload: { from: before.status, to: status },
    });
  }
  if (severity && severity !== before.severity) {
    recordEvent({
      ticketId: ticket.id,
      action: "severity_changed",
      actor: req.user,
      payload: { from: before.severity, to: severity },
    });
  }
  if (category && category !== before.category) {
    recordEvent({
      ticketId: ticket.id,
      action: "category_changed",
      actor: req.user,
      payload: { from: before.category, to: category },
    });
  }
  if (assignedTo !== undefined && assignedTo !== before.assignedTo) {
    recordEvent({
      ticketId: ticket.id,
      action: assignedTo ? "assigned" : "unassigned",
      actor: req.user,
      payload: { from: before.assignedTo, to: assignedTo },
    });
  }
  if (tags && JSON.stringify(tags) !== JSON.stringify(before.tags)) {
    recordEvent({
      ticketId: ticket.id,
      action: "tagged",
      actor: req.user,
      payload: { from: before.tags, to: tags },
    });
  }

  emitTicketEvent("updated", ticket.id);

  res.json(ticket);
});

// ─── POST /api/tickets/:id/notes ────────────────────────────
// Add an internal team-only note. Never sent to the agent.

router.post("/:id/notes", async (req: Request, res: Response) => {
  const { text, authorId, mentions } = req.body;

  if (!text || typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "text is required" });
  }

  // Normalize mentions: must be an array of strings (InternalUser IDs).
  // We don't trust the client's list — verify each ID actually exists.
  const requestedMentions = Array.isArray(mentions)
    ? mentions.filter((m): m is string => typeof m === "string")
    : [];

  const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  const validMentions = requestedMentions.length
    ? (
        await prisma.internalUser.findMany({
          where: { id: { in: requestedMentions } },
          select: { id: true },
        })
      ).map((u) => u.id)
    : [];

  const note = await prisma.note.create({
    data: {
      ticketId: req.params.id,
      authorId: authorId || null,
      text: text.trim(),
      mentions: validMentions,
    },
    include: { author: { select: { id: true, name: true, role: true } } },
  });

  recordEvent({
    ticketId: req.params.id,
    action: "note_added",
    actor: req.user,
    payload: {
      noteId: note.id,
      snippet: text.trim().slice(0, 80),
      mentionCount: validMentions.length,
    },
  });

  // Fire-and-forget Slack ping for each mentioned teammate
  if (validMentions.length) {
    notifyMention({
      ticketId: req.params.id,
      noteId: note.id,
      authorEmail: req.user?.email ?? null,
      authorName: req.user?.name ?? null,
      mentionedUserIds: validMentions,
      snippet: text.trim(),
    }).catch((err) => console.error("  ✗ mention notification failed:", err));
  }

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

  recordEvent({
    ticketId: ticket.id,
    action: "resolved",
    actor: req.user,
    payload: resolutionSummary
      ? { hasSummary: true, summarySnippet: String(resolutionSummary).slice(0, 80) }
      : { hasSummary: false },
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

// ─── POST /api/tickets/outreach ─────────────────────────────
// Support-team-initiated thread. Translates the message into the
// agent's preferred language, sends it via Twilio, then creates the
// Ticket with the outbound message attached as the first message.

router.post("/outreach", async (req: Request, res: Response) => {
  const { agentId, message, severity, category, tags } = req.body as {
    agentId?: string;
    message?: string;
    severity?: "critical" | "high" | "medium" | "low";
    category?: "bug_report" | "operational_complaint" | "feature_request" | "question" | "other";
    tags?: string[];
  };

  if (!agentId || !message?.trim() || !severity || !category) {
    return res.status(400).json({
      error: "agentId, message, severity, and category are required",
    });
  }

  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    include: { branch: true },
  });
  if (!agent) {
    return res.status(404).json({ error: "Agent not found" });
  }

  try {
    // Translate + send WhatsApp (same pipeline used for replies).
    const { messageSid, translatedText } = await sendAgentResponse(
      agent.phoneNumber,
      message.trim(),
      agent.preferredLanguage,
      agent.country
    );

    // SLA: same computation as the inbound pipeline.
    const slaProfile = EXTENDED_SLA_COUNTRIES.includes(agent.country)
      ? SLA_DEFAULTS.extended
      : SLA_DEFAULTS.standard;
    const slaConfig = slaProfile[severity];
    const now = new Date();

    // Create ticket + first message in a single transaction so a partial
    // failure (e.g., DB hiccup after Twilio already sent) doesn't orphan
    // the WhatsApp message.
    const ticket = await prisma.ticket.create({
      data: {
        agentId: agent.id,
        status: "waiting_on_agent", // We've messaged them; awaiting reply.
        category,
        severity,
        tags: tags || [],
        agentReportedAt: now,
        slaFirstResponseDeadline: new Date(
          now.getTime() + slaConfig.firstResponseMinutes * 60000
        ),
        slaResolutionDeadline: new Date(
          now.getTime() + slaConfig.resolutionMinutes * 60000
        ),
        // Caller initiated — they've "responded" as the opening act.
        slaFirstResponseMet: true,
        messages: {
          create: [
            {
              direction: "outbound",
              senderType: "internal_user",
              senderId: req.user?.userId || null,
              originalText: message.trim(),
              originalLanguage: "en",
              translatedText,
              contentType: "text",
              whatsappMessageId: messageSid,
            },
          ],
        },
      },
      include: {
        agent: { include: { branch: true } },
        messages: { orderBy: { createdAt: "asc" } },
        incident: true,
      },
    });

    recordEvent({
      ticketId: ticket.id,
      action: "ticket_created",
      actor: req.user,
      payload: { source: "outreach", severity, category },
    });

    emitTicketEvent("created", ticket.id);

    res.json(ticket);
  } catch (error) {
    console.error("Failed to create outreach ticket:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to create outreach ticket",
    });
  }
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

  recordEvent({
    ticketId: ticket.id,
    action: "deleted",
    actor: req.user,
  });

  emitTicketEvent("updated", ticket.id);

  res.json({ id: ticket.id, deletedAt: ticket.deletedAt });
});

export { router as ticketRouter };
