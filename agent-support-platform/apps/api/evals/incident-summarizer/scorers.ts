import { judgeWithClaude } from "../_lib/judge";
import type { IncidentSummaryOutput, IncidentSummaryContext } from "../../src/services/incident-summarizer";

interface ScorerArgs {
  input: IncidentSummaryContext;
  output: IncidentSummaryOutput | null;
  expected: {
    titleShouldMention: string[];
    titleMustNotMention: string[];
    rootCauseHint: string;
  };
}

interface ScoreResult {
  name: string;
  score: number;
  metadata?: Record<string, unknown>;
}

// --- Offline scorers --------------------------------------------------------

// Hard contract: title length ≤120 chars (the function caps at 120). Catches
// a regression where the cap is removed and a multi-paragraph response leaks
// into the UI.
export async function TitleLength({ output }: ScorerArgs): Promise<ScoreResult> {
  if (!output) return { name: "title_length", score: 0, metadata: { skipped: "null output" } };
  const len = output.title.length;
  // 80 is the prompt target, 120 is the hard cap. Score 1 if ≤80, 0.5 if 81–120, 0 if >120.
  const score = len <= 80 ? 1 : len <= 120 ? 0.5 : 0;
  return { name: "title_length", score, metadata: { len } };
}

export async function ProducesNonNull({ output }: ScorerArgs): Promise<ScoreResult> {
  return {
    name: "produces_non_null",
    score: output && output.title && output.rootCause ? 1 : 0,
    metadata: { gotTitle: !!output?.title, gotRootCause: !!output?.rootCause },
  };
}

// Case-insensitive substring match — at least one expected mention must
// appear in the title.
export async function TitleMentions({ output, expected }: ScorerArgs): Promise<ScoreResult> {
  if (!output) return { name: "title_mentions", score: 0, metadata: { skipped: "null output" } };
  const wanted = expected.titleShouldMention;
  if (wanted.length === 0) return { name: "title_mentions", score: 1, metadata: { skipped: "no mentions specified" } };
  const titleLower = output.title.toLowerCase();
  const found = wanted.filter((w) => titleLower.includes(w.toLowerCase()));
  return {
    name: "title_mentions",
    score: found.length === 0 ? 0 : found.length / wanted.length,
    metadata: { wanted, found, title: output.title },
  };
}

export async function NoHallucinatedMentions({ output, expected }: ScorerArgs): Promise<ScoreResult> {
  if (!output) return { name: "no_hallucinated_mentions", score: 0, metadata: { skipped: "null output" } };
  const forbidden = expected.titleMustNotMention;
  if (forbidden.length === 0) return { name: "no_hallucinated_mentions", score: 1, metadata: { skipped: "none forbidden" } };
  const titleLower = output.title.toLowerCase();
  const violations = forbidden.filter((f) => titleLower.includes(f.toLowerCase()));
  return {
    name: "no_hallucinated_mentions",
    score: violations.length === 0 ? 1 : 0,
    metadata: { forbidden, violations, title: output.title },
  };
}

// --- LLM-as-judge scorers ---------------------------------------------------

const FAITHFULNESS_PROMPT = (args: ScorerArgs) => {
  const reports = args.input.tickets
    .map((t, i) => `${i + 1}. [${t.branchName}, ${t.country}] "${t.firstMessageText}" tags=[${t.tags.join(", ")}]`)
    .join("\n");

  const output = args.output
    ? `TITLE: ${args.output.title}\nROOT CAUSE: ${args.output.rootCause}`
    : "(null)";

  return `You are a strict fact-checker for incident summaries.

INCIDENT REPORTS (everything the summary author had access to):
${reports}

CATEGORY: ${args.input.category} · SEVERITY: ${args.input.severity}

SUMMARY UNDER REVIEW:
${output}

Step 1: Identify any claim in TITLE or ROOT CAUSE that is NOT supported by the reports above.
Step 2: Score on 0.0–1.0:
- 1.0 = every claim is supported by the reports (or is reasonable general inference)
- 0.7 = mostly faithful but adds minor unsupported qualifier
- 0.4 = invents at least one specific detail not in the reports (version number, error code, person, ETA)
- 0.0 = invents multiple specifics or contradicts the reports

Reply with ONLY a JSON object. No prose, no markdown.
Shape: { "score": <0.0-1.0>, "rationale": "<one short sentence naming any invented fact>" }`;
};

export async function FaithfulnessJudge(args: ScorerArgs): Promise<ScoreResult> {
  const result = await judgeWithClaude({ prompt: FAITHFULNESS_PROMPT(args) });
  if (!result) return { name: "faithfulness_judge", score: 0, metadata: { skipped: "no ANTHROPIC_API_KEY" } };
  return { name: "faithfulness_judge", score: result.score, metadata: { rationale: result.rationale } };
}

const ACTIONABILITY_PROMPT = (args: ScorerArgs) => {
  const reports = args.input.tickets
    .map((t, i) => `${i + 1}. [${t.branchName}] "${t.firstMessageText}"`)
    .join("\n");

  const output = args.output
    ? `TITLE: ${args.output.title}\nROOT CAUSE: ${args.output.rootCause}`
    : "(null)";

  return `You are a senior on-call engineer grading incident summaries for actionability.

REPORTS:
${reports}

SUMMARY:
${output}

IDEAL NEXT-STEP HINT (what a senior engineer would do): ${args.expected.rootCauseHint}

Score on 0.0–1.0 how useful this summary is for an on-call engineer waking up to a page:
- 1.0 = title is specific & scannable, root cause names a concrete service/component and proposes a concrete next step
- 0.7 = useful but vague on either the cause or the next step
- 0.4 = generic restatement of the reports without diagnostic insight
- 0.0 = misleading or actively confusing — would send oncall in the wrong direction

Reply with ONLY a JSON object. No prose, no markdown.
Shape: { "score": <0.0-1.0>, "rationale": "<one short sentence>" }`;
};

export async function ActionabilityJudge(args: ScorerArgs): Promise<ScoreResult> {
  const result = await judgeWithClaude({ prompt: ACTIONABILITY_PROMPT(args) });
  if (!result) return { name: "actionability_judge", score: 0, metadata: { skipped: "no ANTHROPIC_API_KEY" } };
  return { name: "actionability_judge", score: result.score, metadata: { rationale: result.rationale } };
}
