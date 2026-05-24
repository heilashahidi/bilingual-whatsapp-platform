import type { ClassificationResult } from "@asp/shared";

interface ScorerArgs {
  output: ClassificationResult;
  expected: ClassificationResult;
}

interface ScoreResult {
  name: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export async function CategoryMatch({ output, expected }: ScorerArgs): Promise<ScoreResult> {
  return {
    name: "category_match",
    score: output.category === expected.category ? 1 : 0,
    metadata: { predicted: output.category, expected: expected.category },
  };
}

// Distance metric on the 4-level severity ladder: same=1.0, adjacent=0.5,
// 2 apart=0.25, opposite=0. Adjacency is gentler than exact-match because a
// "high" vs "critical" misread is way less damaging than "low" vs "critical".
const SEVERITY_RANK: Record<ClassificationResult["severity"], number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

export async function SeverityProximity({ output, expected }: ScorerArgs): Promise<ScoreResult> {
  const diff = Math.abs(SEVERITY_RANK[output.severity] - SEVERITY_RANK[expected.severity]);
  const score = diff === 0 ? 1 : diff === 1 ? 0.5 : diff === 2 ? 0.25 : 0;
  return {
    name: "severity_proximity",
    score,
    metadata: { predicted: output.severity, expected: expected.severity, diff },
  };
}

export async function ProductAreaMatch({ output, expected }: ScorerArgs): Promise<ScoreResult> {
  return {
    name: "product_area_match",
    score: output.productArea === expected.productArea ? 1 : 0,
    metadata: { predicted: output.productArea, expected: expected.productArea },
  };
}

export async function ConnectivityFlag({ output, expected }: ScorerArgs): Promise<ScoreResult> {
  return {
    name: "connectivity_flag",
    score: output.likelyNetwork === expected.likelyNetwork ? 1 : 0,
    metadata: { predicted: output.likelyNetwork, expected: expected.likelyNetwork },
  };
}

// Confidence should track correctness: high confidence on correct answers, low
// confidence on wrong ones. Overconfident-and-wrong is the worst failure mode
// for downstream routing logic that gates on confidence < 0.7.
export async function ConfidenceCalibration({ output, expected }: ScorerArgs): Promise<ScoreResult> {
  const correct = output.category === expected.category;
  const confident = output.confidence >= 0.7;
  let score: number;
  if (correct && confident) score = 1;
  else if (correct && !confident) score = 0.5;
  else if (!correct && !confident) score = 0.7;
  else score = 0;
  return {
    name: "confidence_calibration",
    score,
    metadata: { confidence: output.confidence, correct, confident },
  };
}

// Jaccard similarity on tag sets. Empty-expected with empty-output counts as 1.
export async function TagOverlap({ output, expected }: ScorerArgs): Promise<ScoreResult> {
  const predicted = new Set(output.tags);
  const target = new Set(expected.tags);
  if (target.size === 0 && predicted.size === 0) {
    return { name: "tag_overlap", score: 1, metadata: { predicted: [], expected: [] } };
  }
  const intersection = [...predicted].filter((t) => target.has(t)).length;
  const union = new Set([...predicted, ...target]).size;
  return {
    name: "tag_overlap",
    score: union === 0 ? 0 : intersection / union,
    metadata: { predicted: [...predicted], expected: [...target], intersection, union },
  };
}
