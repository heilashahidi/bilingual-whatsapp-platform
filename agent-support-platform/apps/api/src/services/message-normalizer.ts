import { RawMessage } from "@asp/shared";

interface TwilioWhatsAppPayload {
  MessageSid: string;
  From: string; // "whatsapp:+509XXXXXXXX"
  To: string;
  Body?: string;
  NumMedia?: string;
  MediaUrl0?: string;
  MediaContentType0?: string;
  ProfileName?: string;
  WaId?: string; // Raw phone number without prefix
}

/**
 * Normalize a Twilio WhatsApp webhook payload into our internal RawMessage format.
 *
 * This is the adapter layer — if we later switch to Meta Cloud API or another
 * provider, we write a new normalizer that produces the same RawMessage shape.
 * Everything downstream only knows about RawMessage.
 */
export function normalizeInboundMessage(
  payload: TwilioWhatsAppPayload,
  serverReceivedAt: string
): RawMessage {
  const agentPhone = payload.From.replace("whatsapp:", "");

  const numMedia = parseInt(payload.NumMedia || "0", 10);
  let contentType: RawMessage["contentType"] = "text";
  let mediaUrl: string | null = null;

  if (numMedia > 0 && payload.MediaContentType0) {
    const mimeType = payload.MediaContentType0;
    if (mimeType.startsWith("image/")) contentType = "image";
    else if (mimeType.startsWith("audio/")) contentType = "audio";
    else if (mimeType.startsWith("video/")) contentType = "video";
    else contentType = "document";

    mediaUrl = payload.MediaUrl0 || null;
  }

  const countryCode = deriveCountryCode(agentPhone);

  return {
    source: "whatsapp",
    externalId: payload.MessageSid,
    agentPhone,
    // Twilio doesn't give us the original WhatsApp send timestamp in the
    // sandbox webhook — it only arrives in the Meta Cloud API payload.
    // For now, use server receipt time. When migrating to Meta Cloud API,
    // this will use the WhatsApp-provided timestamp instead.
    // This is the field that matters for Haiti latency tracking.
    agentTimestamp: serverReceivedAt, // TODO: Use WhatsApp timestamp when on Meta API
    serverReceivedAt,
    contentType,
    textBody: payload.Body || null,
    mediaUrl,
    metadata: {
      countryCode,
      profileName: payload.ProfileName || null,
    },
  };
}

/**
 * Derive country from phone number prefix.
 * +509 = Haiti, +1-809/829/849 = DR, +243 = DRC
 *
 * For numbers that don't match (e.g., US test numbers during development),
 * fall back to TEST_AGENT_COUNTRY env var, defaulting to HT. This lets a
 * developer demo the Twilio sandbox flow from a US phone without crashing
 * the pipeline on the Country enum.
 */
function deriveCountryCode(phone: string): string {
  if (phone.startsWith("+509")) return "HT";
  if (phone.startsWith("+243")) return "CD";
  if (phone.startsWith("+1809") || phone.startsWith("+1829") || phone.startsWith("+1849")) return "DO";
  return process.env.TEST_AGENT_COUNTRY || "HT";
}
