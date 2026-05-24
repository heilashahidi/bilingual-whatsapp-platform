import { Eval } from "braintrust";
import { generateIncidentSummary } from "../../src/services/incident-summarizer";
import { dataset } from "./dataset";
import {
  ProducesNonNull,
  TitleLength,
  TitleMentions,
  NoHallucinatedMentions,
  FaithfulnessJudge,
  ActionabilityJudge,
} from "./scorers";

const baseScores = [
  ProducesNonNull,
  TitleLength,
  TitleMentions,
  NoHallucinatedMentions,
];

const judgeScores = [FaithfulnessJudge, ActionabilityJudge];

Eval("incident-summarizer", {
  data: () =>
    dataset.map((c) => ({
      input: c.input,
      expected: c.expected,
      metadata: c.metadata,
    })),
  task: (input) => generateIncidentSummary(input),
  // Keep offline runs meaningful by skipping judge scorers without credentials.
  scores: process.env.ANTHROPIC_API_KEY ? [...baseScores, ...judgeScores] : baseScores,
});
