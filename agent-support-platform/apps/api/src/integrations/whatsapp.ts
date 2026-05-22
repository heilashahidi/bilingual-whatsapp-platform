import twilio from "twilio";
import { BOT_MAX_MESSAGE_LENGTH } from "@asp/shared";
import { translateResponse } from "./translation";

const getClient = () => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const authToken = process.env.TWILIO_AUTH_TOKEN!;
  return twilio(accountSid, authToken);
};

/**
 * Send a WhatsApp message to an agent via Twilio.
 *
 * Returns the Twilio message SID for delivery tracking.
 *
 * NOTE: For Haiti/DRC, messages should be kept under 1,000 characters
 * and should be text-only (no media). The caller is responsible for
 * enforcing these constraints.
 */
export async function sendWhatsAppMessage(
  toPhone: string,
  body: string,
  options?: {
    mediaUrl?: string; // Skip for Haiti/DRC
    statusCallback?: string;
  }
): Promise<string> {
  if (process.env.USE_REAL_WHATSAPP === "false") {
    console.log(`  [STUB] Would send WhatsApp to ${toPhone}: "${body.substring(0, 80)}..."`);
    return `STUB_${Date.now()}`;
  }

  const client = getClient();
  const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || "+14155238886";

  const messageParams: any = {
    from: `whatsapp:${fromNumber}`,
    to: `whatsapp:${toPhone}`,
    body,
  };

  // Status callback URL for delivery receipts
  if (options?.statusCallback) {
    messageParams.statusCallback = options.statusCallback;
  } else if (process.env.WEBHOOK_BASE_URL) {
    messageParams.statusCallback = `${process.env.WEBHOOK_BASE_URL}/webhooks/whatsapp/status`;
  }

  // Media — skip for Haiti/DRC (handled by caller)
  if (options?.mediaUrl) {
    messageParams.mediaUrl = [options.mediaUrl];
  }

  const message = await client.messages.create(messageParams);
  console.log(`  ✓ Sent WhatsApp message ${message.sid} to ${toPhone}`);

  return message.sid;
}

/**
 * Send a response from the US team to a field agent.
 *
 * Translates the operator's English into the agent's language, enforces
 * per-country length limits, and ships it through WhatsApp. If the agent
 * is already writing in English, we skip the translation call entirely —
 * sending it through Claude when source and target are both English just
 * burns latency and occasionally rewrites the operator's wording.
 */
export async function sendAgentResponse(
  toPhone: string,
  englishText: string,
  agentLanguage: string,
  agentCountry: string
): Promise<{ messageSid: string; translatedText: string }> {
  let translatedText = englishText;

  if (agentLanguage && agentLanguage !== "en") {
    // Translate to agent's language
    const translation = await translateResponse(englishText, agentLanguage);
    translatedText = translation.translatedText;
  }

  // Enforce message length limits for low-bandwidth countries
  const maxLength = BOT_MAX_MESSAGE_LENGTH[agentCountry] || 2000;
  if (translatedText.length > maxLength) {
    // Truncate and add continuation note
    translatedText = translatedText.substring(0, maxLength - 50) + "\n\n[Reply MORE for the rest]";
  }

  const messageSid = await sendWhatsAppMessage(toPhone, translatedText);

  return { messageSid, translatedText };
}
