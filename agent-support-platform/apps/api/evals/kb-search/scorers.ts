import type { ScoredArticle } from "../../src/services/kb-search";

interface ScorerArgs {
  output: ScoredArticle[];
  expected: {
    expectedIds: string[];
    forbiddenIds?: string[];
  };
}

interface ScoreResult {
  name: string;
  score: number;
  metadata?: Record<string, unknown>;
}

// Recall: of the IDs the human grader marked as relevant, how many showed up
// in the model's top-K? Empty-expected with empty-output counts as 1.
export async function Recall({ output, expected }: ScorerArgs): Promise<ScoreResult> {
  const target = new Set(expected.expectedIds);
  if (target.size === 0) {
    return {
      name: "recall",
      score: output.length === 0 ? 1 : 0,
      metadata: { note: "empty expected — penalize any output", got: output.map((o) => o.id) },
    };
  }
  const hit = output.filter((o) => target.has(o.id)).length;
  return {
    name: "recall",
    score: hit / target.size,
    metadata: { expected: [...target], got: output.map((o) => o.id), hit },
  };
}

// Precision: of the IDs the model returned, how many were actually relevant?
// Empty-expected with empty-output ⇒ 1. Output with non-empty expected ⇒
// hit/output.length.
export async function Precision({ output, expected }: ScorerArgs): Promise<ScoreResult> {
  const target = new Set(expected.expectedIds);
  if (output.length === 0) {
    return {
      name: "precision",
      score: target.size === 0 ? 1 : 0,
      metadata: { note: "empty output", expected: [...target] },
    };
  }
  const hit = output.filter((o) => target.has(o.id)).length;
  return {
    name: "precision",
    score: hit / output.length,
    metadata: { expected: [...target], got: output.map((o) => o.id), hit },
  };
}

// Mean reciprocal rank of the first relevant hit. 1.0 if rank-1 is relevant,
// 0.5 if rank-2 is the first relevant, 0.33 if rank-3, 0 if no hit.
// Empty-expected with empty-output ⇒ 1.
export async function MRR({ output, expected }: ScorerArgs): Promise<ScoreResult> {
  const target = new Set(expected.expectedIds);
  if (target.size === 0) {
    return { name: "mrr", score: output.length === 0 ? 1 : 0, metadata: { note: "empty expected" } };
  }
  for (let i = 0; i < output.length; i++) {
    if (target.has(output[i].id)) {
      return {
        name: "mrr",
        score: 1 / (i + 1),
        metadata: { rank: i + 1, hitId: output[i].id },
      };
    }
  }
  return { name: "mrr", score: 0, metadata: { note: "no relevant hit in output", got: output.map((o) => o.id) } };
}

// Hard constraint: forbidden articles should never appear. 0 if any forbidden
// ID is in the output; 1 otherwise. Surfaces false-positive ranking bugs.
export async function NoForbidden({ output, expected }: ScorerArgs): Promise<ScoreResult> {
  const forbidden = new Set(expected.forbiddenIds ?? []);
  if (forbidden.size === 0) {
    return { name: "no_forbidden", score: 1, metadata: { skipped: "no forbidden IDs" } };
  }
  const violations = output.filter((o) => forbidden.has(o.id)).map((o) => o.id);
  return {
    name: "no_forbidden",
    score: violations.length === 0 ? 1 : 0,
    metadata: { forbidden: [...forbidden], violations },
  };
}

// Score range health: all returned scores should be in (0.34, 1.0]. The
// scorer's filter is 0.34; any 0/negative/>1 slipping through is a regression.
export async function ScoresInRange({ output }: ScorerArgs): Promise<ScoreResult> {
  if (output.length === 0) return { name: "scores_in_range", score: 1, metadata: { skipped: "empty output" } };
  const bad = output.filter((o) => o.score < 0.34 || o.score > 1.0);
  return {
    name: "scores_in_range",
    score: 1 - bad.length / output.length,
    metadata: { allScores: output.map((o) => ({ id: o.id, score: Number(o.score.toFixed(2)) })), bad },
  };
}
