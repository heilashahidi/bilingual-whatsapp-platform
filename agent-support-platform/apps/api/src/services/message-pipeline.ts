import { Language, Prisma } from "@prisma/client";
import { RawMessage, EXTENDED_SLA_COUNTRIES, SLA_DEFAULTS } from "@asp/shared";
import { prisma } from "./database";

// Narrow an arbitrary string (e.g. translator output) into a Prisma
// Language enum, falling back to the agent's preferredLanguage when the
// translator returns an unsupported code.
const SUPPORTED_LANGUAGES = new Set<Language>(Object.values(Language));
function toLanguage(value: string | null | undefined, fallback: Language): Language {
  return value && SUPPORTED_LANGUAGES.has(value as Language)
    ? (value as Language)
    : fallback;
}
import { emitTicketEvent } from "./realtime";
import { findSuggestedResolutions } from "./kb-search";
import { notifyNewTicket } from "./notifier";
import { recordEvent } from "./audit";
import { clusterTicket } from "./incident-clusterer";
import { translateMessage } from "../integrations/translation";
import { classifyMessage } from "../integrations/classification";
import { isLikelyEnglish } from "./language-detection";
import { buildIntakePrompt } from "./intake-prompter";
import { enqueueOutbound } from "./outbound-queue";

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
        preferredLanguage: defaultLanguage,
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

  // ─── Step 3: Find or create ticket FIRST (before translation) ─
  //
  // Reordered from "translate → classify → ticket → message → emit".
  // For field agents on slow mobile networks we want the support
  // dashboard to surface the inbound as fast as possible — every
  // ~500ms shaved here is ~500ms sooner an operator can start typing
  // a reply, which directly shortens the round-trip the agent feels.
  //
  // New order: open-ticket lookup → create-or-attach with placeholder
  // category → store message with raw text → emit "message" → THEN
  // translate + classify async and emit a follow-up "updated" event
  // so the dashboard refetches with the enriched data.
  //
  // Side effect: a brand-new ticket appears in the dashboard as
  // category=other/severity=medium for ~500ms before settling to the
  // classified values. The dashboard already refetches on
  // ticket:changed, so it converges naturally. We deliberately can't
  // emit until the ticket exists, because the existing socket event
  // shape carries a ticketId and the dashboard expects it to resolve.
  let ticket = await prisma.ticket.findFirst({
    where: {
      agentId: agent.id,
      status: { in: ["open", "in_progress", "waiting_on_agent"] },
    },
    orderBy: { createdAt: "desc" },
  });

  // We don't yet know the classification; defer the "split tickets on
  // category change" decision until after we classify (below). For
  // now: if no open ticket exists, create a placeholder.
  let createdNewTicket = false;
  if (!ticket) {
    const slaProfile = EXTENDED_SLA_COUNTRIES.includes(agent.country)
      ? SLA_DEFAULTS.extended
      : SLA_DEFAULTS.standard;
    const slaConfig = slaProfile.medium;
    const now = new Date();

    ticket = await prisma.ticket.create({
      data: {
        agentId: agent.id,
        status: "open",
        category: "other",
        severity: "medium",
        tags: [],
        agentReportedAt: new Date(raw.agentTimestamp),
        slaFirstResponseDeadline: new Date(now.getTime() + slaConfig.firstResponseMinutes * 60000),
        slaResolutionDeadline: new Date(now.getTime() + slaConfig.resolutionMinutes * 60000),
      },
    });
    createdNewTicket = true;
    console.log(`  ✓ Created placeholder ticket ${ticket.id} (classification pending)`);
  } else if (ticket.status === "waiting_on_agent") {
    // Agent replied after waiting — move back to in_progress
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: "in_progress" },
    });
  }

  // ─── Step 4: Store the message with raw text ─────────────────
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
      originalLanguage: agent.preferredLanguage,
      translatedText: raw.textBody, // raw initially; patched after translation
      translationConfidence: null,
      contentType: raw.contentType,
      mediaUrls: raw.mediaUrl ? [raw.mediaUrl] : [],
      classification: undefined,
      whatsappMessageId: raw.externalId,
      agentTimestamp: new Date(raw.agentTimestamp),
      serverReceivedAt: new Date(raw.serverReceivedAt),
      deliveryDelay,
    },
  });

  console.log(`  ✓ Stored raw message ${message.id} (delivery delay: ${deliveryDelay}s)`);

  // ─── Step 5: EARLY EMIT — dashboard wakes up immediately ─────
  // Fires before translation/classification so support staff see the
  // new message ~500ms sooner.
  emitTicketEvent(createdNewTicket ? "created" : "message", ticket!.id);

  // ─── Steps 6 & 7: Translate + Classify (parallel) ────────────
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
      detectedLanguage = "en";
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
        detectedLanguage = toLanguage(
          translationResult.value.detectedLanguage,
          agent.preferredLanguage
        );
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

  // ─── Step 7b: Patch the message with translation + classification ──
  await prisma.message.update({
    where: { id: message.id },
    data: {
      originalLanguage: detectedLanguage,
      translatedText,
      translationConfidence,
      // Prisma's InputJsonValue requires an index signature; our
      // ClassificationResult is a closed shape but is JSON-safe. The cast
      // here is type-only — see Prisma docs on typed JSON fields.
      classification: classification
        ? (classification as object as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    },
  });

  // ─── Step 7c: Reconcile ticket category/severity ────────────
  // If we created a placeholder ticket, replace its category/severity
  // with the now-known classification. If we appended to an existing
  // ticket but the new message's category differs, split into a new
  // ticket (matching prior behavior).
  let shouldCreateNew = false;
  if (classification && createdNewTicket) {
    const slaProfile = EXTENDED_SLA_COUNTRIES.includes(agent.country)
      ? SLA_DEFAULTS.extended
      : SLA_DEFAULTS.standard;
    const slaConfig = slaProfile[classification.severity as "critical" | "high" | "medium" | "low"];
    const now = new Date();
    ticket = await prisma.ticket.update({
      where: { id: ticket!.id },
      data: {
        category: classification.category,
        severity: classification.severity,
        productArea: classification.productArea || null,
        tags: classification.tags || [],
        slaFirstResponseDeadline: new Date(now.getTime() + slaConfig.firstResponseMinutes * 60000),
        slaResolutionDeadline: new Date(now.getTime() + slaConfig.resolutionMinutes * 60000),
      },
    });
    recordEvent({
      ticketId: ticket.id,
      action: "ticket_created",
      actor: null,
      payload: {
        severity: ticket.severity,
        category: ticket.category,
        source: "whatsapp_inbound",
      },
    });
    shouldCreateNew = true;
  } else if (classification && !createdNewTicket && ticket!.category !== classification.category) {
    // Existing ticket but the new message is a different category — split.
    const slaProfile = EXTENDED_SLA_COUNTRIES.includes(agent.country)
      ? SLA_DEFAULTS.extended
      : SLA_DEFAULTS.standard;
    const slaConfig = slaProfile[classification.severity as "critical" | "high" | "medium" | "low"];
    const now = new Date();
    const newTicket = await prisma.ticket.create({
      data: {
        agentId: agent.id,
        status: "open",
        category: classification.category,
        severity: classification.severity,
        productArea: classification.productArea || null,
        tags: classification.tags || [],
        agentReportedAt: new Date(raw.agentTimestamp),
        slaFirstResponseDeadline: new Date(now.getTime() + slaConfig.firstResponseMinutes * 60000),
        slaResolutionDeadline: new Date(now.getTime() + slaConfig.resolutionMinutes * 60000),
      },
    });
    // Move the message we just stored onto the new ticket.
    await prisma.message.update({
      where: { id: message.id },
      data: { ticketId: newTicket.id },
    });
    recordEvent({
      ticketId: newTicket.id,
      action: "ticket_created",
      actor: null,
      payload: {
        severity: newTicket.severity,
        category: newTicket.category,
        source: "whatsapp_inbound",
      },
    });
    // The early emit fired against the original ticket id; emit
    // created against the new ticket so the dashboard picks it up.
    emitTicketEvent("created", newTicket.id);
    ticket = newTicket;
    shouldCreateNew = true;
  }

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
  // Fire-and-forget. The send goes through the outbound queue so it
  // gets translated into the agent's language (or skipped if the
  // conversation is in English), retries on transient Twilio failure,
  // and persists as a pending → sent message row visible in the
  // dashboard timeline like any operator reply.
  if (shouldCreateNew && classification) {
    const intake = buildIntakePrompt({
      category: ticket!.category,
      severity: ticket!.severity,
      productArea: ticket!.productArea,
      tags: ticket!.tags,
    });
    if (intake) {
      // Target language follows the inbound — agent gets the intake
      // in whatever language they wrote in. Goes through the outbound
      // queue so it picks up the same retry/backoff and surfaces in
      // the dashboard as a pending message immediately.
      const target = (detectedLanguage as string) || agent.preferredLanguage;
      (async () => {
        try {
          const intakeMsg = await prisma.message.create({
            data: {
              ticketId: ticket!.id,
              direction: "outbound",
              senderType: "system",
              senderId: null,
              originalText: intake,
              originalLanguage: "en",
              translatedText: intake,
              contentType: "text",
              deliveryStatus: "pending",
            },
          });
          await enqueueOutbound({
            messageId: intakeMsg.id,
            ticketId: ticket!.id,
            agentPhone: agent.phoneNumber,
            agentCountry: agent.country,
            englishText: intake,
            targetLanguage: target,
          });
          console.log(`  🤖 Queued auto-intake to ${agent.phoneNumber}`);
        } catch (err) {
          console.error("  ✗ Auto-intake queue failed:", err);
        }
      })();
    }
  }

  // ─── Step 9: Realtime broadcast (enriched) ─────────────────
  // We already emitted at Step 5 to wake the dashboard; this second
  // emit signals translation+classification are done, so the
  // dashboard refetches and renders the enriched view.
  emitTicketEvent("updated", ticket!.id);

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
