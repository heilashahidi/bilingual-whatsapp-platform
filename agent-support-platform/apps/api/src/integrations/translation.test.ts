import { describe, it, expect, beforeEach } from "vitest";
import { translateMessage, translateResponse } from "./translation";

beforeEach(() => {
  delete process.env.USE_REAL_TRANSLATION;
});

describe("translation stub (USE_REAL_TRANSLATION unset)", () => {
  it("detects Haitian Creole keywords", async () => {
    const r = await translateMessage("Mwen pa ka voye lajan", "en");
    expect(r.detectedLanguage).toBe("ht");
  });

  it("detects French keywords", async () => {
    const r = await translateMessage(
      "S'il vous plaît, j'ai un problème",
      "en"
    );
    expect(r.detectedLanguage).toBe("fr");
  });

  it("detects Spanish keywords", async () => {
    const r = await translateMessage(
      "Por favor, hay un problema con la aplicación",
      "en"
    );
    expect(r.detectedLanguage).toBe("es");
  });

  it("falls back to English when no other-language keywords appear", async () => {
    const r = await translateMessage("Hello, the app is broken", "en");
    expect(r.detectedLanguage).toBe("en");
  });

  it("returns the input text unchanged in stub mode (no [en→ht] prefix)", async () => {
    // The stub was reverted to passthrough so real WhatsApp deliveries don't
    // show debug markers to agents.
    const r = await translateMessage("Hello world", "en");
    expect(r.translatedText).toBe("Hello world");
  });

  it("translateResponse routes through the same stub path", async () => {
    const r = await translateResponse("Working on it", "ht");
    expect(r.translatedText).toBe("Working on it");
    expect(r.detectedLanguage).toBe("en");
  });

  it("returns a confidence score in [0, 1]", async () => {
    const r = await translateMessage("any text", "en");
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });

  it("falls back to stub when USE_REAL_TRANSLATION=true but no API key is set", async () => {
    process.env.USE_REAL_TRANSLATION = "true";
    delete process.env.ANTHROPIC_API_KEY;
    // No throw — function gracefully degrades. The caller never has to
    // try/catch around the translator.
    const r = await translateMessage("Hello", "en");
    expect(r).toMatchObject({
      translatedText: expect.any(String),
      detectedLanguage: expect.any(String),
      confidence: expect.any(Number),
    });
  });
});
