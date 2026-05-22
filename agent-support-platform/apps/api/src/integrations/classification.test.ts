import { describe, it, expect, beforeEach } from "vitest";
import { classifyMessage } from "./classification";

// These tests exercise the stub classifier (USE_REAL_CLASSIFICATION unset).
// The stub is keyword-based and deterministic, so we can assert exact outputs.

beforeEach(() => {
  delete process.env.USE_REAL_CLASSIFICATION;
});

describe("classifyMessage (stub)", () => {
  it("flags app crashes as bug_report", async () => {
    const r = await classifyMessage("The app keeps crashing on me");
    expect(r.category).toBe("bug_report");
    expect(r.tags).toContain("app_crash");
    expect(r.productArea).toBe("mobile_app");
  });

  it("escalates a bug report to critical when nothing works", async () => {
    // critical is gated on the bug_report branch + an escalation keyword
    // ("cannot" / "nothing works" / "completely"), so the input has to
    // contain both a bug keyword AND an escalation keyword.
    const r = await classifyMessage("App is broken, I cannot do anything");
    expect(r.category).toBe("bug_report");
    expect(r.severity).toBe("critical");
  });

  it("flags lottery delays as operational_complaint, not a bug", async () => {
    const r = await classifyMessage(
      "The lottery results are taking too long to come out"
    );
    expect(r.category).toBe("operational_complaint");
    expect(r.tags).toContain("lottery_results");
    expect(r.productArea).toBe("lottery");
  });

  it("flags transaction-related messages with the payments product area", async () => {
    const r = await classifyMessage("The payment transaction failed again");
    expect(r.tags).toContain("transaction_failure");
    expect(r.productArea).toBe("payments");
  });

  it("flags connectivity language as likelyNetwork (Haiti/DRC heuristic)", async () => {
    const r = await classifyMessage(
      "The internet is so slow today, app keeps timing out"
    );
    expect(r.likelyNetwork).toBe(true);
    expect(r.tags).toContain("connectivity");
  });

  it("does NOT flag a clean bug report as likelyNetwork", async () => {
    const r = await classifyMessage("App crashes when I press the send button");
    expect(r.likelyNetwork).toBe(false);
  });

  it("recognizes a feature request as low severity", async () => {
    const r = await classifyMessage(
      "It would be nice if we could see the transaction history"
    );
    expect(r.category).toBe("feature_request");
    expect(r.severity).toBe("low");
  });

  it("recognizes questions and classifies them as low severity", async () => {
    const r = await classifyMessage("How do I reset my password?");
    expect(r.category).toBe("question");
    expect(r.severity).toBe("low");
  });

  it("falls back to other/medium for ambiguous messages", async () => {
    const r = await classifyMessage("hello");
    expect(r.category).toBe("other");
    expect(r.severity).toBe("medium");
  });

  it("returns a confidence score between 0 and 1", async () => {
    const r = await classifyMessage("anything");
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });

  it("falls back to the stub when USE_REAL_CLASSIFICATION=true but no API key is set", async () => {
    process.env.USE_REAL_CLASSIFICATION = "true";
    delete process.env.ANTHROPIC_API_KEY;
    // Without an API key the implementation logs a warning and routes to
    // the stub. We assert it still returns a usable shape.
    const r = await classifyMessage("App crash");
    expect(r.category).toBe("bug_report");
  });
});
