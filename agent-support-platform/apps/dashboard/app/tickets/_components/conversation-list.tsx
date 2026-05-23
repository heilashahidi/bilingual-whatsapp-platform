"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useMemo } from "react";
import type { InternalUser, Severity, Ticket, TicketStatus } from "@/lib/types";
import { readFiltersFromParams } from "./filters-bar";
import { SlaTimer } from "./sla-timer";

// Front-style dense conversation list. Each row is a Link to
// /tickets?ticket=<id> so clicking selects the ticket and the right
// pane renders the detail (handled by tickets-shell). Rows are tighter
// than the kanban cards — designed for scanning a queue.

const SEVERITY_DOT: Record<Severity, string> = {
  critical: "bg-rose-500",
  high: "bg-orange-500",
  medium: "bg-amber-500",
  low: "bg-slate-400",
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting_on_agent: "Waiting",
  resolved: "Resolved",
  closed: "Closed",
};

const STATUS_TINT: Record<TicketStatus, string> = {
  open: "text-sky-700 bg-sky-50",
  in_progress: "text-violet-700 bg-violet-50",
  waiting_on_agent: "text-amber-700 bg-amber-50",
  resolved: "text-emerald-700 bg-emerald-50",
  closed: "text-slate-600 bg-slate-100",
};

const COUNTRY_FLAG: Record<string, string> = { HT: "🇭🇹", DO: "🇩🇴", CD: "🇨🇩" };

export function ConversationList({
  tickets,
  users,
}: {
  tickets: Ticket[];
  users: InternalUser[];
}) {
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const activeId = searchParams.get("ticket");

  // Apply the same URL-driven filters the kanban applies, plus the inbox
  // sidebar's status filter (which writes ?status=…).
  const filtered = useMemo(() => {
    const filters = readFiltersFromParams(
      new URLSearchParams(searchParams.toString())
    );
    const statusFilter = searchParams.get("status");
    const myId = (session?.user as { id?: string } | undefined)?.id;
    const q = filters.search.trim().toLowerCase();

    return tickets.filter((t) => {
      if (statusFilter && t.status !== statusFilter) return false;
      if (filters.severities.size && !filters.severities.has(t.severity)) return false;
      if (filters.countries.size && !filters.countries.has(t.agent.country)) return false;
      if (filters.assigneeId === "me") {
        if (!myId || t.assignedTo !== myId) return false;
      } else if (filters.assigneeId === "unassigned") {
        if (t.assignedTo) return false;
      } else if (filters.assigneeId) {
        if (t.assignedTo !== filters.assigneeId) return false;
      }
      if (filters.incidentId) {
        if (t.incident?.id !== filters.incidentId) return false;
      }
      if (q) {
        const hay = [
          t.agent.name,
          t.agent.branch.name,
          t.agent.phoneNumber,
          ...t.tags,
          t.messages[0]?.translatedText ?? "",
          t.messages[0]?.originalText ?? "",
          t.category,
          t.productArea ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tickets, searchParams, session]);

  if (filtered.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-slate-400">
        No conversations in this view.
      </div>
    );
  }

  return (
    <ul className="flex h-full flex-col overflow-y-auto">
      {filtered.map((t) => {
        const isActive = t.id === activeId;
        const latest = t.messages[0];
        const translated = latest?.translatedText || "";
        const original = latest?.originalText || "";
        const snippet = translated || original || "(no messages)";
        const assignee = t.assignedTo ? userById.get(t.assignedTo) : undefined;

        return (
          <li key={t.id} className="border-b border-slate-100 last:border-b-0">
            <Link
              href={`/tickets?ticket=${t.id}`}
              scroll={false}
              className={`flex items-start gap-2.5 px-3 py-2.5 transition ${
                isActive
                  ? "bg-emerald-50"
                  : "hover:bg-slate-50"
              }`}
            >
              {/* Severity dot — flush left */}
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[t.severity]}`}
                title={`${t.severity} severity`}
              />

              <div className="min-w-0 flex-1">
                {/* Line 1: agent name + country flag + SLA timer on right.
                    min-w-0 on the inner flex is required for truncate to
                    actually shrink below content width — without it, long
                    names ("Jean-Baptiste Pierre-Louis") push the SLA timer
                    out of the row. */}
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-900">
                    {t.agent.name}
                  </span>
                  <span aria-hidden className="shrink-0 text-xs">
                    {COUNTRY_FLAG[t.agent.country]}
                  </span>
                  <span className="shrink-0">
                    <SlaTimer
                      deadline={t.slaFirstResponseDeadline}
                      size={12}
                      showLabel={false}
                    />
                  </span>
                </div>

                {/* Line 2: snippet */}
                <p className="mt-0.5 truncate text-[12px] text-slate-600">
                  {snippet}
                </p>

                {/* Line 3: status pill + branch + assignee */}
                <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-slate-500">
                  <span
                    className={`rounded px-1.5 py-px font-medium ${STATUS_TINT[t.status]}`}
                  >
                    {STATUS_LABEL[t.status]}
                  </span>
                  <span className="truncate">{t.agent.branch.name}</span>
                  {assignee && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="truncate">{assignee.name}</span>
                    </>
                  )}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
