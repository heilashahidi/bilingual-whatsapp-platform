import { describe, it, expect } from "vitest";
import { normalizeInboundMessage } from "./message-normalizer";

const base = {
  MessageSid: "SM_test_123",
  From: "whatsapp:+50937001001",
  To: "whatsapp:+14155238886",
  Body: "Aplikasyon an tonbe",
  NumMedia: "0",
  ProfileName: "Test Agent",
};

describe("normalizeInboundMessage", () => {
  it("extracts the agent's phone number from Twilio's whatsapp: prefix", () => {
    const result = normalizeInboundMessage(base, "2026-05-22T00:00:00Z");
    expect(result.agentPhone).toBe("+50937001001");
  });

  it("preserves the WhatsApp message ID as externalId for idempotency", () => {
    const result = normalizeInboundMessage(base, "2026-05-22T00:00:00Z");
    expect(result.externalId).toBe("SM_test_123");
  });

  it("derives country HT from +509 prefix", () => {
    const result = normalizeInboundMessage(base, "2026-05-22T00:00:00Z");
    expect(result.metadata.countryCode).toBe("HT");
  });

  it("derives country CD from +243 prefix", () => {
    const result = normalizeInboundMessage(
      { ...base, From: "whatsapp:+243812345678" },
      "2026-05-22T00:00:00Z"
    );
    expect(result.metadata.countryCode).toBe("CD");
  });

  it("derives country DO from +1809 / +1829 / +1849 area codes", () => {
    const codes = ["+18091234567", "+18291234567", "+18491234567"];
    for (const phone of codes) {
      const result = normalizeInboundMessage(
        { ...base, From: `whatsapp:${phone}` },
        "2026-05-22T00:00:00Z"
      );
      expect(result.metadata.countryCode).toBe("DO");
    }
  });

  it("falls back to TEST_AGENT_COUNTRY (defaulting to HT) for non-matching prefixes", () => {
    // US test number that isn't a DR area code
    const result = normalizeInboundMessage(
      { ...base, From: "whatsapp:+15125771711" },
      "2026-05-22T00:00:00Z"
    );
    expect(result.metadata.countryCode).toBe("HT");
  });

  it("respects TEST_AGENT_COUNTRY override for non-matching prefixes", () => {
    const original = process.env.TEST_AGENT_COUNTRY;
    process.env.TEST_AGENT_COUNTRY = "DO";
    try {
      const result = normalizeInboundMessage(
        { ...base, From: "whatsapp:+15125771711" },
        "2026-05-22T00:00:00Z"
      );
      expect(result.metadata.countryCode).toBe("DO");
    } finally {
      if (original) process.env.TEST_AGENT_COUNTRY = original;
      else delete process.env.TEST_AGENT_COUNTRY;
    }
  });

  it("detects image content type from MediaContentType0", () => {
    const result = normalizeInboundMessage(
      {
        ...base,
        Body: "",
        NumMedia: "1",
        MediaContentType0: "image/jpeg",
        MediaUrl0: "https://example.com/img.jpg",
      },
      "2026-05-22T00:00:00Z"
    );
    expect(result.contentType).toBe("image");
    expect(result.mediaUrl).toBe("https://example.com/img.jpg");
  });

  it("detects audio content type for WhatsApp voice notes", () => {
    const result = normalizeInboundMessage(
      {
        ...base,
        Body: "",
        NumMedia: "1",
        MediaContentType0: "audio/ogg",
        MediaUrl0: "https://example.com/voice.ogg",
      },
      "2026-05-22T00:00:00Z"
    );
    expect(result.contentType).toBe("audio");
  });

  it("defaults to text contentType when there's no media", () => {
    const result = normalizeInboundMessage(base, "2026-05-22T00:00:00Z");
    expect(result.contentType).toBe("text");
    expect(result.mediaUrl).toBeNull();
  });

  it("captures the agent's WhatsApp display name in metadata", () => {
    const result = normalizeInboundMessage(
      { ...base, ProfileName: "Jean-Baptiste Pierre" },
      "2026-05-22T00:00:00Z"
    );
    expect(result.metadata.profileName).toBe("Jean-Baptiste Pierre");
  });

  it("uses serverReceivedAt as agentTimestamp (Twilio sandbox limitation)", () => {
    // Twilio Sandbox doesn't expose the original WhatsApp send timestamp.
    // The normalizer falls back to server receipt time and the connectivity
    // monitor relies on this distinction once Meta Cloud API is wired in.
    const ts = "2026-05-22T12:34:56.789Z";
    const result = normalizeInboundMessage(base, ts);
    expect(result.serverReceivedAt).toBe(ts);
    expect(result.agentTimestamp).toBe(ts);
  });
});
