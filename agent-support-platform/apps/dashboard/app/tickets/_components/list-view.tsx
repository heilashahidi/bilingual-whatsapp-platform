"use client";

import Link from "next/link";
import type { InternalUser, Ticket, TicketStatus } from "@/lib/types";
import { SEVERITY_DOT } from "@/lib/severity-styles";
import { SlaTimer } from "./sla-timer";

// Tabular view of tickets, sharing the same filters as KanbanBoard.
// The shell (tickets-shell.tsx) feeds in the already-filtered list and the
// shared UiPrefs (density + bilingual). Selection isn't supported here yet
// — wire it up when the bulk-actions-bar is plumbed through this view too.

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting_on_agent: "Waiting on agent",
  resolved: "Resolved",
  closed: "Closed",
};

const STATUS_PILL: Record<TicketStatus, string> = {
  open:             "bg-sky-50     text-sky-700     ring-sky-200/80",
  in_progress:      "bg-violet-50  text-violet-700  ring-violet-200/80",
  waiting_on_agent: "bg-amber-50   text-amber-700   ring-amber-200/80",
  resolved:         "bg-emerald-50 text-emerald-700 ring-emerald-200/80",
  closed:           "bg-slate-100  text-slate-600   ring-slate-200",
};

const STATUS_DOT: Record<TicketStatus, string> = {
  open:             "bg-sky-500",
  in_progress:      "bg-violet-500",
  waiting_on_agent: "bg-amber-500",
  resolved:         "bg-emerald-500",
  closed:           "bg-slate-400",
};


export function ListView({
  tickets,
  users,
  bilingual,
  density,
}: {
  tickets: Ticket[];
  users: InternalUser[];
  bilingual: boolean;
  density: "comfortable" | "compact";
}) {
  const userById = new Map(users.map((u) => [u.id, u] as const));
  const rowPad = density === "compact" ? "py-2" : "py-2.5";

  if (tickets.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-400">
        No tickets match the current filters.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="grid grid-cols-[2fr_1.1fr_1fr_0.9fr_0.7fr_1fr_0.7fr] gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-500">
        <span>Ticket</span>
        <span>Agent</span>
        <span>Status</span>
        <span>Severity</span>
        <span>Country</span>
        <span>Assignee</span>
        <span>SLA</span>
      </div>

      {tickets.map((t) => {
        const latest = t.messages[0];
        const translated = latest?.translatedText || "";
        const original = latest?.originalText || "";
        const assignee = t.assignedTo ? userById.get(t.assignedTo) ?? null : null;
        return (
          <Link
            key={t.id}
            href={`/tickets?ticket=${t.id}`}
            scroll={false}
            className={`grid grid-cols-[2fr_1.1fr_1fr_0.9fr_0.7fr_1fr_0.7fr] items-center gap-3 border-b border-slate-100 px-4 ${rowPad} text-[13px] transition last:border-b-0 hover:bg-slate-50`}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10.5px] text-slate-400">
                  #{t.id.slice(0, 6)}
                </span>
                <span className="truncate font-medium text-slate-900">
                  {translated || original || "(no messages)"}
                </span>
              </div>
              {bilingual && original && original !== translated && (
                <div
                  dir="auto"
                  className="mt-0.5 truncate text-[11.5px] italic text-slate-500"
                >
                  {original}
                </div>
              )}
            </div>

            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-medium text-slate-900">
                {t.agent.name}
              </div>
              <div className="truncate text-[11px] text-slate-500">
                {t.agent.branch.name}
              </div>
            </div>

            <div>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STATUS_PILL[t.status]}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[t.status]}`} />
                {STATUS_LABEL[t.status]}
              </span>
            </div>

            <div className="flex items-center gap-1.5 text-[12px] capitalize text-slate-700">
              <span className={`h-1.5 w-1.5 rounded-full ${SEVERITY_DOT[t.severity]}`} />
              {t.severity}
            </div>

            <div className="font-mono text-[11.5px] text-slate-500">
              {t.agent.country}
            </div>

            <div className="truncate text-[12px] text-slate-700">
              {assignee?.name ?? <span className="text-slate-400">Unassigned</span>}
            </div>

            <div>
              <SlaTimer deadline={t.slaFirstResponseDeadline} />
            </div>
          </Link>
        );
      })}
    </div>
  );
}
