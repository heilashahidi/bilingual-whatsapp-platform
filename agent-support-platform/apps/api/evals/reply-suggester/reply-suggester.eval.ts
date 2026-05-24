import { Eval } from "braintrust";
import { generateReplySuggestions } from "../../src/services/reply-suggester";
import { dataset } from "./dataset";
import {
  HasThreeSuggestions,
  DistinctTones,
  LengthSanity,
  FactReference,
  HallucinationJudge,
  HelpfulnessJudge,
} from "./scorers";

const baseScores = [
  HasThreeSuggestions,
  DistinctTones,
  LengthSanity,
  FactReference,
];

const judgeScores = [HallucinationJudge, HelpfulnessJudge];

Eval("reply-suggester", {
  data: () =>
    dataset.map((c) => ({
      input: c.input,
      expected: c.expected,
      metadata: c.metadata,
    })),
  task: (input) => generateReplySuggestions(input),
  // Avoid penalizing local runs when judge credentials are intentionally absent.
  scores: process.env.ANTHROPIC_API_KEY ? [...baseScores, ...judgeScores] : baseScores,
});
