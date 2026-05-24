import { Queue } from "bullmq";
import { getQueueConnection } from "./queue";
import { processOutboundMessage } from "./outbound-pipeline";

// Outbound WhatsApp send queue. Mirrors the inbound queue pattern
// (queue.ts) and shares the same Redis connection.
//
// Why a queue on the outbound path:
//
//   1. Resilience against flaky Twilio/WhatsApp legs. A single
//      transient failure to a Haitian or DRC mobile carrier shouldn't
//      lose the operator's reply — the queue retries 3x with backoff.
//      Pre-queue, a Twilio 500 surfaced as a dashboard 500 and the
//      message just vanished.
//
//   2. Decoupled dashboard latency. The operator hits "send" and the
//      API returns immediately with a pending message row. The
//      browser renders it as "sending" (see ticket-drawer composer).
//      Twilio's round-trip (200-500ms) + translation (300-500ms) no
//      longer block the operator from moving to the next ticket.
//
//   3. Backpressure during outages. If WhatsApp is partially down,
//      the queue drains as capacity returns instead of piling up
//      synchronous request timeouts on the API.
//
// Graceful degradation: same fallback semantics as enqueueInbound —
// if Redis isn't healthy, processOutboundMessage runs inline.

export const OUTBOUND_QUEUE_NAME = "outbound-whatsapp";

export interface OutboundJob {
  messageId: string; // Pre-created Message row to update with sid/status
  ticketId: string;
  agentPhone: string;
  agentCountry: string;
  englishText: string;
  targetLanguage: string;
}

let queue: Queue<OutboundJob> | null = null;

function getQueue(): Queue<OutboundJob> | null {
  if (queue) return queue;
  const connection = getQueueConnection();
  if (!connection) return null;
  queue = new Queue<OutboundJob>(OUTBOUND_QUEUE_NAME, { connection });
  console.log(`  ⚙ BullMQ queue ready: ${OUTBOUND_QUEUE_NAME}`);
  return queue;
}

/**
 * Enqueue an outbound WhatsApp send. Returns once the job is on the
 * queue (or, in fallback mode, returns immediately and processing
 * runs in the background).
 *
 * The caller has already persisted the Message row with
 * deliveryStatus='pending'; the worker updates that same row when the
 * send completes (or fails terminally).
 */
export async function enqueueOutbound(job: OutboundJob): Promise<void> {
  const q = getQueue();

  // No queue available OR Redis is unhealthy → fire-and-forget inline
  // send so dev mode and emergency-Redis-outage scenarios keep working.
  // The connection-health flag inside getQueueConnection ensures this
  // doesn't hang on a misconfigured REDIS_URL.
  if (!q) {
    processOutboundMessage(job).catch((err) =>
      console.error("  ✗ Inline outbound processing failed:", err)
    );
    return;
  }

  try {
    await q.add("send", job, {
      // Per-message idempotency: dedupe on messageId so a duplicate
      // enqueue (e.g., retry by caller after a transient error) maps
      // to the same job.
      jobId: job.messageId,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 86400 }, // keep failed jobs 24h for inspection
    });
  } catch (err) {
    console.error(
      "  ✗ Outbound queue enqueue failed, processing inline:",
      err instanceof Error ? err.message : err
    );
    processOutboundMessage(job).catch((processErr) =>
      console.error("  ✗ Inline outbound fallback also failed:", processErr)
    );
  }
}

export async function closeOutboundQueue(): Promise<void> {
  await queue?.close();
  queue = null;
}
