"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useMemo } from "react";
import type { InternalUser, Ticket, TicketStatus } from "@/lib/types";
import { SEVERITY_DOT } from "@/lib/severity-styles";
import { useUiPrefs } from "@/lib/ui-prefs";
import { readFiltersFromParams } from "./filters-bar";
import { SlaTimer } from "./sla-timer";

// Dense conversation list. Each row links to /tickets?ticket=<id>; the
// right pane (tickets-shell) renders the detail. Tighter than kanban cards.
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


export function ConversationList({
  tickets,
  users,
}: {
  tickets: Ticket[];
  users: InternalUser[];
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const [prefs] = useUiPrefs();
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const activeId = searchParams.get("ticket");

  // Same URL-driven filters as kanban, plus the inbox sidebar's ?status=.
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

  // j/k step selection through the filtered list. Bound only when a list is
  // showing so the keys do nothing on empty views (typing-into-input is
  // already guarded inside onKey).
  useEffect(() => {
    if (filtered.length === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "j" && e.key !== "k") return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const isTyping =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (t && (t as HTMLElement).isContentEditable);
      if (isTyping) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const currentIdx = filtered.findIndex((t) => t.id === activeId);
      const delta = e.key === "j" ? 1 : -1;
      // No selection yet: first j picks index 0, first k picks last.
      const nextIdx =
        currentIdx === -1
          ? e.key === "j"
            ? 0
            : filtered.length - 1
          : Math.max(0, Math.min(filtered.length - 1, currentIdx + delta));
      const nextId = filtered[nextIdx]?.id;
      if (!nextId || nextId === activeId) return;

      e.preventDefault();
      const params = new URLSearchParams(searchParams.toString());
      params.set("ticket", nextId);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, activeId, searchParams, pathname, router]);

  // Tiny initials chip; hue derivation matches kanban's AssigneeAvatar.
  function AssigneeDot({ user }: { user: InternalUser }) {
    const initials = user.name
      .split(" ")
      .map((s) => s[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
    const hue =
      [...user.id].reduce((n, c) => n + c.charCodeAt(0), 0) % 360;
    return (
      <span
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8.5px] font-semibold"
        title={user.name}
        style={{
          background: `oklch(0.92 0.06 ${hue})`,
          color: `oklch(0.30 0.10 ${hue})`,
        }}
      >
        {initials}
      </span>
    );
  }

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
        // Inbound: translatedText is English, originalText is agent language.
        // Outbound: originalText is English, translatedText is what was sent.
        const isInboundLatest = latest?.direction === "inbound";
        const englishView = isInboundLatest
          ? latest?.translatedText || ""
          : latest?.originalText || "";
        const agentLangView = isInboundLatest
          ? latest?.originalText || ""
          : latest?.translatedText || "";
        const snippet = prefs.bilingual
          ? agentLangView || englishView || "(no messages)"
          : englishView || agentLangView || "(no messages)";
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
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[t.severity]}`}
                title={`${t.severity} severity`}
              />

              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-900">
                    {t.agent.name}
                  </span>
                  <span className="shrink-0 rounded bg-slate-100 px-1 py-px font-mono text-[9.5px] font-semibold tracking-wide text-slate-600">
                    {t.agent.country}
                  </span>
                  <span className="shrink-0">
                    <SlaTimer
                      deadline={t.slaFirstResponseDeadline}
                      size={12}
                      showLabel={false}
                    />
                  </span>
                  <span
                    className={`shrink-0 rounded px-1 py-px text-[10px] font-medium ${STATUS_TINT[t.status]}`}
                    title={STATUS_LABEL[t.status]}
                  >
                    {STATUS_LABEL[t.status]}
                  </span>
                  {assignee && <AssigneeDot user={assignee} />}
                </div>

                <p
                  dir={prefs.bilingual ? "auto" : undefined}
                  className="mt-0.5 truncate text-[12px] text-slate-600"
                >
                  {snippet}
                </p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
