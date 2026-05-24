import { ClassificationResult } from "@asp/shared";

/**
 * Classify an inbound message into category, severity, tags, and product area.
 *
 * In production: Claude Haiku or GPT-4o-mini via API
 * In development: Keyword-based stub
 *
 * To switch to production:
 *   1. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env
 *   2. Set USE_REAL_CLASSIFICATION=true in .env
 */

export async function classifyMessage(englishText: string): Promise<ClassificationResult> {
  if (process.env.USE_REAL_CLASSIFICATION === "true") {
    return classifyWithLLM(englishText);
  }
  return classifyStub(englishText);
}

const CLASSIFICATION_PROMPT = `You are a support ticket classifier for a fintech platform operating in Haiti, Dominican Republic, and DRC.

The agent message below may be in English, Haitian Creole, French, or Spanish — classify based on meaning regardless of source language. If the language is unfamiliar or the meaning is ambiguous, lower your confidence score accordingly (the pipeline will re-classify on a translated copy when confidence < 0.7).

Classify into structured JSON. Respond with ONLY valid JSON, no markdown.

Categories: bug_report, operational_complaint, feature_request, question, other
Severity:
  - critical: Agent cannot process ANY transactions; app completely down; security incident
  - high: Significant function broken; repeated transaction failures; data/money discrepancy
  - medium: Intermittent issue; slow performance; non-blocking complaint
  - low: Feature request; cosmetic issue; general question
Product areas: mobile_app, payments, lottery, account, hardware, other
likely_network: true if the issue sounds like a connectivity/internet problem rather than an app bug

Tags — choose ZERO OR MORE from this CONTROLLED VOCABULARY ONLY. Do not invent new tag names. If nothing fits, return an empty array:
  - app_crash             (app crashes, force-closes, fails to launch)
  - transaction_failure   (money transfer fails, payment rejected, balance discrepancy)
  - lottery_results       (lottery draw results, betting outcomes)
  - slow_payout           (commission delayed, settlement late)
  - password_reset        (login, password, account recovery)
  - connectivity          (network/wifi/signal-related symptoms)
  - slow_load             (page or feature takes too long; not connectivity-attributable)
  - ui_request            (cosmetic, dark mode, layout, accessibility)
  - hardware              (printer, scanner, POS, device-side problems)

Output format (all field NAMES and tag values in English regardless of source language):
{
  "category": "...",
  "severity": "...",
  "tags": ["tag1", "tag2"],
  "productArea": "...",
  "confidence": 0.0-1.0,
  "likelyNetwork": false
}

Agent message: `;

async function classifyWithLLM(text: string): Promise<ClassificationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.warn("  ⚠ No ANTHROPIC_API_KEY set — falling back to stub classifier");
    return classifyStub(text);
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: CLASSIFICATION_PROMPT + text,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as {
    content?: Array<{ text?: string }>;
  };
  const content = data.content?.[0]?.text || "";

  try {
    const clean = content.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return {
      category: parsed.category || "other",
      severity: parsed.severity || "medium",
      tags: parsed.tags || [],
      productArea: parsed.productArea || "other",
      confidence: parsed.confidence || 0.8,
      likelyNetwork: parsed.likelyNetwork || false,
    };
  } catch {
    console.error("  ✗ Failed to parse LLM classification output:", content);
    return classifyStub(text);
  }
}

function classifyStub(text: string): ClassificationResult {
  const lower = text.toLowerCase();
  const result: ClassificationResult = {
    category: "other",
    severity: "medium",
    tags: [],
    productArea: "other",
    confidence: 0.7,
    likelyNetwork: false,
  };

  if (lower.includes("crash") || lower.includes("error") || lower.includes("bug") || lower.includes("broken")) {
    result.category = "bug_report";
    result.tags.push("app_crash");
    result.productArea = "mobile_app";
    if (lower.includes("cannot") || lower.includes("nothing works") || lower.includes("completely")) {
      result.severity = "critical";
    } else {
      result.severity = "high";
    }
  } else if (lower.includes("slow") || lower.includes("taking too long") || lower.includes("waiting")) {
    result.category = "operational_complaint";
    result.severity = "medium";
    if (lower.includes("lottery")) {
      result.tags.push("lottery_results");
      result.productArea = "lottery";
    }
  } else if (lower.includes("would be nice") || lower.includes("feature") || lower.includes("wish") || lower.includes("should add")) {
    result.category = "feature_request";
    result.severity = "low";
  } else if (lower.includes("how do") || lower.includes("how to") || lower.includes("what is") || lower.includes("?")) {
    result.category = "question";
    result.severity = "low";
  }

  if (lower.includes("internet") || lower.includes("connection") || lower.includes("network") ||
      lower.includes("loading") || lower.includes("timeout") || lower.includes("wifi") ||
      lower.includes("signal") || lower.includes("offline")) {
    result.likelyNetwork = true;
    result.tags.push("connectivity");
    result.productArea = "mobile_app";
  }

  if (lower.includes("transaction") || lower.includes("payment") || lower.includes("money") || lower.includes("transfer")) {
    result.tags.push("transaction_failure");
    result.productArea = "payments";
  }

  console.log(`  [STUB] Classified: ${result.category}/${result.severity} [${result.tags.join(", ")}]`);
  return result;
}
