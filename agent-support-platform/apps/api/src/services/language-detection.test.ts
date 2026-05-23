import { describe, it, expect } from "vitest";
import { isLikelyEnglish } from "./language-detection";

describe("isLikelyEnglish", () => {
  describe("true positives — clearly English text", () => {
    it("matches a basic English complaint", () => {
      expect(isLikelyEnglish("The app is completely down and I can't process payments.")).toBe(true);
    });

    it("matches a simple question", () => {
      expect(isLikelyEnglish("What is the deposit limit for today?")).toBe(true);
    });

    it("matches with contractions", () => {
      expect(isLikelyEnglish("I can't log in — it doesn't work.")).toBe(true);
    });

    it("matches a longer status update", () => {
      expect(isLikelyEnglish("My transaction failed three times in a row this morning at the branch.")).toBe(true);
    });
  });

  describe("true negatives — clearly non-English text", () => {
    it("rejects Haitian Creole", () => {
      expect(isLikelyEnglish("Mwen pa ka konekte ankò")).toBe(false);
    });

    it("rejects Spanish", () => {
      expect(isLikelyEnglish("Hola, necesito ayuda con la aplicación.")).toBe(false);
    });

    it("rejects French", () => {
      expect(isLikelyEnglish("Bonjour, je ne peux pas me connecter.")).toBe(false);
    });

    it("rejects text with accented Latin letters (è, ñ, ç)", () => {
      expect(isLikelyEnglish("Cap-Haïtien")).toBe(false);
      expect(isLikelyEnglish("aplicación")).toBe(false);
      expect(isLikelyEnglish("problème")).toBe(false);
    });

    it("allows unicode punctuation (em-dash, smart quotes, ellipsis) in English text", () => {
      // Operators on Macs auto-correct hyphens to em-dashes and quotes
      // to smart quotes. We shouldn't reject these as foreign.
      expect(isLikelyEnglish("I can't log in — it doesn't work.")).toBe(true);
      expect(isLikelyEnglish('The app is "really" broken today…')).toBe(true);
    });

    it("rejects mixed English wrapper with foreign tokens", () => {
      // "The bonjour problem" — has "the" but also "bonjour" → not English
      expect(isLikelyEnglish("The bonjour problem is back")).toBe(false);
    });
  });

  describe("conservative rejections — ambiguous text", () => {
    it("rejects empty string", () => {
      expect(isLikelyEnglish("")).toBe(false);
    });

    it("rejects whitespace-only", () => {
      expect(isLikelyEnglish("   ")).toBe(false);
    });

    it("rejects 'ok' / 'thx' / abbreviations with no function words", () => {
      // No function word → can't confirm English → pass to Claude.
      expect(isLikelyEnglish("ok thx")).toBe(false);
    });

    it("rejects a single noun (no function word)", () => {
      expect(isLikelyEnglish("application")).toBe(false);
    });

    it("rejects a product code or numeric content", () => {
      expect(isLikelyEnglish("ERROR_42301")).toBe(false);
      expect(isLikelyEnglish("5,000")).toBe(false);
    });
  });
});
