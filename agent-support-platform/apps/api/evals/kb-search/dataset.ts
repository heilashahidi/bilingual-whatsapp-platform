import type { ClassificationResult } from "@asp/shared";
import type { KbArticleForScoring } from "../../src/services/kb-search";

export interface KbSearchCase {
  input: {
    classification: ClassificationResult;
    articles: KbArticleForScoring[];
  };
  expected: {
    // IDs the human grader thinks should be in the top results, in order of
    // relevance (most relevant first).
    expectedIds: string[];
    // Articles that must NOT appear (clearly irrelevant matches).
    forbiddenIds?: string[];
  };
  metadata: { scenario: string };
}

// Each case is a self-contained retrieval scenario: a freshly-classified
// ticket plus a candidate pool of articles. The eval checks whether the
// scorer's top picks match the human-graded relevance ordering.
export const dataset: KbSearchCase[] = [
  // ── Exact category + productArea + tag match wins ─────────────────────────
  {
    input: {
      classification: {
        category: "bug_report",
        severity: "high",
        tags: ["app_crash", "transaction_failure"],
        productArea: "payments",
        confidence: 0.9,
        likelyNetwork: false,
      },
      articles: [
        { id: "a1", category: "bug_report", productArea: "payments", tags: ["app_crash"] },
        { id: "a2", category: "bug_report", productArea: "payments", tags: [] },
        { id: "a3", category: "bug_report", productArea: "lottery", tags: ["app_crash"] },
        { id: "a4", category: "question", productArea: "account", tags: [] },
      ],
    },
    expected: {
      expectedIds: ["a1", "a2"], // a1 is best (3/3 signals), a2 next (2/3)
      forbiddenIds: ["a4"],
    },
    metadata: { scenario: "exact match beats partial match" },
  },

  // ── Tag overlap rescues an otherwise-mismatched article ──────────────────
  {
    input: {
      classification: {
        category: "operational_complaint",
        severity: "medium",
        tags: ["lottery_results", "slow_load"],
        productArea: "lottery",
        confidence: 0.85,
        likelyNetwork: false,
      },
      articles: [
        { id: "b1", category: "operational_complaint", productArea: "lottery", tags: ["lottery_results"] },
        { id: "b2", category: "bug_report", productArea: "lottery", tags: ["lottery_results", "slow_load"] }, // different category, strong tags
        { id: "b3", category: "operational_complaint", productArea: "mobile_app", tags: [] },
        { id: "b4", category: "feature_request", productArea: "account", tags: [] },
      ],
    },
    expected: {
      expectedIds: ["b1", "b2"], // b1 perfect; b2 wrong category but strong tags + productArea
      forbiddenIds: ["b4"],
    },
    metadata: { scenario: "tag overlap pulls cross-category match in" },
  },

  // ── Empty articles list — no suggestions, no crash ───────────────────────
  {
    input: {
      classification: {
        category: "question",
        severity: "low",
        tags: [],
        productArea: "account",
        confidence: 0.9,
        likelyNetwork: false,
      },
      articles: [],
    },
    expected: { expectedIds: [] },
    metadata: { scenario: "empty pool returns empty" },
  },

  // ── All articles below threshold ─────────────────────────────────────────
  {
    input: {
      classification: {
        category: "feature_request",
        severity: "low",
        tags: ["dark_mode"],
        productArea: "mobile_app",
        confidence: 0.9,
        likelyNetwork: false,
      },
      articles: [
        { id: "c1", category: "bug_report", productArea: "lottery", tags: [] },
        { id: "c2", category: "question", productArea: "account", tags: [] },
        { id: "c3", category: "operational_complaint", productArea: "payments", tags: [] },
      ],
    },
    expected: { expectedIds: [] }, // all score below 0.34 threshold
    metadata: { scenario: "no article above threshold ⇒ empty suggestions (no false positives)" },
  },

  // ── Network-flagged ticket should pick connectivity articles ─────────────
  {
    input: {
      classification: {
        category: "operational_complaint",
        severity: "medium",
        tags: ["connectivity"],
        productArea: "mobile_app",
        confidence: 0.8,
        likelyNetwork: true,
      },
      articles: [
        { id: "d1", category: "operational_complaint", productArea: "mobile_app", tags: ["connectivity"] },
        { id: "d2", category: "operational_complaint", productArea: "mobile_app", tags: [] },
        { id: "d3", category: "bug_report", productArea: "payments", tags: ["transaction_failure"] },
      ],
    },
    expected: { expectedIds: ["d1", "d2"], forbiddenIds: ["d3"] },
    metadata: { scenario: "connectivity ticket prefers connectivity-tagged article" },
  },

  // ── Top-K cap: 5 strong matches must be trimmed to 3 ─────────────────────
  {
    input: {
      classification: {
        category: "bug_report",
        severity: "high",
        tags: ["app_crash"],
        productArea: "mobile_app",
        confidence: 0.9,
        likelyNetwork: false,
      },
      articles: [
        { id: "e1", category: "bug_report", productArea: "mobile_app", tags: ["app_crash"] },
        { id: "e2", category: "bug_report", productArea: "mobile_app", tags: ["app_crash"] },
        { id: "e3", category: "bug_report", productArea: "mobile_app", tags: ["app_crash"] },
        { id: "e4", category: "bug_report", productArea: "mobile_app", tags: ["app_crash"] },
        { id: "e5", category: "bug_report", productArea: "mobile_app", tags: ["app_crash"] },
      ],
    },
    expected: { expectedIds: ["e1", "e2", "e3"] }, // any 3, but order shouldn't matter when tied
    metadata: { scenario: "MAX_SUGGESTIONS cap holds at 3 even with 5 perfect ties" },
  },
];
