import { Router, Request, Response } from "express";
import twilio from "twilio";
import { prisma } from "../services/database";
import { emitTicketEvent } from "../services/realtime";
import { normalizeInboundMessage } from "../services/message-normalizer";
import { enqueueInbound } from "../services/queue";

const router = Router();

// Path-aware so the same middleware works for both /webhooks/whatsapp and
// the /webhooks/whatsapp/status delivery-receipt endpoint.
const validateTwilio = (req: Request, res: Response, next: Function) => {
  if (process.env.NODE_ENV === "development" && process.env.SKIP_TWILIO_VALIDATION === "true") {
    return next();
  }

  const signature = req.headers["x-twilio-signature"] as string;
  const authToken = process.env.TWILIO_AUTH_TOKEN!;

  // Reconstruct the exact URL Twilio signed. req.originalUrl includes
  // the mount path (/webhooks/whatsapp or /webhooks/whatsapp/status)
  // plus any querystring, so it matches what Twilio used.
  const base =
    process.env.WEBHOOK_BASE_URL ||
    `http://localhost:${process.env.PORT || 3001}`;
  const url = `${base}${req.originalUrl}`;

  const isValid = twilio.validateRequest(authToken, signature, url, req.body);

  if (!isValid) {
    console.warn(
      `⚠ Invalid Twilio signature — rejecting webhook (${req.originalUrl})`
    );
    return res.status(403).send("Invalid signature");
  }

  next();
};

// CRITICAL: Return 200 immediately and process async. If we don't respond
// quickly, Twilio retries and creates duplicates.
router.post("/whatsapp", validateTwilio, async (req: Request, res: Response) => {
  res.status(200).send("<Response></Response>");

  try {
    const serverReceivedAt = new Date().toISOString();

    console.log("─── Incoming WhatsApp message ───");
    console.log(`  From: ${req.body.From}`);
    console.log(`  Body: ${req.body.Body?.substring(0, 100)}`);
    console.log(`  Media: ${req.body.NumMedia || 0} attachments`);

    const rawMessage = normalizeInboundMessage(req.body, serverReceivedAt);

    // enqueueInbound falls back to inline processing when REDIS_URL is unset
    // or Redis is unreachable, so this is always non-blocking from Twilio's view.
    await enqueueInbound(rawMessage);
  } catch (error) {
    // We already sent 200 — log but don't crash.
    console.error("✗ Error enqueuing inbound message:", error);
  }
});

// Twilio delivery receipts (sent / delivered / read / failed).
router.post("/whatsapp/status", validateTwilio, async (req: Request, res: Response) => {
  res.status(200).send("<Response></Response>");

  try {
    const { MessageSid, MessageStatus, To } = req.body;

    console.log(`  Delivery status: ${MessageSid} → ${MessageStatus} (${To})`);

    // Twilio status flow: queued → sent → delivered → read.
    // We only persist transitions that change UI state.
    const updateData: { deliveredAt?: Date; readAt?: Date } = {};
    if (MessageStatus === "delivered") {
      updateData.deliveredAt = new Date();
    } else if (MessageStatus === "read") {
      updateData.readAt = new Date();
      // A read receipt implies delivery; backfill if missing.
      updateData.deliveredAt = updateData.deliveredAt || new Date();
    }

    if (Object.keys(updateData).length === 0) return;

    const message = await prisma.message.findUnique({
      where: { whatsappMessageId: MessageSid },
      select: { id: true, ticketId: true, deliveredAt: true, readAt: true },
    });
    if (!message) return;

    // Don't clobber an existing earlier timestamp
    const finalData: { deliveredAt?: Date; readAt?: Date } = {};
    if (updateData.deliveredAt && !message.deliveredAt)
      finalData.deliveredAt = updateData.deliveredAt;
    if (updateData.readAt && !message.readAt) finalData.readAt = updateData.readAt;
    if (Object.keys(finalData).length === 0) return;

    await prisma.message.update({ where: { id: message.id }, data: finalData });

    // TODO: If "delivered", update agent connectivity status to "online"
    emitTicketEvent("updated", message.ticketId);
  } catch (error) {
    console.error("✗ Error processing status callback:", error);
  }
});

// Slack requires an Interactivity Request URL to be configured even though
// our outbound messages use URL-only buttons — this just acknowledges.
router.post("/slack", (_req: Request, res: Response) => {
  res.status(200).send();
});

export { router as webhookRouter };
