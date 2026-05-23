"use client";

import type { InternalUser } from "@/lib/types";

// Empty-state placeholder for the inbox view's right pane. Ticket
// detail itself is rendered by <TicketDrawer /> as a full-viewport
// overlay on every view (inbox / kanban / list) — that gives a
// consistent open-ticket experience and lets the drawer's blurred
// scrim de-emphasize whatever was behind it.
//
// Kept as its own file (and still accepting `users`) so the shell
// signature doesn't churn if we later want to bring the inline pane
// back as an option, or use this slot for queue insights, etc.
export function DetailPane(_props: { users: InternalUser[] }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        className="text-slate-300"
        aria-hidden
      >
        <path
          d="M3 7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-4l-5 4v-4H7a4 4 0 0 1-4-4z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div>
        <div className="text-sm font-medium text-slate-600">
          Select a conversation
        </div>
        <div className="mt-1 text-xs text-slate-400">
          Click a ticket from the list — the full thread opens in a panel.
        </div>
      </div>
    </div>
  );
}
