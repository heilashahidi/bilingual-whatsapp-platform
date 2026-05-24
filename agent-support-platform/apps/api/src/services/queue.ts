import { Queue } from "bullmq";
import type { RawMessage } from "@asp/shared";
import { processInboundMessage } from "./message-pipeline";
import {
  getQueueConnection,
  isConnectionHealthy,
  closeRedisConnection,
} from "./redis-connection";

// Queue-based ingestion for inbound WhatsApp messages.
//
// Why a queue instead of just `await processInboundMessage()` in the
// webhook handler:
//
//   1. Burst recovery. A Haitian or DRC field agent who's been offline
//      for 90 minutes may have WhatsApp dump a burst of 8–10 queued
//      messages at us within a few seconds. Inline processing handles
//      each one sequentially in the webhook handler; concurrent ones
//      pile up on the event loop. A queue with bounded worker
//      concurrency drains the burst cleanly.
//
//   2. At-least-once delivery. If the API process crashes mid-
//      `processInboundMessage` (Anthropic timeout, Neon flap), the
//      work is lost — Twilio already got its 200, so it won't retry.
//      BullMQ's stalled-job recovery picks up the job after the
//      stalledInterval and a fresh worker retries it.
//
//   3. Retry on transient failure. Translation/classification can
//      throw on Anthropic blips. With BullMQ we retry with backoff
//      instead of falling straight through to the stub.
//
// Graceful degradation: if REDIS_URL is unset or Redis can't be
// reached at boot, `enqueueInbound` synchronously falls back to
// calling processInboundMessage directly. This keeps dev mode (no
// Redis container) and emergency-Redis-outage scenarios working.

export const INBOUND_QUEUE_NAME = "inbound-whatsapp";

// Lazy-initialized — instantiating the Queue requires a live
// connection, so we defer until the first enqueueInbound call.
let queue: Queue<RawMessage> | null = null;

function getQueue(): Queue<RawMessage> | null {
  if (queue) return queue;
  const connection = getQueueConnection();
  if (!connection) return null;
  queue = new Queue<RawMessage>(INBOUND_QUEUE_NAME, { connection });
  console.log(`  ⚙ BullMQ queue ready: ${INBOUND_QUEUE_NAME}`);
  return queue;
}

/**
 * Enqueue an inbound WhatsApp message for async processing.
 *
 * Returns once the job is on the queue (or, in fallback mode, returns
 * immediately and processing runs in the background).
 *
 * The webhook handler doesn't await the actual processing — it only
 * needs to know the message is durably accepted.
 */
export async function enqueueInbound(raw: RawMessage): Promise<void> {
  const q = getQueue();

  // No queue available OR Redis isn't connected → fire-and-forget
  // inline processing. The connection-healthy guard is important: with
  // BullMQ's required `maxRetriesPerRequest: null`, queue.add would
  // hang forever on a misconfigured Redis URL instead of failing fast.
  // Inline path matches the pre-queue semantics exactly.
  if (!q || !isConnectionHealthy()) {
    processInboundMessage(raw).catch((err) =>
      console.error("  ✗ Inline inbound processing failed:", err)
    );
    return;
  }

  try {
    await q.add("process", raw, {
      // Use the WhatsApp message id as the job id so duplicate webhook
      // deliveries from Twilio collapse to a single job. BullMQ
      // rejects duplicate jobIds silently.
      jobId: raw.externalId,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { age: 3600, count: 1000 }, // keep 1h or last 1000
      removeOnFail: { age: 86400 }, // keep failed jobs 24h for inspection
    });
  } catch (err) {
    // Redis went down between init and enqueue — degrade to inline.
    console.error(
      "  ✗ Queue enqueue failed, processing inline:",
      err instanceof Error ? err.message : err
    );
    processInboundMessage(raw).catch((processErr) =>
      console.error("  ✗ Inline fallback also failed:", processErr)
    );
  }
}

/**
 * For tests and graceful shutdown.
 */
export async function closeQueue(): Promise<void> {
  await queue?.close();
  queue = null;
  await closeRedisConnection();
}
