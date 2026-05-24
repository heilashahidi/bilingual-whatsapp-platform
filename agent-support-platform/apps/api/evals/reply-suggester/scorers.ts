import { judgeWithClaude } from "../_lib/judge";
import type { ReplySuggestion } from "@asp/shared";
import type { ReplySuggesterContext } from "../../src/services/reply-suggester";

interface ScorerArgs {
  input: ReplySuggesterContext;
  output: ReplySuggestion[];
  expected: {
    mustReferenceFacts: string[];
    mustNotInvent: string[];
    desiredAction?: string;
  };
}

interface ScoreResult {
  name: string;
  score: number;
  metadata?: Record<string, unknown>;
}

const REQUIRED_TONES = ["direct", "empathetic", "investigative"] as const;

// --- Offline scorers --------------------------------------------------------

export async function HasThreeSuggestions({ output }: ScorerArgs): Promise<ScoreResult> {
  return {
    name: "has_three_suggestions",
    score: output.length === 3 ? 1 : 0,
    metadata: { count: output.length },
  };
}

export async function DistinctTones({ output }: ScorerArgs): Promise<ScoreResult> {
  const tones = output.map((s) => s.tone);
  const missing = REQUIRED_TONES.filter((t) => !tones.includes(t));
  return {
    name: "distinct_tones",
    score: missing.length === 0 ? 1 : 1 - missing.length / REQUIRED_TONES.length,
    metadata: { tones, missing },
  };
}

// Each suggestion should be 1–3 sentences. Roughly 30–500 chars covers that
// without being overly strict on punctuation style.
export async function LengthSanity({ output }: ScorerArgs): Promise<ScoreResult> {
  const out = output.map((s) => ({ tone: s.tone, len: s.text.length }));
  const bad = out.filter((s) => s.len < 30 || s.len > 500);
  return {
    name: "length_sanity",
    score: output.length === 0 ? 0 : 1 - bad.length / output.length,
    metadata: { lengths: out, bad },
  };
}

// At least ONE suggestion must reference each required fact verbatim. The
// operator can pick from the three, so it's sufficient that one cites the
// right details (e.g., the specific account number from the inbound message).
export async function FactReference({ output, expected }: ScorerArgs): Promise<ScoreResult> {
  const required = expected.mustReferenceFacts;
  if (required.length === 0) {
    return { name: "fact_reference", score: 1, metadata: { skipped: "no required facts" } };
  }
  const corpus = output.map((s) => s.text).join("\n");
  const missing = required.filter((f) => !corpus.includes(f));
  return {
    name: "fact_reference",
    score: 1 - missing.length / required.length,
    metadata: { required, missing },
  };
}

// --- LLM-as-judge scorers ---------------------------------------------------

const HALLUCINATION_PROMPT = (args: ScorerArgs) => {
  const conversation = args.input.conversation.map((m) => `[${m.who}]: ${m.text}`).join("\n");
  const kbBlock = args.input.kbHints.length
    ? args.input.kbHints.map((h) => `- ${h.title}: ${h.resolution}`).join("\n")
    : "(none)";
  const drafts = args.output.map((s) => `[${s.tone}]: ${s.text}`).join("\n");
  const forbidden = args.expected.mustNotInvent.length
    ? args.expected.mustNotInvent.join(", ")
    : "(none specified)";

  return `You are a strict fact-checker for support-reply drafts.

CONVERSATION CONTEXT:
${conversation}

TICKET METADATA: category=${args.input.category}, severity=${args.input.severity}, tags=[${args.input.tags.join(", ")}]

KB HINTS AVAILABLE TO THE DRAFTER:
${kbBlock}

DRAFTS TO CHECK:
${drafts}

EXPLICITLY-FLAGGED THINGS THAT MUST NOT BE INVENTED: ${forbidden}

Step 1: For each of the 3 drafts, identify any claim that is NOT supported by the conversation context, KB hints, or general support best practices.
Step 2: Score on 0.0–1.0:
- 1.0 = no hallucinations — every claim is grounded in the conversation or KB
- 0.7 = minor unsupported phrasing but no concrete invented facts
- 0.4 = at least one fabricated detail (version number, error code, timeline, person's name not given)
- 0.0 = multiple fabricated facts or directly contradicting the conversation

Reply with ONLY a JSON object. No prose, no markdown.
Shape: { "score": <0.0-1.0>, "rationale": "<one short sentence naming the worst offending draft, if any>" }`;
};

export async function HallucinationJudge(args: ScorerArgs): Promise<ScoreResult> {
  const result = await judgeWithClaude({ prompt: HALLUCINATION_PROMPT(args) });
  if (!result) return { name: "hallucination_judge", score: 0, metadata: { skipped: "no ANTHROPIC_API_KEY" } };
  return { name: "hallucination_judge", score: result.score, metadata: { rationale: result.rationale } };
}

const HELPFULNESS_PROMPT = (args: ScorerArgs) => {
  const conversation = args.input.conversation.map((m) => `[${m.who}]: ${m.text}`).join("\n");
  const drafts = args.output.map((s) => `[${s.tone}]: ${s.text}`).join("\n");
  const desired = args.expected.desiredAction ?? "(no specific action specified — judge based on what a senior operator would do)";

  return `You are an experienced support operations engineer grading reply drafts.

CONVERSATION:
${conversation}

DRAFTS:
${drafts}

IDEAL NEXT STEP: ${desired}

Score the BEST of the 3 drafts on 0.0–1.0 for how well it advances the conversation toward resolution:
- 1.0 = at least one draft offers the ideal action concretely and at the right tone
- 0.7 = the right action is implied but not concrete, or tone is slightly off
- 0.4 = drafts are generic acknowledgements without a real next step
- 0.0 = drafts would make the situation worse or are completely off-topic

Reply with ONLY a JSON object. No prose, no markdown.
Shape: { "score": <0.0-1.0>, "rationale": "<one short sentence>" }`;
};

export async function HelpfulnessJudge(args: ScorerArgs): Promise<ScoreResult> {
  const result = await judgeWithClaude({ prompt: HELPFULNESS_PROMPT(args) });
  if (!result) return { name: "helpfulness_judge", score: 0, metadata: { skipped: "no ANTHROPIC_API_KEY" } };
  return { name: "helpfulness_judge", score: result.score, metadata: { rationale: result.rationale } };
}
