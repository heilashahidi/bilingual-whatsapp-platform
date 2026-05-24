import { Eval } from "braintrust";
import { scoreKbMatches } from "../../src/services/kb-search";
import { dataset } from "./dataset";
import { Recall, Precision, MRR, NoForbidden, ScoresInRange } from "./scorers";

Eval("kb-search", {
  data: () =>
    dataset.map((c) => ({
      input: c.input,
      expected: c.expected,
      metadata: c.metadata,
    })),
  task: ({ classification, articles }) => scoreKbMatches(classification, articles),
  scores: [Recall, Precision, MRR, NoForbidden, ScoresInRange],
});
