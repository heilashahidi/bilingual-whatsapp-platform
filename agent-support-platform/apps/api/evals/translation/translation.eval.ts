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

const baseScores = [
  LanguageDetection,
  PreservationCheck,
  LengthSanity,
  PassThroughExact,
];

const judgeScores = [AccuracyJudge, FluencyJudge];

Eval("translation", {
  data: () =>
    dataset.map((c) => ({
      input: c.input,
      expected: c.expected,
      metadata: c.metadata,
    })),
  task: ({ text, targetLanguage }: { text: string; targetLanguage: string }) =>
    translateMessage(text, targetLanguage),
  // Register judge-based scorers only when the key is available so missing
  // credentials produce true "skip" behavior rather than synthetic failures.
  scores: process.env.ANTHROPIC_API_KEY ? [...baseScores, ...judgeScores] : baseScores,
});
