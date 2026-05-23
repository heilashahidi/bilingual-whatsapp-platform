"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
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

// Front-style shell. Default view is the three-pane inbox layout
// (sidebar · conversation list · persistent detail). Kanban and list
// remain as alternate views — they keep their slide-in drawer for the
// detail since they're full-width.
//
// page.tsx stays a server component — it fetches tickets/users and
// hands them down; everything stateful or interactive lives here.

export function TicketsShell({
  tickets,
  users,
  total,
  closedCount,
}: {
  tickets: Ticket[];
  users: InternalUser[];
  total: number;
  closedCount: number;
}) {
  const [prefs, setPrefs] = useUiPrefs();
  const [newOpen, setNewOpen] = useState(false);
  const searchParams = useSearchParams();

  // Closed tickets are archived — they don't show in any of the three
  // views by default. (We could add a dedicated archive inbox later.)
  const visible = tickets.filter((t) => t.status !== "closed");

  const isInbox = prefs.view === "inbox";
  // Whether the right pane should occupy the small-screen view. Drives
  // the single-pane toggle on mobile: no selection → conversation list,
  // selection → detail pane (with a back button to clear).
  const hasSelection = searchParams.get("ticket") !== null;

  return (
    <div className="space-y-4">
      <PageHeader
        prefs={prefs}
        onPrefsChange={setPrefs}
        onNewTicket={() => setNewOpen(true)}
        total={total}
        closedCount={closedCount}
      />

      <FiltersBar users={users} />

      {/* Three-pane Inbox view ------------------------------------
          Responsive behavior:
            ≥ lg (1024px): full three-pane (sidebar · list · detail)
            md → lg:       two-pane (no inbox sidebar)
            < md (mobile): single-pane that toggles between the
                           conversation list and detail based on whether
                           a ?ticket=… selection is in the URL */}
      {isInbox && (
        <div className="flex h-[calc(100vh-16rem)] min-h-[32rem] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {/* InboxSidebar: hidden below lg */}
          <div className="hidden lg:block">
            <InboxSidebar tickets={visible} />
          </div>

          {/* ConversationList: full width on mobile when no ticket
              selected; fixed 22rem column at lg+ */}
          <div
            className={`overflow-hidden lg:w-[22rem] lg:shrink-0 lg:border-r lg:border-slate-200 ${
              hasSelection ? "hidden lg:block" : "block w-full"
            }`}
          >
            <ConversationList tickets={visible} users={users} />
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

      {/* Kanban + List: inbox sidebar hidden on small screens too,
          freeing the full width for the board / list. The slide-in
          drawer still mounts so clicking a card opens the detail. */}
      {!isInbox && (
        <div className="flex h-[calc(100vh-16rem)] min-h-[32rem] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="hidden lg:block">
            <InboxSidebar tickets={visible} />
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {prefs.view === "kanban" ? (
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

      {/* Slide-in drawer only mounts in kanban/list views — the inbox
          view has its own persistent right pane handling the same URL
          query param. Both reading the same ?ticket=<id> would double-
          render the detail. */}
      {!isInbox && <TicketDrawer />}
    </div>
  );
}
