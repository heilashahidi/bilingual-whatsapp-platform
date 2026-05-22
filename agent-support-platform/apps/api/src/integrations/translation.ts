/**
 * Translation service integration.
 *
 * In production: Google Cloud Translation API v3 (Advanced)
 * In development: Stub that passes through text with mock detection
 *
 * To switch to production:
 *   1. npm install @google-cloud/translate
 *   2. Set GOOGLE_APPLICATION_CREDENTIALS in .env
 *   3. Set USE_REAL_TRANSLATION=true in .env
 */

interface TranslationResult {
  translatedText: string;
  detectedLanguage: string;
  confidence: number;
}

export async function translateMessage(
  text: string,
  targetLanguage: string
): Promise<TranslationResult> {
  if (process.env.USE_REAL_TRANSLATION === "true") {
    return translateWithGoogle(text, targetLanguage);
  }
  return translateStub(text, targetLanguage);
}

/**
 * Translate a response from English back to the agent's language.
 * Used for outbound messages.
 */
export async function translateResponse(
  text: string,
  targetLanguage: string
): Promise<TranslationResult> {
  if (process.env.USE_REAL_TRANSLATION === "true") {
    return translateWithGoogle(text, targetLanguage);
  }
  return translateStub(text, targetLanguage);
}

// ─── Google Cloud Translation (production) ──────────────────

async function translateWithGoogle(
  text: string,
  targetLanguage: string
): Promise<TranslationResult> {
  // Dynamic import so it doesn't fail if the package isn't installed
  const { TranslationServiceClient } = await import("@google-cloud/translate").then(
    (m) => m.v3
  );

  const client = new TranslationServiceClient();
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID!;
  const location = "global";
  const parent = `projects/${projectId}/locations/${location}`;

  const [response] = await client.translateText({
    parent,
    contents: [text],
    targetLanguageCode: targetLanguage,
    // Custom glossary for fintech/product terms
    // glossaryConfig: {
    //   glossary: `projects/${projectId}/locations/${location}/glossaries/agent-support-glossary`,
    // },
  });

  const translation = response.translations?.[0];
  if (!translation) {
    throw new Error("No translation returned from Google");
  }

  return {
    translatedText: translation.translatedText || text,
    detectedLanguage: translation.detectedLanguageCode || "unknown",
    confidence: 0.9, // Google doesn't return a confidence score; default high
  };
}

// ─── Development stub ───────────────────────────────────────

async function translateStub(
  text: string,
  targetLanguage: string
): Promise<TranslationResult> {
  // Simple language detection heuristic for dev
  const detectedLanguage = detectLanguageStub(text);

  console.log(`  [STUB] Translate: "${text.substring(0, 50)}..." (${detectedLanguage} → ${targetLanguage})`);

  // In dev, just pass through the text with a prefix
  return {
    translatedText: detectedLanguage === targetLanguage ? text : `[${detectedLanguage}→${targetLanguage}] ${text}`,
    detectedLanguage,
    confidence: 0.85,
  };
}

function detectLanguageStub(text: string): string {
  const lower = text.toLowerCase();
  // Very rough heuristic — just for dev
  if (lower.includes("mwen") || lower.includes("pou") || lower.includes("pa ka")) return "ht";
  if (lower.includes("por favor") || lower.includes("problema") || lower.includes("aplicación")) return "es";
  if (lower.includes("je ne") || lower.includes("s'il vous") || lower.includes("problème")) return "fr";
  return "en";
}
