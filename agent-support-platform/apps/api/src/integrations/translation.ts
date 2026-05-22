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
    return translateWithClaude(text, targetLanguage);
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
    return translateWithClaude(text, targetLanguage);
  }
  return translateStub(text, targetLanguage);
}

// ─── Claude Haiku translation ───────────────────────────────
// Pragmatic choice: zero new infra (we already use Claude for
// classification), handles all 4 languages well, structured JSON
// output. ~300–500 ms latency, ~$0.0001 per translation. For
// production-grade quality + custom fintech glossaries, swap to
// translateWithGoogle below.

const LANG_NAMES: Record<string, string> = {
  en: "English",
  ht: "Haitian Creole",
  fr: "French",
  es: "Spanish",
};

async function translateWithClaude(
  text: string,
  targetLanguage: string
): Promise<TranslationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("  ⚠ No ANTHROPIC_API_KEY — falling back to stub translation");
    return translateStub(text, targetLanguage);
  }

  const targetName = LANG_NAMES[targetLanguage] || targetLanguage;

  const prompt = `Translate the message below into ${targetName}.

Reply with ONLY a JSON object. No prose, no markdown.

Shape:
{
  "translatedText": "<the translation>",
  "detectedLanguage": "<two-letter ISO code: en, ht, fr, or es>",
  "confidence": <number 0.0 to 1.0>
}

Rules:
- Preserve product/branch names, error strings, and numbers literally.
- If the source is already in ${targetName}, return it unchanged with confidence 1.0.
- Keep tone and register (a panicked agent stays panicked).

Message:
${text}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    console.error(`  ✗ Claude translation API error: ${response.status}`);
    return translateStub(text, targetLanguage);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text || "";

  try {
    const clean = content.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return {
      translatedText: parsed.translatedText || text,
      detectedLanguage: parsed.detectedLanguage || "unknown",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.85,
    };
  } catch {
    console.error("  ✗ Failed to parse Claude translation output:", content);
    return translateStub(text, targetLanguage);
  }
}

// ─── Google Cloud Translation (alternative — not currently used) ──────

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

  // In dev, just pass through the text untouched. Real translation requires
  // USE_REAL_TRANSLATION=true + Google Cloud credentials.
  return {
    translatedText: text,
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
