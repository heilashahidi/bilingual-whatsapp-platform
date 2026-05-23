import { describe, it, expect, beforeEach, vi } from "vitest";

// Test the queue's *fallback* path — the happy path requires a live
// Redis and is exercised by the production integration. Here we
// isolate the decision logic: when REDIS_URL is absent, when the
// underlying queue.add throws, and when both the queue and the
// fallback fail, the helper should always log + return cleanly so
// the webhook handler can ack Twilio without surfacing errors.

// vi.hoisted lifts the shared mock fns above the hoisted vi.mock calls
// so the factories can reference them without a temporal-dead-zone
// error.
const {
  processInboundMessageMock,
  queueAddMock,
  queueCloseMock,
  redisHandlers,
} = vi.hoisted(() => ({
  processInboundMessageMock: vi.fn().mockResolvedValue(undefined),
  queueAddMock: vi.fn(),
  queueCloseMock: vi.fn(),
  // Map<eventName, handler> shared across the test file so each test
  // can fire connection events deterministically.
  redisHandlers: new Map<string, (...args: unknown[]) => void>(),
}));

// Mock the pipeline so we can assert on whether inline processing
// happened — without actually hitting Prisma / Anthropic.
vi.mock("./message-pipeline", () => ({
  processInboundMessage: processInboundMessageMock,
}));

// Mock bullmq's Queue so the "queue.add throws" path is testable
// without needing a real Redis.
vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: queueAddMock,
    close: queueCloseMock,
  })),
}));

// Mock ioredis. .on(event, handler) records the handler so the test
// can fire 'ready' / 'error' events to drive connectionHealthy state.
vi.mock("ioredis", () => ({
  default: vi.fn().mockImplementation(() => ({
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      redisHandlers.set(event, handler);
    }),
    quit: vi.fn().mockResolvedValue(undefined),
  })),
}));

function fireRedisReady() {
  redisHandlers.get("ready")?.();
}

function fireRedisError(err: Error) {
  redisHandlers.get("error")?.(err);
}

import { enqueueInbound, closeQueue } from "./queue";
import type { RawMessage } from "@asp/shared";

const fakeMessage: RawMessage = {
  source: "twilio_whatsapp",
  externalId: "SM_test_123",
  agentPhone: "+50937001001",
  textBody: "test",
  contentType: "text",
  mediaUrl: null,
  agentTimestamp: "2026-05-23T00:00:00Z",
  serverReceivedAt: "2026-05-23T00:00:00Z",
  metadata: { profileName: "Test", countryCode: "HT" },
};

beforeEach(async () => {
  vi.clearAllMocks();
  redisHandlers.clear();
  await closeQueue(); // reset module-level singleton between tests
});

describe("enqueueInbound", () => {
  it("falls back to inline processing when REDIS_URL is unset", async () => {
    delete process.env.REDIS_URL;

    await enqueueInbound(fakeMessage);

    // Inline path runs processInboundMessage synchronously (well,
    // async but un-awaited inside the helper). Give the microtask
    // queue a tick to flush.
    await Promise.resolve();
    expect(processInboundMessageMock).toHaveBeenCalledWith(fakeMessage);
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it("pushes onto the BullMQ queue when REDIS_URL is set AND connection is healthy", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    queueAddMock.mockResolvedValue({ id: "SM_test_123" });

    // First enqueue triggers init → ioredis ctor → handlers registered.
    // We need to mark connection healthy BEFORE the queue.add check,
    // so call enqueueInbound once to init, fire ready, then again.
    await enqueueInbound(fakeMessage);
    fireRedisReady();
    queueAddMock.mockClear();
    processInboundMessageMock.mockClear();

    await enqueueInbound(fakeMessage);

    expect(queueAddMock).toHaveBeenCalledTimes(1);
    expect(processInboundMessageMock).not.toHaveBeenCalled();
  });

  it("uses externalId as jobId for dedup against duplicate webhook delivery", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    queueAddMock.mockResolvedValue({});
    await enqueueInbound(fakeMessage);
    fireRedisReady();
    queueAddMock.mockClear();

    await enqueueInbound(fakeMessage);

    const opts = queueAddMock.mock.calls[0][2];
    expect(opts.jobId).toBe("SM_test_123");
  });

  it("configures retries with exponential backoff", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    queueAddMock.mockResolvedValue({});
    await enqueueInbound(fakeMessage);
    fireRedisReady();
    queueAddMock.mockClear();

    await enqueueInbound(fakeMessage);

    const opts = queueAddMock.mock.calls[0][2];
    expect(opts.attempts).toBe(3);
    expect(opts.backoff).toEqual({ type: "exponential", delay: 2000 });
  });

  it("falls back to inline when Redis never reaches 'ready' (e.g. wrong URL)", async () => {
    // The real-world failure mode: REDIS_URL points at localhost from
    // inside a Railway container, ioredis emits 'error' (ECONNREFUSED)
    // and never emits 'ready'. With BullMQ's required
    // maxRetriesPerRequest:null, queue.add would hang forever.
    // Inline fallback must kick in.
    process.env.REDIS_URL = "redis://localhost:6379";

    await enqueueInbound(fakeMessage);
    // No fireRedisReady — connection stays unhealthy.

    await Promise.resolve();
    expect(processInboundMessageMock).toHaveBeenCalledWith(fakeMessage);
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it("flips back to inline when a healthy connection later drops", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    queueAddMock.mockResolvedValue({});

    // Healthy → queue path
    await enqueueInbound(fakeMessage);
    fireRedisReady();
    queueAddMock.mockClear();
    processInboundMessageMock.mockClear();

    await enqueueInbound(fakeMessage);
    expect(queueAddMock).toHaveBeenCalledTimes(1);

    // Connection drops
    fireRedisError(new Error("connection lost"));
    queueAddMock.mockClear();
    processInboundMessageMock.mockClear();

    // Next enqueue should go inline
    await enqueueInbound(fakeMessage);
    await Promise.resolve();
    expect(processInboundMessageMock).toHaveBeenCalledWith(fakeMessage);
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it("falls back to inline processing when queue.add throws on a healthy connection", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    await enqueueInbound(fakeMessage);
    fireRedisReady();
    queueAddMock.mockClear();
    processInboundMessageMock.mockClear();
    queueAddMock.mockRejectedValue(new Error("Redis blip"));

    await enqueueInbound(fakeMessage);

    // Both paths attempted: queue.add tried (and failed), then
    // inline fell through.
    await Promise.resolve();
    expect(queueAddMock).toHaveBeenCalled();
    expect(processInboundMessageMock).toHaveBeenCalledWith(fakeMessage);
  });

  it("does not throw even when the inline fallback also fails", async () => {
    delete process.env.REDIS_URL;
    processInboundMessageMock.mockRejectedValue(new Error("Anthropic down"));

    // The promise from processInboundMessage is intentionally
    // unawaited inside enqueueInbound (fire-and-forget). The helper
    // must still resolve so the webhook handler can ack Twilio.
    await expect(enqueueInbound(fakeMessage)).resolves.toBeUndefined();
  });
});
