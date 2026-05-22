"use client";

import { useState } from "react";
import type { InternalUser, Ticket } from "@/lib/types";
import { useUiPrefs } from "@/lib/ui-prefs";
import { PageHeader } from "./page-header";
import { FiltersBar } from "./filters-bar";
import { KanbanBoard } from "./kanban-board";
import { ListView } from "./list-view";
import { NewTicketModal } from "./new-ticket-modal";

// Client shell for /tickets. Owns:
//   - UI prefs (density / bilingual / view) via useUiPrefs (localStorage)
//   - The "new ticket" modal open state
//   - The active filtered tickets, which are passed both to KanbanBoard
//     and ListView so they share the same filter state
//
// page.tsx stays a server component — it fetches tickets/users and hands
// them down. Anything stateful or interactive lives here.

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

  // ListView wants the non-closed tickets only (KanbanBoard filters closed
  // internally too). FiltersBar still owns severity/country/assignee/search
  // — those are URL params and applied inside each board component.
  const visible = tickets.filter((t) => t.status !== "closed");

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

      {newOpen && <NewTicketModal onClose={() => setNewOpen(false)} />}
    </div>
  );
}
