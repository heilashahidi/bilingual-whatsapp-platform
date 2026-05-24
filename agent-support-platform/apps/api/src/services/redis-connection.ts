import IORedis, { type Redis } from "ioredis";

// Shared Redis connection used by every BullMQ Queue and Worker in the
// API process. Lives in its own module so the inbound queue, the
// outbound queue, and their respective workers can all depend on a
// common low-level singleton instead of importing each other — which
// formed a cycle (outbound-queue → queue → message-pipeline →
// outbound-queue) when this lived in queue.ts alongside the inbound
// Queue instance.
//
// Behavior preserved from the previous queue.ts implementation:
//
//   - Lazy init: cheap to import; only opens the socket on first
//     getQueueConnection() call.
//   - REDIS_URL missing → returns null and the caller falls back to
//     inline processing (dev mode, emergency-Redis-outage).
//   - BullMQ requires maxRetriesPerRequest: null. That makes ioredis
//     queue commands forever during reconnect, which would HANG
//     queue.add on a misconfigured URL — so we track connection health
//     via the ready/error events and let callers bypass the queue when
//     the connection isn't healthy.

let connection: Redis | null = null;
let initialized = false;
let connectionHealthy = false;

function initIfNeeded(): void {
  if (initialized) return;
  initialized = true;

  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn(
      "  ⚠ REDIS_URL not set — messages will be processed inline (no queue)"
    );
    return;
  }

  try {
    connection = new IORedis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });

    connection.on("ready", () => {
      connectionHealthy = true;
      console.log("  ⚙ Redis ready for BullMQ");
    });

    connection.on("end", () => {
      connectionHealthy = false;
    });

    connection.on("error", (err) => {
      const wasHealthy = connectionHealthy;
      connectionHealthy = false;
      if (wasHealthy) {
        console.error("  ✗ Redis connection lost:", err.message);
      }
    });
  } catch (err) {
    const initError = err instanceof Error ? err : new Error(String(err));
    console.error(
      "  ✗ Failed to initialize Redis — falling back to inline processing:",
      initError.message
    );
  }
}

/**
 * Returns the shared Redis connection, lazily initializing it on first
 * call. Returns null when REDIS_URL is unset or initialization failed —
 * callers must treat null as "no queue available, process inline."
 */
export function getQueueConnection(): Redis | null {
  initIfNeeded();
  return connection;
}

/**
 * True iff the connection is currently in the ready state. Callers use
 * this to bypass queue.add when the socket is mid-reconnect — without
 * it, BullMQ's required maxRetriesPerRequest: null setting would cause
 * queue.add to hang indefinitely.
 */
export function isConnectionHealthy(): boolean {
  return connectionHealthy;
}

/**
 * For tests and graceful shutdown. Closes the socket and resets the
 * singleton state so the next getQueueConnection() call re-initializes.
 */
export async function closeRedisConnection(): Promise<void> {
  await connection?.quit();
  connection = null;
  initialized = false;
  connectionHealthy = false;
}
