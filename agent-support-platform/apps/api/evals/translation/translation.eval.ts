import { Eval } from "braintrust";
import { translateMessage } from "../../src/integrations/translation";
import { dataset } from "./dataset";
import {
  LanguageDetection,
  PreservationCheck,
  LengthSanity,
  PassThroughExact,
  AccuracyJudge,
  FluencyJudge,
} from "./scorers";

Eval("translation", {
  data: () =>
    dataset.map((c) => ({
      input: c.input,
      expected: c.expected,
      metadata: c.metadata,
    })),
  task: ({ text, targetLanguage }: { text: string; targetLanguage: string }) =>
    translateMessage(text, targetLanguage),
  scores: [
    LanguageDetection,
    PreservationCheck,
    LengthSanity,
    PassThroughExact,
    AccuracyJudge,
    FluencyJudge,
  ],
});
