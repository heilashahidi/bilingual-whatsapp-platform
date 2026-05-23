import { describe, it, expect } from "vitest";
import { buildIntakePrompt } from "./intake-prompter";

const base = {
  severity: "medium" as const,
  productArea: "mobile_app" as const,
  tags: [] as string[],
};

describe("buildIntakePrompt", () => {
  it("returns null for feature_request (operator handles when they get to it)", () => {
    expect(
      buildIntakePrompt({ ...base, category: "feature_request" })
    ).toBeNull();
  });

  it("returns null for question (don't ask follow-ups for ambiguous category)", () => {
    expect(buildIntakePrompt({ ...base, category: "question" })).toBeNull();
  });

  it("returns null for 'other' category", () => {
    expect(buildIntakePrompt({ ...base, category: "other" })).toBeNull();
  });

  it("returns bug-specific intake for bug_report", () => {
    const out = buildIntakePrompt({ ...base, category: "bug_report" });
    expect(out).toContain("app version");
    expect(out).toContain("error message");
    expect(out).toContain("screenshot");
  });

  it("returns transaction-specific intake for payments operational_complaint", () => {
    const out = buildIntakePrompt({
      ...base,
      category: "operational_complaint",
      productArea: "payments",
    });
    expect(out).toContain("Transaction reference");
    expect(out).toContain("Amount");
    expect(out).toContain("Customer's phone");
  });

  it("returns transaction-specific intake when tagged 'transaction_failure'", () => {
    // Same template applies regardless of productArea if the
    // classifier tagged it as a transaction issue.
    const out = buildIntakePrompt({
      ...base,
      category: "operational_complaint",
      productArea: "mobile_app",
      tags: ["transaction_failure"],
    });
    expect(out).toContain("Transaction reference");
  });

  it("returns hardware-specific intake for hardware operational_complaint", () => {
    const out = buildIntakePrompt({
      ...base,
      category: "operational_complaint",
      productArea: "hardware",
    });
    expect(out).toContain("Terminal ID");
    expect(out).toContain("LED");
  });

  it("returns generic ops intake when neither transactional nor hardware", () => {
    const out = buildIntakePrompt({
      ...base,
      category: "operational_complaint",
      productArea: "lottery",
    });
    expect(out).toContain("how often");
    expect(out).not.toContain("Transaction reference");
    expect(out).not.toContain("Terminal ID");
  });

  it("keeps every template under 480 chars so HT/DRC 2G doesn't split it", () => {
    const variants = [
      { ...base, category: "bug_report" as const },
      { ...base, category: "operational_complaint" as const, productArea: "payments" },
      { ...base, category: "operational_complaint" as const, productArea: "hardware" },
      { ...base, category: "operational_complaint" as const, productArea: "lottery" },
    ];
    for (const v of variants) {
      const out = buildIntakePrompt(v);
      expect(out).not.toBeNull();
      expect(out!.length).toBeLessThanOrEqual(480);
    }
  });
});
