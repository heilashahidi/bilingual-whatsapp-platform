import { Queue } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import type { RawMessage } from "@asp/shared";
import { processInboundMessage } from "./message-pipeline";

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

// Singleton — lazy-initialized so importing this module is cheap and
// doesn't error on a misconfigured Redis URL.
let connection: Redis | null = null;
let queue: Queue<RawMessage> | null = null;
let initialized = false;
let initError: Error | null = null;

function initQueueIfNeeded(): void {
  if (initialized) return;
  initialized = true;

  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn(
      "  ⚠ REDIS_URL not set — inbound messages will be processed inline (no queue)"
    );
    return;
  }

  try {
    // BullMQ requires maxRetriesPerRequest: null on the connection
    // used by Queues and Workers; otherwise it'll throw at runtime.
    connection = new IORedis(url, {
      maxRetriesPerRequest: null,
      // Reconnect on disruption — Upstash occasionally drops idle
      // connections. ioredis defaults handle this well.
      enableReadyCheck: true,
    });

    connection.on("error", (err) => {
      // Logged but not fatal — the queue ops will throw individually
      // and the enqueue helper will fall back to inline processing.
      console.error("  ✗ Redis connection error:", err.message);
    });

    queue = new Queue<RawMessage>(INBOUND_QUEUE_NAME, { connection });
    console.log(`  ⚙ BullMQ queue ready: ${INBOUND_QUEUE_NAME}`);
  } catch (err) {
    initError = err instanceof Error ? err : new Error(String(err));
    console.error(
      "  ✗ Failed to initialize BullMQ — falling back to inline processing:",
      initError.message
    );
  }
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
  initQueueIfNeeded();

  // No queue available → fire-and-forget inline processing. Same
  // semantics as the pre-queue code path. We don't await this so the
  // webhook can respond quickly.
  if (!queue) {
    processInboundMessage(raw).catch((err) =>
      console.error("  ✗ Inline inbound processing failed:", err)
    );
    return;
  }

  try {
    await queue.add("process", raw, {
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
  await connection?.quit();
  queue = null;
  connection = null;
  initialized = false;
  initError = null;
}

/**
 * Inspection helpers — used by the worker module and tests.
 */
export function getQueueConnection(): Redis | null {
  initQueueIfNeeded();
  return connection;
}
