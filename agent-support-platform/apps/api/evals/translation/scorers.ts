import { judgeWithClaude } from "./judge";

interface TranslationOutput {
  translatedText: string;
  detectedLanguage: string;
  confidence: number;
}

interface ExpectedTranslation {
  sourceLanguage: string;
  referenceTranslation: string;
  preservedTokens?: string[];
  passThrough?: boolean;
}

interface ScorerArgs {
  input: { text: string; targetLanguage: string };
  output: TranslationOutput;
  expected: ExpectedTranslation;
}

interface ScoreResult {
  name: string;
  score: number;
  metadata?: Record<string, unknown>;
}

// --- Offline scorers (no API key required) ----------------------------------

export async function LanguageDetection({ output, expected }: ScorerArgs): Promise<ScoreResult> {
  return {
    name: "language_detection",
    score: output.detectedLanguage === expected.sourceLanguage ? 1 : 0,
    metadata: { predicted: output.detectedLanguage, expected: expected.sourceLanguage },
  };
}

// Every preservedToken must appear verbatim in the output. Numbers, error
// codes, currency codes, and reference IDs can't be paraphrased.
export async function PreservationCheck({ output, expected }: ScorerArgs): Promise<ScoreResult> {
  const tokens = expected.preservedTokens ?? [];
  if (tokens.length === 0) {
    return { name: "preservation", score: 1, metadata: { tokens: [], skipped: "no preservedTokens" } };
  }
  const missing = tokens.filter((t) => !output.translatedText.includes(t));
  return {
    name: "preservation",
    score: 1 - missing.length / tokens.length,
    metadata: { tokens, missing },
  };
}

// Sanity: translated length within 0.5x–2x of the reference, character-wise.
// Catches truncation and runaway generation.
export async function LengthSanity({ output, expected }: ScorerArgs): Promise<ScoreResult> {
  const outLen = output.translatedText.length;
  const refLen = expected.referenceTranslation.length;
  if (refLen === 0) return { name: "length_sanity", score: 1, metadata: { skipped: "empty reference" } };
  const ratio = outLen / refLen;
  const ok = ratio >= 0.5 && ratio <= 2.0;
  return {
    name: "length_sanity",
    score: ok ? 1 : 0,
    metadata: { outLen, refLen, ratio: Number(ratio.toFixed(2)) },
  };
}

// Pass-through correctness: source==target language ⇒ output==input byte-for-byte
// AND confidence==1.0. Production code documents this contract; this scorer
// enforces it. Non-pass-through cases get a neutral 1.0 (skipped).
export async function PassThroughExact({ input, output, expected }: ScorerArgs): Promise<ScoreResult> {
  if (!expected.passThrough) {
    return { name: "pass_through_exact", score: 1, metadata: { skipped: "not a pass-through case" } };
  }
  const textMatch = output.translatedText === input.text;
  const confidenceOk = output.confidence >= 0.99;
  const score = textMatch && confidenceOk ? 1 : 0;
  return {
    name: "pass_through_exact",
    score,
    metadata: { textMatch, confidence: output.confidence, expectedText: input.text, gotText: output.translatedText },
  };
}

// --- LLM-as-judge scorers (require ANTHROPIC_API_KEY) ------------------------

const LANG_NAMES: Record<string, string> = {
  en: "English",
  ht: "Haitian Creole",
  fr: "French",
  es: "Spanish",
};

const ACCURACY_PROMPT = (args: ScorerArgs) => {
  const sourceLang = LANG_NAMES[args.expected.sourceLanguage] ?? args.expected.sourceLanguage;
  const targetLang = LANG_NAMES[args.input.targetLanguage] ?? args.input.targetLanguage;
  return `You are a bilingual translation evaluator fluent in English, Haitian Creole, French, and Spanish.

Step 1: Identify the language of the MODEL OUTPUT below. This is mandatory.
Step 2: If the model output is NOT written in ${targetLang}, score = 0.0. Do not consider meaning. The translator failed at its only job.
Step 3: Only if step 2 passed, score semantic accuracy against the reference.

Source (${sourceLang}): ${args.input.text}
Reference translation (${targetLang}): ${args.expected.referenceTranslation}
Model output: ${args.output.translatedText}

Accuracy rubric (only applied if the output IS in ${targetLang}):
- 1.0 = same meaning as reference, idiomatic ${targetLang}
- 0.7 = same meaning, awkward or non-native ${targetLang}
- 0.4 = partial meaning loss or significant register drift
- 0.0 = wrong meaning or missing key information

Reply with ONLY a JSON object. No prose, no markdown.
Shape: { "outputLanguage": "<language you identified>", "score": <0.0-1.0>, "rationale": "<one short sentence>" }`;
};

export async function AccuracyJudge(args: ScorerArgs): Promise<ScoreResult> {
  const result = await judgeWithClaude({ prompt: ACCURACY_PROMPT(args) });
  if (!result) {
    return { name: "accuracy_judge", score: 0, metadata: { skipped: "no ANTHROPIC_API_KEY or judge call failed" } };
  }
  return { name: "accuracy_judge", score: result.score, metadata: { rationale: result.rationale } };
}

const FLUENCY_PROMPT = (args: ScorerArgs) => {
  const targetLang = LANG_NAMES[args.input.targetLanguage] ?? args.input.targetLanguage;
  return `You are a native ${targetLang} speaker grading text quality.

Step 1: Identify the language the TEXT is actually written in. This is mandatory.
Step 2: If the text is NOT in ${targetLang}, score = 0.0. The fluency rubric does not apply because there is no ${targetLang} to grade.
Step 3: Only if step 2 passed, score grammar/idiom/naturalness.

Text to grade: ${args.output.translatedText}

Fluency rubric (only applied if the text IS in ${targetLang}):
- 1.0 = sounds like a native ${targetLang} speaker wrote it
- 0.7 = grammatical but slightly awkward ${targetLang}
- 0.4 = noticeable ${targetLang} errors or unnatural phrasing
- 0.0 = ungrammatical ${targetLang}

Reply with ONLY a JSON object. No prose, no markdown.
Shape: { "textLanguage": "<language you identified>", "score": <0.0-1.0>, "rationale": "<one short sentence>" }`;
};

export async function FluencyJudge(args: ScorerArgs): Promise<ScoreResult> {
  const result = await judgeWithClaude({ prompt: FLUENCY_PROMPT(args) });
  if (!result) {
    return { name: "fluency_judge", score: 0, metadata: { skipped: "no ANTHROPIC_API_KEY or judge call failed" } };
  }
  return { name: "fluency_judge", score: result.score, metadata: { rationale: result.rationale } };
}
