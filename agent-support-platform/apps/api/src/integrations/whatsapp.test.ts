import { describe, it, expect, beforeEach, vi } from "vitest";

// Force the Twilio side-effect into stub mode — sendWhatsAppMessage returns
// a fake SID instead of calling the real API.
process.env.USE_REAL_WHATSAPP = "false";

vi.mock("./translation", () => ({
  translateResponse: vi.fn(),
}));

import { sendAgentResponse } from "./whatsapp";
import { translateResponse } from "./translation";

const translateResponseMock = translateResponse as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendAgentResponse", () => {
  it("skips translation when the target language is English", async () => {
    const result = await sendAgentResponse(
      "+50937001001",
      "Please restart the app.",
      "en",
      "HT"
    );

    expect(translateResponseMock).not.toHaveBeenCalled();
    // Without translation, the English passes through verbatim.
    expect(result.translatedText).toBe("Please restart the app.");
  });

  it("translates to the target language when it isn't English", async () => {
    translateResponseMock.mockResolvedValue({
      translatedText: "Tanpri rekòmanse aplikasyon an.",
      detectedLanguage: "en",
      confidence: 0.95,
    });

    const result = await sendAgentResponse(
      "+50937001001",
      "Please restart the app.",
      "ht",
      "HT"
    );

    expect(translateResponseMock).toHaveBeenCalledWith(
      "Please restart the app.",
      "ht"
    );
    expect(result.translatedText).toBe("Tanpri rekòmanse aplikasyon an.");
  });

  it("truncates messages that exceed the country length limit (HT = 1000)", async () => {
    // 1200-char Creole reply blows past Haiti's 1000-char limit
    translateResponseMock.mockResolvedValue({
      translatedText: "a".repeat(1200),
      detectedLanguage: "en",
      confidence: 0.95,
    });

    const result = await sendAgentResponse(
      "+50937001001",
      "doesn't matter",
      "ht",
      "HT"
    );

    expect(result.translatedText.length).toBeLessThanOrEqual(1000);
    expect(result.translatedText).toContain("[Reply MORE for the rest]");
  });

  it("uses the higher 2000-char cap for Dominican Republic", async () => {
    translateResponseMock.mockResolvedValue({
      translatedText: "b".repeat(1800),
      detectedLanguage: "en",
      confidence: 0.95,
    });

    const result = await sendAgentResponse("+18091234567", "doesn't matter", "es", "DO");

    expect(result.translatedText.length).toBe(1800);
    expect(result.translatedText).not.toContain("[Reply MORE for the rest]");
  });

  it("returns a Twilio message sid (stub mode returns STUB_<ts>)", async () => {
    const result = await sendAgentResponse("+50937001001", "Hello", "en", "HT");
    // Stub returns STUB_<timestamp> — just check it's a non-empty string.
    expect(result.messageSid).toMatch(/^STUB_\d+$/);
  });

  it("treats falsy target language as English (no translation)", async () => {
    const result = await sendAgentResponse(
      "+50937001001",
      "Hi there.",
      "",
      "HT"
    );
    expect(translateResponseMock).not.toHaveBeenCalled();
    expect(result.translatedText).toBe("Hi there.");
  });
});
