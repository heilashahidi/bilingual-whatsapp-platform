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

Eval("reply-suggester", {
  data: () =>
    dataset.map((c) => ({
      input: c.input,
      expected: c.expected,
      metadata: c.metadata,
    })),
  task: (input) => generateReplySuggestions(input),
  scores: [
    HasThreeSuggestions,
    DistinctTones,
    LengthSanity,
    FactReference,
    HallucinationJudge,
    HelpfulnessJudge,
  ],
});
