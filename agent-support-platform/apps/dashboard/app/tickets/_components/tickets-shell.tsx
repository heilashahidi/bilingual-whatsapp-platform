"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { InternalUser, Ticket } from "@/lib/types";
import { useUiPrefs } from "@/lib/ui-prefs";
import { ConversationList } from "./conversation-list";
import { DetailPane } from "./detail-pane";
import { FiltersBar } from "./filters-bar";
import { InboxSidebar } from "./inbox-sidebar";
import { KanbanBoard } from "./kanban-board";
import { ListView } from "./list-view";
import { NewTicketModal } from "./new-ticket-modal";
import { PageHeader } from "./page-header";
import { TicketDrawer } from "./ticket-drawer";

// Three-pane inbox shell (sidebar · conversation list · detail). Kanban and
// list views render full-width and use the slide-in drawer for detail.
export function TicketsShell({
  tickets,
  users,
}: {
  tickets: Ticket[];
  users: InternalUser[];
}) {
  const [prefs, setPrefs] = useUiPrefs();
  const [newOpen, setNewOpen] = useState(false);
  const searchParams = useSearchParams();
  const pathname = usePathname();

  // ?closed=1 reveals archived tickets (driven by the cluster-closed banner).
  const includeClosed = searchParams.get("closed") === "1";

  // ?status=<key> narrows to a single status (driven by PageHeader chips).
  const statusFilter = searchParams.get("status");
  const visible = (includeClosed
    ? tickets
    : tickets.filter((t) => t.status !== "closed")
  ).filter((t) => !statusFilter || t.status === statusFilter);

  // Kanban has no Closed column, so force list view when inspecting closed.
  const effectiveView = includeClosed ? "list" : prefs.view;
  const isInbox = effectiveView === "inbox";
  const hasSelection = searchParams.get("ticket") !== null;

  // ?incident=X with no visible members → all were filtered by the
  // closed-ticket rule. Surface a banner so the deep link doesn't look broken.
  const incidentId = searchParams.get("incident");
  const incidentClusterInfo = useMemo(() => {
    if (!incidentId) return null;
    if (includeClosed) return null; // banner is redundant once they expand
    const inCluster = tickets.filter((t) => t.incident?.id === incidentId);
    if (inCluster.length === 0) return null;
    const visibleInCluster = visible.filter(
      (t) => t.incident?.id === incidentId
    );
    if (visibleInCluster.length > 0) return null;
    const closedCount = inCluster.filter((t) => t.status === "closed").length;
    if (closedCount === 0) return null;
    return {
      title: inCluster[0]?.incident?.title ?? "this incident",
      closedCount,
      totalCount: inCluster.length,
    };
  }, [incidentId, includeClosed, tickets, visible]);

  const showClosedHref = useMemo(() => {
    const next = new URLSearchParams(Array.from(searchParams.entries()));
    next.set("closed", "1");
    return `${pathname}?${next.toString()}`;
  }, [pathname, searchParams]);

  return (
    <div className="space-y-4">
      <div data-drawer-hidable className="space-y-4">
        <PageHeader
          prefs={prefs}
          onPrefsChange={setPrefs}
          onNewTicket={() => setNewOpen(true)}
        />

        <FiltersBar users={users} />
      </div>

      {incidentClusterInfo && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="shrink-0 text-amber-700"
            aria-hidden
          >
            <path d="M3 4h18v4H3zM4 8v12h16V8M9 12h6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              All {incidentClusterInfo.closedCount} ticket
              {incidentClusterInfo.closedCount === 1 ? "" : "s"} in this incident
              are closed.
            </div>
            <div className="truncate text-xs text-amber-800/80">
              {incidentClusterInfo.title}
            </div>
          </div>
          <Link
            href={showClosedHref}
            scroll={false}
            className="shrink-0 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
          >
            Show closed tickets
          </Link>
          <Link
            href="/incidents"
            className="shrink-0 text-xs font-medium text-amber-900 underline-offset-2 hover:underline"
          >
            Back to incidents
          </Link>
        </div>
      )}

      {/* Three-pane Inbox view ------------------------------------
          Responsive behavior:
            ≥ lg (1024px): full three-pane (sidebar · list · detail)
            md → lg:       two-pane (no inbox sidebar)
            < md (mobile): single-pane that toggles between the
                           conversation list and detail based on whether
                           a ?ticket=… selection is in the URL */}
      {isInbox && (
        <div className="flex h-[calc(100vh-16rem)] min-h-[32rem] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {/* InboxSidebar: hidden below lg AND toggleable on lg+ via
              the hamburger button below. CSS transition slides + fades
              the width on open/close. */}
          <div
            className={`hidden shrink-0 overflow-hidden transition-[width,opacity] duration-200 lg:block ${
              prefs.sidebarOpen ? "w-56 opacity-100" : "w-0 opacity-0"
            }`}
            aria-hidden={!prefs.sidebarOpen}
          >
            <InboxSidebar tickets={visible} />
          </div>

          {/* ConversationList column with a thin toolbar at the top
              holding the sidebar-toggle hamburger. Full width on mobile
              when no ticket selected; fixed 22rem column at lg+ */}
          <div
            className={`flex flex-col overflow-hidden lg:w-[22rem] lg:shrink-0 lg:border-r lg:border-slate-200 ${
              hasSelection ? "hidden lg:flex" : "flex w-full"
            }`}
          >
            <div className="hidden shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50/60 px-2 py-1.5 lg:flex">
              <button
                type="button"
                onClick={() => setPrefs({ sidebarOpen: !prefs.sidebarOpen })}
                className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200/70 hover:text-slate-900"
                aria-label={
                  prefs.sidebarOpen ? "Hide inbox sidebar" : "Show inbox sidebar"
                }
                title={
                  prefs.sidebarOpen
                    ? "Hide inboxes (collapse sidebar)"
                    : "Show inboxes (expand sidebar)"
                }
              >
                {/* Three-line "hamburger" icon — universal toggle affordance */}
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Conversations
              </span>
            </div>
            <div className="flex-1 overflow-hidden">
              <ConversationList tickets={visible} users={users} />
            </div>
          </div>

          {/* DetailPane: hidden on mobile when no selection; full
              width with back button when one is selected; flex-1
              at lg+ */}
          <div
            className={`flex-1 overflow-hidden bg-slate-50/40 ${
              hasSelection ? "block" : "hidden lg:block"
            }`}
          >
            <DetailPane users={users} />
          </div>
        </div>
      )}

      {!isInbox && (
        <div className="flex h-[calc(100vh-16rem)] min-h-[32rem] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div
            className={`hidden shrink-0 overflow-hidden transition-[width,opacity] duration-200 lg:block ${
              prefs.sidebarOpen ? "w-56 opacity-100" : "w-0 opacity-0"
            }`}
            aria-hidden={!prefs.sidebarOpen}
          >
            <InboxSidebar tickets={visible} />
          </div>
          <div className="hidden shrink-0 items-start border-r border-slate-200 bg-slate-50/40 p-1.5 lg:flex">
            <button
              type="button"
              onClick={() => setPrefs({ sidebarOpen: !prefs.sidebarOpen })}
              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200/70 hover:text-slate-900"
              aria-label={
                prefs.sidebarOpen ? "Hide inbox sidebar" : "Show inbox sidebar"
              }
              title={
                prefs.sidebarOpen
                  ? "Hide inboxes (collapse sidebar)"
                  : "Show inboxes (expand sidebar)"
              }
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {effectiveView === "kanban" ? (
              <KanbanBoard
                tickets={visible}
                users={users}
                density={prefs.density}
                bilingual={prefs.bilingual}
              />
            ) : (
              <ListView
                tickets={visible}
                users={users}
                density={prefs.density}
                bilingual={prefs.bilingual}
              />
            )}
          </div>
        </div>
      )}

      {newOpen && <NewTicketModal onClose={() => setNewOpen(false)} />}

      {/* Drawer mounts in every view — inbox shows the empty-state pane
          when nothing is selected, kanban/list rely on it for detail. */}
      <TicketDrawer />
    </div>
  );
}
