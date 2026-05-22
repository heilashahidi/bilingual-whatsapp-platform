import { Router, Request, Response } from "express";
import twilio from "twilio";
import { prisma } from "../services/database";
import { emitTicketEvent } from "../services/realtime";
import { normalizeInboundMessage } from "../services/message-normalizer";
import { processInboundMessage } from "../services/message-pipeline";

const router = Router();

// ─── Twilio signature validation middleware ─────────────────
// In production, always validate. Skip in dev if needed.

const validateTwilio = (req: Request, res: Response, next: Function) => {
  if (process.env.NODE_ENV === "development" && process.env.SKIP_TWILIO_VALIDATION === "true") {
    return next();
  }

  const signature = req.headers["x-twilio-signature"] as string;
  const authToken = process.env.TWILIO_AUTH_TOKEN!;

  // Build the full URL Twilio used (ngrok URL in dev)
  const url = `${process.env.WEBHOOK_BASE_URL || `http://localhost:${process.env.PORT || 3001}`}/webhooks/whatsapp`;

  const isValid = twilio.validateRequest(authToken, signature, url, req.body);

  if (!isValid) {
    console.warn("⚠ Invalid Twilio signature — rejecting webhook");
    return res.status(403).send("Invalid signature");
  }

  next();
};

// ─── POST /webhooks/whatsapp ────────────────────────────────
// Twilio sends incoming WhatsApp messages here.
//
// CRITICAL: Return 200 immediately. All processing is async.
// If we don't respond quickly, Twilio will retry and create duplicates.

router.post("/whatsapp", validateTwilio, async (req: Request, res: Response) => {
  // Respond to Twilio immediately — do NOT wait for processing
  res.status(200).send("<Response></Response>");

  try {
    const serverReceivedAt = new Date().toISOString();

    console.log("─── Incoming WhatsApp message ───");
    console.log(`  From: ${req.body.From}`);
    console.log(`  Body: ${req.body.Body?.substring(0, 100)}`);
    console.log(`  Media: ${req.body.NumMedia || 0} attachments`);

    // Step 1: Normalize Twilio payload → RawMessage
    const rawMessage = normalizeInboundMessage(req.body, serverReceivedAt);

    // Step 2: Process through the pipeline (async)
    // This handles: dedup → translate → classify → ticket creation → notify
    await processInboundMessage(rawMessage);
  } catch (error) {
    // Log but don't crash — we already sent 200 to Twilio
    console.error("✗ Error processing inbound message:", error);
  }
});

// ─── POST /webhooks/whatsapp/status ─────────────────────────
// Twilio sends delivery receipts here (sent, delivered, read, failed).
// Used for Haiti/DRC delivery tracking.

router.post("/whatsapp/status", async (req: Request, res: Response) => {
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

    const message = await prisma.message.findFirst({
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

export { router as webhookRouter };
