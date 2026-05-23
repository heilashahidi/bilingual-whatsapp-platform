import type { Severity } from "./types";

// Single source of truth for severity badge styling across the app.
//
// Two variants, used contextually:
//   • SEVERITY_DOT — small filled circle, for dense list/scan views
//     (conversation list, kanban card header, filter chips). The dot
//     is enough at a glance when the severity label is already visible
//     elsewhere in the row.
//   • SEVERITY_PILL — text chip with ring, for detail views and places
//     where the severity name needs to be readable in isolation
//     (ticket header, incident row).
//
// Previously each consumer redefined these locally — five copies, three
// slightly different palettes (light pill vs. solid pill vs. dot only).
// Centralizing fixes the "two different severity badge shapes on the
// same screen" inconsistency flagged in the UI audit.

export const SEVERITY_DOT: Record<Severity, string> = {
  critical: "bg-rose-500",
  high: "bg-orange-500",
  medium: "bg-amber-500",
  low: "bg-slate-400",
};

export const SEVERITY_PILL: Record<Severity, string> = {
  critical: "bg-rose-100 text-rose-800 ring-rose-200",
  high: "bg-orange-100 text-orange-800 ring-orange-200",
  medium: "bg-amber-100 text-amber-800 ring-amber-200",
  low: "bg-slate-100 text-slate-700 ring-slate-200",
};
