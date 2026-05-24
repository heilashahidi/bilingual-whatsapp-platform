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

// ─── In-memory translation cache ────────────────────────────
// Same English phrase → same Spanish/Creole/French output. Canned
// intake prompts, "Your ticket has been resolved", auto-acknowledgments,
// and operator templates all hit repeatedly — caching cuts the
// ~300-500ms Claude call to a Map lookup. Cache key is target+text
// (source is auto-detected by Claude, so the result is target-keyed).
//
// LRU bound (1000 entries) keeps memory predictable in a long-running
// process. Per-entry size dominated by the translated string, so worst
// case ~2MB (1000 × 2KB messages). TTL avoids serving stale glossary
// translations after a prompt change.
const TRANSLATION_CACHE_MAX = 1000;
const TRANSLATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

type CacheEntry = { result: TranslationResult; expiresAt: number };
const translationCache = new Map<string, CacheEntry>();

function cacheKey(text: string, targetLanguage: string): string {
  return `${targetLanguage}::${text}`;
}

function cacheGet(text: string, targetLanguage: string): TranslationResult | null {
  const key = cacheKey(text, targetLanguage);
  const entry = translationCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    translationCache.delete(key);
    return null;
  }
  // LRU: re-insert to move to most-recent
  translationCache.delete(key);
  translationCache.set(key, entry);
  return entry.result;
}

function cacheSet(text: string, targetLanguage: string, result: TranslationResult): void {
  const key = cacheKey(text, targetLanguage);
  translationCache.set(key, { result, expiresAt: Date.now() + TRANSLATION_CACHE_TTL_MS });
  // Evict oldest if over bound (Map preserves insertion order).
  if (translationCache.size > TRANSLATION_CACHE_MAX) {
    const oldest = translationCache.keys().next().value;
    if (oldest !== undefined) translationCache.delete(oldest);
  }
}

export function _resetTranslationCacheForTests(): void {
  translationCache.clear();
}

async function translateCached(
  text: string,
  targetLanguage: string
): Promise<TranslationResult> {
  const hit = cacheGet(text, targetLanguage);
  if (hit) {
    console.log(`  ⚡ Translation cache hit (${targetLanguage}, ${text.length} chars)`);
    return hit;
  }
  const result =
    process.env.USE_REAL_TRANSLATION === "true"
      ? await translateWithClaude(text, targetLanguage)
      : await translateStub(text, targetLanguage);
  // Only cache confident successes — a stub fallback or low-confidence
  // result shouldn't poison future lookups.
  if (result.confidence >= 0.7) {
    cacheSet(text, targetLanguage, result);
  }
  return result;
}

export async function translateMessage(
  text: string,
  targetLanguage: string
): Promise<TranslationResult> {
  return translateCached(text, targetLanguage);
}

/**
 * Translate a response from English back to the agent's language.
 * Used for outbound messages.
 */
export async function translateResponse(
  text: string,
  targetLanguage: string
): Promise<TranslationResult> {
  return translateCached(text, targetLanguage);
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

  const data = (await response.json()) as {
    content?: Array<{ text?: string }>;
  };
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
