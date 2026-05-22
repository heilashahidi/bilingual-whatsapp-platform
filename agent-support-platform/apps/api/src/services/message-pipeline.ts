import { RawMessage, EXTENDED_SLA_COUNTRIES, SLA_DEFAULTS } from "@asp/shared";
import { prisma } from "./database";
import { emitTicketEvent } from "./realtime";
import { findSuggestedResolutions } from "./kb-search";
import { notifyNewTicket } from "./notifier";
import { recordEvent } from "./audit";
import { clusterTicket } from "./incident-clusterer";
import { translateMessage } from "../integrations/translation";
import { classifyMessage } from "../integrations/classification";

/**
 * Process an inbound message through the full pipeline:
 *   dedup → find/create agent → translate → classify → create/append ticket → notify
 *
 * In production, each step would be a separate queue worker for independent
 * scaling and failure isolation. For Phase 1, we run them inline to get the
 * end-to-end loop working fast, then decompose into workers.
 */
export async function processInboundMessage(raw: RawMessage): Promise<void> {
  // ─── Step 1: Idempotency check ─────────────────────────────
  const existing = await prisma.message.findUnique({
    where: { whatsappMessageId: raw.externalId },
  });
  if (existing) {
    console.log(`  ↩ Duplicate message ${raw.externalId} — skipping`);
    return;
  }

  // ─── Step 2: Find or create the agent ───────────────────────
  let agent = await prisma.agent.findUnique({
    where: { phoneNumber: raw.agentPhone },
    include: { branch: true },
  });

  if (!agent) {
    // Auto-register unknown agents. In production, you'd validate against
    // an agent registry. For Phase 1, auto-create with defaults.
    const country = raw.metadata.countryCode as "HT" | "DO" | "CD";
    const defaultLanguage = country === "HT" ? "ht" : country === "DO" ? "es" : "fr";

    // Find or create a default branch for this country
    let branch = await prisma.branch.findFirst({ where: { country } });
    if (!branch) {
      branch = await prisma.branch.create({
        data: {
          name: `Default ${country} Branch`,
          country,
          region: "default",
        },
      });
    }

    agent = await prisma.agent.create({
      data: {
        phoneNumber: raw.agentPhone,
        name: raw.metadata.profileName || "Unknown Agent",
        country,
        preferredLanguage: defaultLanguage as any,
        branchId: branch.id,
      },
      include: { branch: true },
    });
    console.log(`  ✓ Auto-registered new agent: ${agent.name} (${agent.phoneNumber})`);
  }

  // Update agent last seen and connectivity status
  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      lastSeenAt: new Date(),
      connectivityStatus: "online",
    },
  });

  // ─── Step 3: Translate ──────────────────────────────────────
  let translatedText = raw.textBody;
  let detectedLanguage = agent.preferredLanguage;
  let translationConfidence: number | null = null;

  if (raw.textBody) {
    try {
      const translation = await translateMessage(raw.textBody, "en");
      translatedText = translation.translatedText;
      detectedLanguage = translation.detectedLanguage as any;
      translationConfidence = translation.confidence;
      console.log(`  ✓ Translated (${detectedLanguage} → en): "${translatedText?.substring(0, 80)}..."`);
    } catch (error) {
      console.error("  ✗ Translation failed — using original text:", error);
      translatedText = raw.textBody; // Fallback: show original
    }
  }

  // ─── Step 4: Classify ───────────────────────────────────────
  let classification = null;

  if (translatedText) {
    try {
      classification = await classifyMessage(translatedText);
      console.log(`  ✓ Classified: ${classification.category} / ${classification.severity} [${classification.tags.join(", ")}]`);
    } catch (error) {
      console.error("  ✗ Classification failed — defaulting to other/medium:", error);
      classification = {
        category: "other" as const,
        severity: "medium" as const,
        tags: [],
        productArea: "other" as const,
        confidence: 0,
        likelyNetwork: false,
      };
    }
  }

  // ─── Step 5: Find or create ticket ──────────────────────────
  // Look for an existing open ticket from this agent
  let ticket = await prisma.ticket.findFirst({
    where: {
      agentId: agent.id,
      status: { in: ["open", "in_progress", "waiting_on_agent"] },
    },
    orderBy: { createdAt: "desc" },
  });

  const shouldCreateNew =
    !ticket ||
    // If the existing ticket's category differs from the new message, create a new one
    (classification && ticket.category !== classification.category);

  if (shouldCreateNew) {
    // Compute SLA deadlines
    const slaProfile = EXTENDED_SLA_COUNTRIES.includes(agent.country)
      ? SLA_DEFAULTS.extended
      : SLA_DEFAULTS.standard;

    const severity = classification?.severity || "medium";
    const slaConfig = slaProfile[severity];
    const now = new Date();

    ticket = await prisma.ticket.create({
      data: {
        agentId: agent.id,
        status: "open",
        category: (classification?.category as any) || "other",
        severity: (classification?.severity as any) || "medium",
        productArea: classification?.productArea || null,
        tags: classification?.tags || [],
        agentReportedAt: new Date(raw.agentTimestamp),
        slaFirstResponseDeadline: new Date(now.getTime() + slaConfig.firstResponseMinutes * 60000),
        slaResolutionDeadline: new Date(now.getTime() + slaConfig.resolutionMinutes * 60000),
      },
    });
    console.log(`  ✓ Created ticket ${ticket.id} [${ticket.severity}/${ticket.category}]`);

    recordEvent({
      ticketId: ticket.id,
      action: "ticket_created",
      actor: null, // webhook origin, no signed-in user
      payload: {
        severity: ticket.severity,
        category: ticket.category,
        source: "whatsapp_inbound",
      },
    });
  } else {
    console.log(`  ✓ Appending to existing ticket ${ticket!.id}`);

    // If the agent replies after waiting, move back to in_progress
    if (ticket!.status === "waiting_on_agent") {
      await prisma.ticket.update({
        where: { id: ticket!.id },
        data: { status: "in_progress" },
      });
    }
  }

  // ─── Step 6: Store the message ──────────────────────────────
  const deliveryDelay = raw.agentTimestamp !== raw.serverReceivedAt
    ? Math.round((new Date(raw.serverReceivedAt).getTime() - new Date(raw.agentTimestamp).getTime()) / 1000)
    : 0;

  const message = await prisma.message.create({
    data: {
      ticketId: ticket!.id,
      direction: "inbound",
      senderType: "agent",
      senderId: agent.id,
      originalText: raw.textBody,
      originalLanguage: detectedLanguage as any,
      translatedText,
      translationConfidence,
      contentType: raw.contentType as any,
      mediaUrls: raw.mediaUrl ? [raw.mediaUrl] : [],
      classification: classification as any,
      whatsappMessageId: raw.externalId,
      agentTimestamp: new Date(raw.agentTimestamp),
      serverReceivedAt: new Date(raw.serverReceivedAt),
      deliveryDelay,
    },
  });

  console.log(`  ✓ Stored message ${message.id} (delivery delay: ${deliveryDelay}s)`);

  // ─── Step 7: Pin KB suggestions for new tickets ───────────
  // Only on new tickets — appending a message to an existing one
  // shouldn't reshuffle existing suggestions.
  if (shouldCreateNew && classification) {
    try {
      await findSuggestedResolutions(ticket!.id, classification);
    } catch (error) {
      console.error("  ✗ KB suggestion lookup failed:", error);
    }
  }

  // ─── Step 8: Slack notify for critical/high ────────────────
  // Fire-and-forget so a slow Slack response doesn't block.
  if (shouldCreateNew) {
    notifyNewTicket({
      ticketId: ticket!.id,
      severity: ticket!.severity,
      category: ticket!.category,
      productArea: ticket!.productArea,
      tags: ticket!.tags,
      agentName: agent.name,
      agentPhone: agent.phoneNumber,
      agentCountry: agent.country,
      branchName: agent.branch.name,
      messageSnippet: translatedText || raw.textBody || "",
    }).catch((err) => console.error("  ✗ notifier failed:", err));
  }

  // ─── Step 9: Realtime broadcast ────────────────────────────
  emitTicketEvent(shouldCreateNew ? "created" : "message", ticket!.id);

  // ─── Step 10: Incident clustering ──────────────────────────
  // Only on new tickets — appended messages on an already-clustered ticket
  // don't change anything cluster-wise. Fire-and-forget so a slow cluster
  // check never blocks the pipeline; the dashboard will pick up the
  // resulting incident via the realtime event the clusterer emits.
  if (shouldCreateNew) {
    clusterTicket(ticket!.id).catch((err) =>
      console.error("  ✗ incident clustering failed:", err)
    );
  }

  console.log("─── Pipeline complete ───\n");
}
