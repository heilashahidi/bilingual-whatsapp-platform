import { Worker, type Job } from "bullmq";
import { getQueueConnection } from "./queue";
import {
  OUTBOUND_QUEUE_NAME,
  type OutboundJob,
} from "./outbound-queue";
import { processOutboundMessage, markOutboundFailed } from "./outbound-pipeline";

// Outbound worker. Drains the queue, calling Twilio per job.
//
// Concurrency 4 matches the inbound worker — Twilio's per-account
// throughput easily absorbs that, and translation is cached/parallel
// enough that this isn't the bottleneck. If we hit Twilio rate limits
// in practice, drop to 2.

const WORKER_CONCURRENCY = 4;

let worker: Worker<OutboundJob> | null = null;

export function startOutboundWorker(): void {
  if (worker) return;

  const connection = getQueueConnection();
  if (!connection) {
    console.warn(
      "  ⚠ No Redis connection — skipping outbound worker startup (inline mode)"
    );
    return;
  }

  worker = new Worker<OutboundJob>(
    OUTBOUND_QUEUE_NAME,
    async (job: Job<OutboundJob>) => {
      await processOutboundMessage(job.data);
    },
    {
      connection,
      concurrency: WORKER_CONCURRENCY,
      stalledInterval: 30_000,
      maxStalledCount: 2,
    }
  );

  worker.on("completed", (job) => {
    console.log(`  ✓ Outbound job ${job.id} delivered`);
  });

  // Only mark as terminally failed after BullMQ exhausts retries.
  // Mid-attempt failures here would race the retry loop and flip the
  // message to "failed" before the next attempt fires.
  worker.on("failed", async (job, err) => {
    const attempts = job?.opts.attempts ?? 0;
    const made = job?.attemptsMade ?? 0;
    console.error(
      `  ✗ Outbound job ${job?.id} failed (attempt ${made}/${attempts}):`,
      err.message
    );
    if (job && made >= attempts) {
      try {
        await markOutboundFailed(job.data.messageId, job.data.ticketId, err);
      } catch (markErr) {
        console.error("  ✗ Failed to record outbound failure:", markErr);
      }
    }
  });

  worker.on("error", (err) => {
    console.error("  ✗ Outbound worker error:", err.message);
  });

  console.log(
    `  ⚙ Outbound worker started (concurrency ${WORKER_CONCURRENCY})`
  );
}

export async function stopOutboundWorker(): Promise<void> {
  if (!worker) return;
  await worker.close();
  worker = null;
}
