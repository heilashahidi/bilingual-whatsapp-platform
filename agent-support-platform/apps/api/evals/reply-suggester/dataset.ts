import type { ReplySuggesterContext } from "../../src/services/reply-suggester";

export interface ReplySuggesterCase {
  input: ReplySuggesterContext;
  // Free-form expectations the judge will use as a rubric. Not a reference
  // output — open-ended generation can't be graded by exact match.
  expected: {
    mustReferenceFacts: string[]; // facts that should appear (e.g., the specific error code)
    mustNotInvent: string[]; // facts the model must NOT introduce (no API endpoint names, no version numbers it wasn't given)
    desiredAction?: string; // one-line description of the next step a good reply would offer
  };
  metadata: { scenario: string };
}

export const dataset: ReplySuggesterCase[] = [
  // ── App-crash on transfer ────────────────────────────────────────────────
  {
    input: {
      conversation: [
        { who: "agent", text: "The app crashes every time I try to send 1500 HTG to account 4471-2289.", age: "2m ago" },
      ],
      agentName: "Jean Pierre",
      agentCountry: "HT",
      branchName: "Cap-Haïtien Centre",
      category: "bug_report",
      severity: "high",
      tags: ["app_crash", "transaction_failure"],
      kbHints: [
        {
          title: "App crash on outbound transfer (v4.2.x)",
          resolution: "Confirmed regression in v4.2.1 — force-close + clear app cache resolves until v4.2.2 ships next week.",
        },
      ],
    },
    expected: {
      mustReferenceFacts: ["4471-2289", "1500", "HTG"],
      mustNotInvent: [],
      desiredAction: "Walk the agent through force-close + clear cache, mention the v4.2.2 fix.",
    },
    metadata: { scenario: "app-crash with KB hint" },
  },

  // ── No KB hint, must ask clarifying question ─────────────────────────────
  {
    input: {
      conversation: [
        { who: "agent", text: "Something is wrong with the lottery results.", age: "5m ago" },
      ],
      agentName: "Marie Joseph",
      agentCountry: "HT",
      branchName: "Port-au-Prince Sud",
      category: "operational_complaint",
      severity: "medium",
      tags: ["lottery_results"],
      kbHints: [],
    },
    expected: {
      mustReferenceFacts: [],
      mustNotInvent: ["specific error code", "draw number"],
      desiredAction: "Ask what specifically is wrong (not loading, wrong numbers, slow?) — the report is too vague to act on.",
    },
    metadata: { scenario: "vague complaint — investigative reply is the right move" },
  },

  // ── Critical outage, multiple turns of context ───────────────────────────
  {
    input: {
      conversation: [
        { who: "agent", text: "Cannot process ANY transactions, completely down for everyone at my branch.", age: "8m ago" },
        { who: "operator", text: "Confirming — are payments and lottery both affected, or only payments?", age: "6m ago" },
        { who: "agent", text: "Both. Nothing works.", age: "3m ago" },
      ],
      agentName: "Paul Antoine",
      agentCountry: "DO",
      branchName: "Santo Domingo Norte",
      category: "bug_report",
      severity: "critical",
      tags: ["app_crash", "transaction_failure"],
      kbHints: [
        {
          title: "Full-branch outage runbook",
          resolution: "Check branch's last successful heartbeat in /admin/branches; if >5min, escalate to infra-oncall in #payments-oncall.",
        },
      ],
    },
    expected: {
      mustReferenceFacts: [],
      mustNotInvent: ["specific incident ID", "ETA without source"],
      desiredAction: "Acknowledge severity, mention you're checking the branch's connectivity / escalating to infra-oncall.",
    },
    metadata: { scenario: "critical multi-turn — empathetic + action" },
  },

  // ── Feature request, low severity ────────────────────────────────────────
  {
    input: {
      conversation: [
        { who: "agent", text: "It would be helpful to see the agent commission breakdown per transaction.", age: "1d ago" },
      ],
      agentName: "Sophia Reyes",
      agentCountry: "DO",
      branchName: "Santiago",
      category: "feature_request",
      severity: "low",
      tags: [],
      kbHints: [],
    },
    expected: {
      mustReferenceFacts: ["commission"],
      mustNotInvent: ["timeline", "roadmap commitment"],
      desiredAction: "Thank the agent, confirm the request is logged, set expectation that feature requests follow the regular product cycle.",
    },
    metadata: { scenario: "feature request — no commitment, polite acknowledgement" },
  },

  // ── Connectivity issue (should NOT be diagnosed as app bug) ──────────────
  {
    input: {
      conversation: [
        { who: "agent", text: "App stuck on loading screen for the last hour, my wifi keeps cutting out.", age: "1h ago" },
      ],
      agentName: "Lucien Charles",
      agentCountry: "HT",
      branchName: "Jacmel",
      category: "operational_complaint",
      severity: "medium",
      tags: ["connectivity"],
      kbHints: [
        {
          title: "Suspected connectivity vs app issue",
          resolution: "Have agent toggle airplane mode for 10s, then retry. If still stuck after stable connection for 2min, escalate.",
        },
      ],
    },
    expected: {
      mustReferenceFacts: [],
      mustNotInvent: ["app version", "server error"],
      desiredAction: "Address the connectivity dimension first (airplane mode toggle) before assuming an app bug.",
    },
    metadata: { scenario: "connectivity-flagged — address network first" },
  },
];
