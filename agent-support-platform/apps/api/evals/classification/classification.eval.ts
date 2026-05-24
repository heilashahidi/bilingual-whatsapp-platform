import { Eval } from "braintrust";
import { classifyMessage } from "../../src/integrations/classification";
import { dataset } from "./dataset";
import {
  CategoryMatch,
  SeverityProximity,
  ProductAreaMatch,
  ConnectivityFlag,
  ConfidenceCalibration,
  TagRecall,
} from "./scorers";

Eval("classification", {
  data: () =>
    dataset.map((c) => ({
      input: c.input,
      expected: c.expected,
      metadata: c.metadata,
    })),
  task: (input: string) => classifyMessage(input),
  scores: [
    CategoryMatch,
    SeverityProximity,
    ProductAreaMatch,
    ConnectivityFlag,
    ConfidenceCalibration,
    TagRecall,
  ],
});
