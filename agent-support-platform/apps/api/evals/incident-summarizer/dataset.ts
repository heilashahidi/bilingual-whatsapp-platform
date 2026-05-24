import type { IncidentSummaryContext } from "../../src/services/incident-summarizer";

export interface IncidentSummaryCase {
  input: IncidentSummaryContext;
  expected: {
    // Substrings the title should plausibly mention (feature/product names,
    // location patterns) — the model isn't constrained to exact wording but
    // a good summary will reference these.
    titleShouldMention: string[];
    // Substrings that would indicate hallucination (specific version numbers,
    // error codes, or branch names NOT present in the ticket reports).
    titleMustNotMention: string[];
    // Free-form description of the ideal root-cause hypothesis (used by the
    // LLM judge).
    rootCauseHint: string;
  };
  metadata: { scenario: string };
}

export const dataset: IncidentSummaryCase[] = [
  // ── Single-feature outage, multiple branches in one country ──────────────
  {
    input: {
      category: "operational_complaint",
      severity: "high",
      tickets: [
        {
          branchName: "Cap-Haïtien Centre",
          branchRegion: "Nord",
          country: "HT",
          firstMessageText: "Lottery results page just spins forever, been like this for 30 minutes.",
          tags: ["lottery_results"],
        },
        {
          branchName: "Cap-Haïtien Est",
          branchRegion: "Nord",
          country: "HT",
          firstMessageText: "Can't load lottery results page — keeps timing out.",
          tags: ["lottery_results"],
        },
        {
          branchName: "Port-au-Prince Sud",
          branchRegion: "Ouest",
          country: "HT",
          firstMessageText: "Same as the others — lottery results not loading.",
          tags: ["lottery_results"],
        },
      ],
    },
    expected: {
      titleShouldMention: ["lottery"],
      titleMustNotMention: ["v4.2.1", "503"], // no version or error code was given
      rootCauseHint: "Lottery results endpoint or upstream provider is timing out; check the lottery service health and CDN cache.",
    },
    metadata: { scenario: "feature-specific outage, multi-branch, one country" },
  },

  // ── Critical full-app outage, single branch ──────────────────────────────
  {
    input: {
      category: "bug_report",
      severity: "critical",
      tickets: [
        {
          branchName: "Santo Domingo Norte",
          branchRegion: null,
          country: "DO",
          firstMessageText: "Cannot process ANY transactions, app crashes on launch for everyone here.",
          tags: ["app_crash", "transaction_failure"],
        },
        {
          branchName: "Santo Domingo Norte",
          branchRegion: null,
          country: "DO",
          firstMessageText: "App won't open at all this morning — same issue affecting all 6 agents at the branch.",
          tags: ["app_crash"],
        },
      ],
    },
    expected: {
      titleShouldMention: ["Santo Domingo", "crash"],
      titleMustNotMention: ["payments service", "backend", "OAuth"],
      rootCauseHint: "Localized crash-on-launch at one branch — check branch-specific config or recent deploy targeting that location.",
    },
    metadata: { scenario: "critical, branch-scoped, app launch failure" },
  },

  // ── Cross-country connectivity-flagged incident ──────────────────────────
  {
    input: {
      category: "operational_complaint",
      severity: "medium",
      tickets: [
        {
          branchName: "Jacmel",
          branchRegion: "Sud-Est",
          country: "HT",
          firstMessageText: "App stuck on loading screen, network signal weak in my area today.",
          tags: ["connectivity"],
        },
        {
          branchName: "Kinshasa Centre",
          branchRegion: "Kinshasa",
          country: "CD",
          firstMessageText: "Cannot connect to anything, mobile data has been spotty all morning.",
          tags: ["connectivity"],
        },
        {
          branchName: "Santiago",
          branchRegion: null,
          country: "DO",
          firstMessageText: "Wifi is bad here, app keeps spinning.",
          tags: ["connectivity"],
        },
      ],
    },
    expected: {
      titleShouldMention: ["connectivity"],
      titleMustNotMention: ["API outage", "backend", "specific carrier"],
      rootCauseHint: "These are independent connectivity issues at the agents' locations, NOT an app issue — confirm the clusterer shouldn't be suppressing connectivity-tagged clusters that span countries.",
    },
    metadata: { scenario: "false-positive cluster — agent-side network issues, not a real incident" },
  },

  // ── Single ticket (edge case: should still produce reasonable output) ────
  {
    input: {
      category: "bug_report",
      severity: "high",
      tickets: [
        {
          branchName: "Port-au-Prince Centre",
          branchRegion: "Ouest",
          country: "HT",
          firstMessageText: "Error code 502 when trying to view transaction history.",
          tags: ["transaction_failure"],
        },
      ],
    },
    expected: {
      titleShouldMention: ["transaction history"],
      titleMustNotMention: [],
      rootCauseHint: "502 from the transaction-history endpoint — check that service's upstream / load balancer.",
    },
    metadata: { scenario: "single-ticket cluster — degenerate case" },
  },
];
