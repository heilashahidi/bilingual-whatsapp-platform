import { BOT_MAX_MESSAGE_LENGTH } from "@asp/shared";
import { prisma } from "./database";
import { emitTicketEvent } from "./realtime";
import { sendWhatsAppMessage } from "../integrations/whatsapp";
import { translateResponse } from "../integrations/translation";
import type { OutboundJob } from "./outbound-types";

/**
 * Translate (if needed), enforce per-country length, and send via
 * Twilio. Patches the pre-created Message row with the resulting
 * SID + translated text. On terminal failure (after BullMQ retries
 * exhaust) the worker calls markOutboundFailed.
 */
export async function processOutboundMessage(job: OutboundJob): Promise<void> {
  let translatedText = job.englishText;

  if (job.targetLanguage && job.targetLanguage !== "en") {
    const translation = await translateResponse(job.englishText, job.targetLanguage);
    translatedText = translation.translatedText;
  }

  // Per-country length cap for low-bandwidth markets (Haiti/DRC
  // truncate aggressively). Caller doesn't enforce; this is the last
  // point before the wire.
  const maxLength = BOT_MAX_MESSAGE_LENGTH[job.agentCountry] || 2000;
  if (translatedText.length > maxLength) {
    translatedText =
      translatedText.substring(0, maxLength - 50) + "\n\n[Reply MORE for the rest]";
  }

  const messageSid = await sendWhatsAppMessage(job.agentPhone, translatedText);

  await prisma.message.update({
    where: { id: job.messageId },
    data: {
      translatedText,
      whatsappMessageId: messageSid,
      deliveryStatus: "sent",
      deliveryError: null,
    },
  });

  // Emit so the optimistic UI flips the message from "sending" → "sent".
  emitTicketEvent("message", job.ticketId);
}

/**
 * Called by the worker after BullMQ has exhausted retries. Records
 * the failure on the message row and emits a socket event so the
 * dashboard can surface the failed-send state to the operator.
 */
export async function markOutboundFailed(
  messageId: string,
  ticketId: string,
  err: unknown
): Promise<void> {
  const errorText =
    err instanceof Error ? err.message : typeof err === "string" ? err : "unknown error";
  // Truncate to keep deliveryError column bounded — long stack traces
  // pollute the audit view and aren't useful for the operator.
  const truncated = errorText.slice(0, 500);

  await prisma.message.update({
    where: { id: messageId },
    data: {
      deliveryStatus: "failed",
      deliveryError: truncated,
    },
  });

  emitTicketEvent("message", ticketId);
}
