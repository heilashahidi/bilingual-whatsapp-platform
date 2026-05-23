import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import twilio from "twilio";

// Webhook signature-validation tests. The middleware uses
// twilio.validateRequest with the signed URL + form body; mocking
// twilio.validateRequest lets us control the validation outcome
// deterministically without computing real HMAC signatures.

vi.mock("twilio", () => ({
  default: {
    validateRequest: vi.fn(),
  },
}));

vi.mock("../services/database", () => ({
  prisma: {
    message: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("../services/realtime", () => ({ emitTicketEvent: vi.fn() }));
vi.mock("../services/message-normalizer", () => ({
  normalizeInboundMessage: vi.fn(),
}));
vi.mock("../services/message-pipeline", () => ({
  processInboundMessage: vi.fn(),
}));

import { webhookRouter } from "./webhooks";

const validateRequest = (twilio as unknown as { validateRequest: ReturnType<typeof vi.fn> })
  .validateRequest;

function buildApp() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use("/webhooks", webhookRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default to a "production-like" env for these tests so the
  // SKIP_TWILIO_VALIDATION dev bypass doesn't accidentally fire.
  process.env.NODE_ENV = "test";
  process.env.SKIP_TWILIO_VALIDATION = "false";
  process.env.TWILIO_AUTH_TOKEN = "test_auth_token";
  process.env.WEBHOOK_BASE_URL = "https://api.example.com";
  process.env.PORT = "3001";
});

describe("POST /webhooks/whatsapp — signature validation", () => {
  it("rejects with 403 when the Twilio signature is invalid", async () => {
    validateRequest.mockReturnValue(false);

    const res = await request(buildApp())
      .post("/webhooks/whatsapp")
      .type("form")
      .set("x-twilio-signature", "bogus-signature")
      .send({ From: "whatsapp:+50937001001", Body: "test" });

    expect(res.status).toBe(403);
    expect(validateRequest).toHaveBeenCalledTimes(1);
  });

  it("passes through with 200 when the signature is valid", async () => {
    validateRequest.mockReturnValue(true);

    const res = await request(buildApp())
      .post("/webhooks/whatsapp")
      .type("form")
      .set("x-twilio-signature", "valid-signature")
      .send({ From: "whatsapp:+50937001001", Body: "test" });

    expect(res.status).toBe(200);
  });

  it("uses the actual request URL (WEBHOOK_BASE_URL + originalUrl) when validating", async () => {
    validateRequest.mockReturnValue(true);

    await request(buildApp())
      .post("/webhooks/whatsapp")
      .type("form")
      .set("x-twilio-signature", "any")
      .send({ Body: "x" });

    expect(validateRequest).toHaveBeenCalledWith(
      "test_auth_token",
      "any",
      "https://api.example.com/webhooks/whatsapp",
      expect.objectContaining({ Body: "x" })
    );
  });
});

describe("POST /webhooks/whatsapp/status — signature validation", () => {
  // This is the new behavior: the status webhook (delivery receipts)
  // must now require a valid Twilio signature, same as the inbound
  // webhook. Previously this endpoint was unauthenticated and would
  // accept forged delivery-status updates from any source.

  it("rejects with 403 when the Twilio signature is invalid", async () => {
    validateRequest.mockReturnValue(false);

    const res = await request(buildApp())
      .post("/webhooks/whatsapp/status")
      .type("form")
      .set("x-twilio-signature", "bogus")
      .send({ MessageSid: "SM_abc", MessageStatus: "delivered" });

    expect(res.status).toBe(403);
    expect(validateRequest).toHaveBeenCalledTimes(1);
  });

  it("passes through with 200 when the signature is valid", async () => {
    validateRequest.mockReturnValue(true);

    const res = await request(buildApp())
      .post("/webhooks/whatsapp/status")
      .type("form")
      .set("x-twilio-signature", "valid")
      .send({ MessageSid: "SM_abc", MessageStatus: "queued" });

    expect(res.status).toBe(200);
  });

  it("validates against the /status URL, not the base webhook URL", async () => {
    validateRequest.mockReturnValue(true);

    await request(buildApp())
      .post("/webhooks/whatsapp/status")
      .type("form")
      .set("x-twilio-signature", "any")
      .send({ MessageSid: "SM_abc", MessageStatus: "delivered" });

    // The signed URL must include /status — if we hardcoded
    // /webhooks/whatsapp the signature would never match for status
    // callbacks (different URL, different HMAC).
    expect(validateRequest).toHaveBeenCalledWith(
      "test_auth_token",
      "any",
      "https://api.example.com/webhooks/whatsapp/status",
      expect.any(Object)
    );
  });
});

describe("SKIP_TWILIO_VALIDATION dev bypass", () => {
  it("still bypasses validation when NODE_ENV=development AND SKIP_TWILIO_VALIDATION=true", async () => {
    process.env.NODE_ENV = "development";
    process.env.SKIP_TWILIO_VALIDATION = "true";

    const res = await request(buildApp())
      .post("/webhooks/whatsapp/status")
      .type("form")
      // No signature header at all — would normally 403.
      .send({ MessageSid: "SM_abc", MessageStatus: "delivered" });

    expect(res.status).toBe(200);
    expect(validateRequest).not.toHaveBeenCalled();
  });

  it("does NOT bypass when SKIP_TWILIO_VALIDATION=true but NODE_ENV is not 'development'", async () => {
    // Production-with-misconfigured-flag should still validate
    process.env.NODE_ENV = "production";
    process.env.SKIP_TWILIO_VALIDATION = "true";
    validateRequest.mockReturnValue(false);

    const res = await request(buildApp())
      .post("/webhooks/whatsapp/status")
      .type("form")
      .set("x-twilio-signature", "bogus")
      .send({ MessageSid: "SM_abc", MessageStatus: "delivered" });

    expect(res.status).toBe(403);
    expect(validateRequest).toHaveBeenCalledTimes(1);
  });
});
