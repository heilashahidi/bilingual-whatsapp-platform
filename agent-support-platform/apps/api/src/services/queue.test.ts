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
const { processInboundMessageMock, queueAddMock, queueCloseMock } = vi.hoisted(
  () => ({
    processInboundMessageMock: vi.fn().mockResolvedValue(undefined),
    queueAddMock: vi.fn(),
    queueCloseMock: vi.fn(),
  })
);

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

// Mock ioredis to a no-op constructor — we never actually connect.
vi.mock("ioredis", () => ({
  default: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    quit: vi.fn().mockResolvedValue(undefined),
  })),
}));

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

  it("pushes onto the BullMQ queue when REDIS_URL is set", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    queueAddMock.mockResolvedValue({ id: "SM_test_123" });

    await enqueueInbound(fakeMessage);

    expect(queueAddMock).toHaveBeenCalledTimes(1);
    expect(processInboundMessageMock).not.toHaveBeenCalled();
  });

  it("uses externalId as jobId for dedup against duplicate webhook delivery", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    queueAddMock.mockResolvedValue({});

    await enqueueInbound(fakeMessage);

    const opts = queueAddMock.mock.calls[0][2];
    expect(opts.jobId).toBe("SM_test_123");
  });

  it("configures retries with exponential backoff", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    queueAddMock.mockResolvedValue({});

    await enqueueInbound(fakeMessage);

    const opts = queueAddMock.mock.calls[0][2];
    expect(opts.attempts).toBe(3);
    expect(opts.backoff).toEqual({ type: "exponential", delay: 2000 });
  });

  it("falls back to inline processing when queue.add throws", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    queueAddMock.mockRejectedValue(new Error("Redis unreachable"));

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
