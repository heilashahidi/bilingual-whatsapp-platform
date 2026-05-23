import { RawMessage, EXTENDED_SLA_COUNTRIES, SLA_DEFAULTS } from "@asp/shared";
import { prisma } from "./database";
import { emitTicketEvent } from "./realtime";
import { findSuggestedResolutions } from "./kb-search";
import { notifyNewTicket } from "./notifier";
import { recordEvent } from "./audit";
import { clusterTicket } from "./incident-clusterer";
import { translateMessage } from "../integrations/translation";
import { classifyMessage } from "../integrations/classification";
import { sendAgentResponse } from "../integrations/whatsapp";
import { isLikelyEnglish } from "./language-detection";
import { buildIntakePrompt } from "./intake-prompter";

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

  // ─── Steps 3 & 4: Translate + Classify (parallel) ──────────
  //
  // Previously sequential: translate → English, then classify the
  // translated text. With Haiku that's two ~700 ms hops back-to-back.
  // Haiku is multilingual though, so we can classify the ORIGINAL
  // text (whatever language it's in) in parallel with translating it
  // — halving the wall-clock time per inbound message.
  //
  // Tradeoff: classifier accuracy on non-English source text is
  // slightly worse than on English. Mitigation below — if Claude
  // returns confidence < 0.7 on the original-language pass, we
  // re-classify on the translated English text. The re-classify only
  // fires on ambiguous messages, so the average case keeps the
  // parallel speedup while edge cases get the full accuracy.
  //
  // English-detected messages skip both translation AND parallelism
  // and just classify the original text directly.

  let translatedText = raw.textBody;
  let detectedLanguage = agent.preferredLanguage;
  let translationConfidence: number | null = null;
  let classification = null;

  const CLASSIFICATION_FALLBACK = {
    category: "other" as const,
    severity: "medium" as const,
    tags: [] as string[],
    productArea: "other" as const,
    confidence: 0,
    likelyNetwork: false,
  };

  if (raw.textBody) {
    if (isLikelyEnglish(raw.textBody)) {
      // Short-circuit: source is English → no translation needed,
      // classify the original text directly.
      translatedText = raw.textBody;
      detectedLanguage = "en" as any;
      translationConfidence = 1.0;
      console.log(`  ✓ Skipped translation (en → en, heuristic)`);

      try {
        classification = await classifyMessage(raw.textBody);
        console.log(`  ✓ Classified: ${classification.category} / ${classification.severity} [${classification.tags.join(", ")}]`);
      } catch (error) {
        console.error("  ✗ Classification failed — defaulting to other/medium:", error);
        classification = CLASSIFICATION_FALLBACK;
      }
    } else {
      // Parallel path: kick off translate + classify simultaneously
      // against the ORIGINAL-language text.
      const [translationResult, classifyResult] = await Promise.allSettled([
        translateMessage(raw.textBody, "en"),
        classifyMessage(raw.textBody),
      ]);

      if (translationResult.status === "fulfilled") {
        translatedText = translationResult.value.translatedText;
        detectedLanguage = translationResult.value.detectedLanguage as any;
        translationConfidence = translationResult.value.confidence;
        console.log(`  ✓ Translated (${detectedLanguage} → en): "${translatedText?.substring(0, 80)}..."`);
      } else {
        console.error("  ✗ Translation failed — using original text:", translationResult.reason);
        translatedText = raw.textBody;
      }

      if (classifyResult.status === "fulfilled") {
        classification = classifyResult.value;
        console.log(`  ✓ Classified: ${classification.category} / ${classification.severity} [${classification.tags.join(", ")}] (conf ${classification.confidence})`);
      } else {
        console.error("  ✗ Classification failed — defaulting to other/medium:", classifyResult.reason);
        classification = CLASSIFICATION_FALLBACK;
      }

      // Low-confidence rescue: if classification on the original-
      // language text wasn't confident AND translation succeeded,
      // re-classify on the translated English text. Only fires on
      // ambiguous inputs — typical case keeps the parallel speedup.
      if (
        classification &&
        classification.confidence < 0.7 &&
        translationResult.status === "fulfilled" &&
        translatedText !== raw.textBody
      ) {
        console.log(`  ↻ Low-confidence (${classification.confidence}) — re-classifying on translated text…`);
        try {
          const reclassified = await classifyMessage(translatedText);
          if (reclassified.confidence > classification.confidence) {
            classification = reclassified;
            console.log(`  ✓ Re-classified: ${classification.category} / ${classification.severity} (conf ${classification.confidence})`);
          }
        } catch (error) {
          console.error("  ✗ Re-classification failed (keeping original):", error);
        }
      }
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

  // ─── Step 8b: Auto-intake message ──────────────────────────
  // For new tickets in actionable categories, send a category-aware
  // intake checklist to the agent (transaction ID, app version,
  // terminal ID, etc.). Saves the US team a round-trip — by the
  // time an operator opens the ticket, the agent has often replied
  // with the info already.
  //
  // Fire-and-forget. The send goes through sendAgentResponse so it
  // gets translated into the agent's language (or skipped if the
  // conversation is in English). The resulting outbound row is
  // persisted to the conversation timeline like any operator reply.
  if (shouldCreateNew && classification) {
    const intake = buildIntakePrompt({
      category: ticket!.category,
      severity: ticket!.severity,
      productArea: ticket!.productArea,
      tags: ticket!.tags,
    });
    if (intake) {
      (async () => {
        try {
          // Target language follows the inbound — agent gets the intake
          // in whatever language they wrote in.
          const target = (detectedLanguage as string) || agent.preferredLanguage;
          const { messageSid, translatedText: sentText } =
            await sendAgentResponse(
              agent.phoneNumber,
              intake,
              target,
              agent.country
            );
          await prisma.message.create({
            data: {
              ticketId: ticket!.id,
              direction: "outbound",
              senderType: "system",
              senderId: null,
              originalText: intake,
              originalLanguage: "en",
              translatedText: sentText,
              contentType: "text",
              whatsappMessageId: messageSid,
            },
          });
          console.log(`  🤖 Sent auto-intake to ${agent.phoneNumber}`);
        } catch (err) {
          console.error("  ✗ Auto-intake send failed:", err);
        }
      })();
    }
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
