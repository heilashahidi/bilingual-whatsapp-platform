import { Worker, type Job } from "bullmq";
import type { RawMessage } from "@asp/shared";
import { processInboundMessage } from "./message-pipeline";
import { INBOUND_QUEUE_NAME } from "./queue";
import { getQueueConnection } from "./redis-connection";

// In-process worker that drains the inbound queue.
//
// Runs in the same Node process as the Express API to keep deployment
// simple (one Railway service instead of two). At our scale this is
// fine — pipeline processing is dominated by Anthropic latency, and
// one Node event loop can comfortably hand-off several in-flight HTTP
// requests to Claude in parallel.
//
// If we ever need to scale workers independently of the API surface,
// we'd extract this to its own entrypoint (e.g. `node dist/worker.js`)
// and run it as a second Railway service that shares REDIS_URL. The
// queue + processor code wouldn't change.
//
// Concurrency = 4 lets us process up to four messages in parallel
// (each ~1.5s of Claude latency). Higher would burn Anthropic rate
// limit; lower would queue up during burst recoveries from offline
// Haitian agents.

const WORKER_CONCURRENCY = 4;

let worker: Worker<RawMessage> | null = null;

export function startInboundWorker(): void {
  if (worker) return; // idempotent

  const connection = getQueueConnection();
  if (!connection) {
    console.warn(
      "  ⚠ No Redis connection — skipping inbound worker startup (inline mode)"
    );
    return;
  }

  worker = new Worker<RawMessage>(
    INBOUND_QUEUE_NAME,
    async (job: Job<RawMessage>) => {
      // The processor is unchanged from the pre-queue inline path —
      // it just runs here instead of in the webhook handler. Any
      // throw propagates up, BullMQ records the failure and retries
      // per the job's `attempts` config.
      await processInboundMessage(job.data);
    },
    {
      connection,
      concurrency: WORKER_CONCURRENCY,
      // Stalled-job recovery: if the worker crashes mid-job, the job
      // sits in "active" until stalledInterval passes, then another
      // worker (or the same one after restart) picks it up.
      stalledInterval: 30_000,
      maxStalledCount: 2,
    }
  );

  worker.on("completed", (job) => {
    // Already logged inside the pipeline; this is just a structural
    // signal for queue health monitoring.
    console.log(`  ✓ Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(
      `  ✗ Job ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts.attempts}):`,
      err.message
    );
  });

  worker.on("error", (err) => {
    console.error("  ✗ Worker error:", err.message);
  });

  console.log(
    `  ⚙ Inbound worker started (concurrency ${WORKER_CONCURRENCY})`
  );
}

/**
 * Graceful shutdown — let in-flight jobs finish, then close.
 * Called from server.ts on SIGTERM/SIGINT.
 */
export async function stopInboundWorker(): Promise<void> {
  if (!worker) return;
  await worker.close();
  worker = null;
}
