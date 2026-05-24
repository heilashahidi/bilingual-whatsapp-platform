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

Eval("incident-summarizer", {
  data: () =>
    dataset.map((c) => ({
      input: c.input,
      expected: c.expected,
      metadata: c.metadata,
    })),
  task: (input) => generateIncidentSummary(input),
  scores: [
    ProducesNonNull,
    TitleLength,
    TitleMentions,
    NoHallucinatedMentions,
    FaithfulnessJudge,
    ActionabilityJudge,
  ],
});
