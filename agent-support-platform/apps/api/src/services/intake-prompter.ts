// Auto-intake prompter.
//
// Fired once at ticket creation: the system sends an automatic
// WhatsApp message back to the field agent asking for the specific
// information the US team will need to triage. Saves a round-trip —
// by the time an operator opens the ticket, the agent's response is
// often already there with the transaction ID, app version, etc.
//
// Two design decisions worth recording:
//
//   1. Static templates, not LLM-generated. Five categories × a
//      handful of product areas is a small decision tree. Claude
//      would add ~700 ms of latency per new ticket for a question
//      it can't really answer better than a curated list. We keep
//      Claude for the open-ended copy (reply drafts, incident
//      summaries) where it earns its keep.
//
//   2. Messages stay short. Each one is < 480 chars so it fits
//      under the BOT_MAX_MESSAGE_LENGTH cap for Haiti/DRC's 2G
//      networks without splitting. We don't append the SLA window
//      to the body because the operator's reply will already land
//      within that window.
//
// Translation: the returned text is English. The caller passes it
// through sendAgentResponse which translates into the agent's
// detected conversation language (or skips translation if the
// conversation is English).

import type { TicketCategory, Severity } from "@prisma/client";

export interface IntakePromptInput {
  category: TicketCategory;
  severity: Severity;
  productArea: string | null;
  // The classifier-applied tags; used to refine the template
  // (e.g. an operational_complaint tagged "transaction_failure"
  // routes to the transaction intake instead of the generic one).
  tags: string[];
}

/**
 * Returns the intake message text to send to the field agent, or
 * null if no intake is appropriate (questions and feature requests
 * just get a simple acknowledgement elsewhere).
 */
export function buildIntakePrompt(input: IntakePromptInput): string | null {
  const { category, productArea, tags } = input;
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));

  if (category === "feature_request") {
    return null; // operator will respond when they get to it; no intake needed
  }

  if (category === "question") {
    return null; // ambiguous category — better to wait for the operator
  }

  if (category === "bug_report") {
    return [
      "Thanks for the report. To help us debug faster, could you share when you have a moment:",
      "",
      "1. Your app version (Settings → About)",
      "2. The exact error message you saw, if any",
      "3. A screenshot of what's on your screen",
      "",
      "No need to wait — a team member will respond as soon as possible.",
    ].join("\n");
  }

  if (category === "operational_complaint") {
    // Hardware issues route to the hardware intake regardless of tags.
    if (productArea === "hardware") {
      return [
        "Got it. A few quick details so we can triage:",
        "",
        "1. Terminal ID (sticker on the back)",
        "2. Any LED lights showing? What color?",
        "3. When did this start?",
        "",
        "We'll respond shortly.",
      ].join("\n");
    }

    // Transaction failures need the most-specific intake.
    const isTransactional =
      productArea === "payments" ||
      tagSet.has("transaction_failure") ||
      tagSet.has("transaction") ||
      tagSet.has("deposit") ||
      tagSet.has("withdrawal");

    if (isTransactional) {
      return [
        "Sorry about the transaction issue. To help us investigate:",
        "",
        "1. Transaction reference / receipt number",
        "2. Amount involved",
        "3. Customer's phone number (if they're still at the branch)",
        "4. Exact time the failure happened",
        "",
        "A team member will respond as soon as possible.",
      ].join("\n");
    }

    // Generic operational complaint (lottery delay, slow app, etc.)
    return [
      "Thanks for the report. So we can help quickly:",
      "",
      "1. Roughly how often is this happening?",
      "2. When did it start?",
      "3. Any specific service affected? (payments, lottery, account, etc.)",
      "",
      "We'll get back to you shortly.",
    ].join("\n");
  }

  // "other" category — no intake; let the operator handle it directly.
  return null;
}
