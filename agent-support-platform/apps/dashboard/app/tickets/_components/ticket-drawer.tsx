"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { fetchTicket, fetchUsers } from "@/lib/api";
import { getSocket, type TicketChangedEvent } from "@/lib/socket";
import type { InternalUser, TicketDetail } from "@/lib/types";
import { TicketDetailView } from "../[id]/_components/ticket-detail";

// Slide-in panel that opens when the URL has `?ticket=<id>`. Reuses the
// same TicketDetailView the full route uses, so behavior stays in sync.
//
// Why query-param state instead of an intercepting route:
// - Deep links still work — /tickets/[id] remains a full page.
// - Browser back/forward toggles the drawer naturally (back from
//   /tickets?ticket=abc → /tickets, drawer closes).
// - RealtimeRefresh re-mounts on each opened ticket via `ticketId` prop.
export function TicketDrawer() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ticketId = searchParams.get("ticket");

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [users, setUsers] = useState<InternalUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("ticket");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  // Fetch ticket whenever the open id changes. Users are cached after
  // the first fetch — list rarely changes during a session.
  useEffect(() => {
    if (!ticketId) {
      setTicket(null);
      setError(null);
      return;
    }
    // Clear the previous ticket's data immediately so notes / messages
    // / actions from the prior selection never render under the new
    // ticket's URL while the fetch is in flight.
    setTicket(null);
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchTicket(ticketId),
      users.length ? Promise.resolve(users) : fetchUsers().catch(() => []),
    ])
      .then(([t, u]) => {
        if (cancelled) return;
        setTicket(t);
        if (!users.length) setUsers(u);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load ticket");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  // Live updates: refetch when this ticket is mutated server-side
  // (assignment, severity change, new note, new message, etc.).
  useEffect(() => {
    if (!ticketId) return;
    const socket = getSocket();
    const handler = (event: TicketChangedEvent) => {
      if (event.ticketId !== ticketId) return;
      fetchTicket(ticketId)
        .then((t) => setTicket(t))
        .catch(() => {
          /* leave stale view rather than blank out */
        });
    };
    socket.on("ticket:changed", handler);
    return () => {
      socket.off("ticket:changed", handler);
    };
  }, [ticketId]);

  // ESC closes the drawer
  useEffect(() => {
    if (!ticketId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ticketId, close]);

  // Lock body scroll AND mark the body so the site header can hide
  // itself via CSS (see globals.css). Keeps the underlying page from
  // bleeding through the scrim as a readable nav bar — the user
  // wanted the kept-light scrim (so the dashboard is still felt
  // behind) but without the literal text band peeking through.
  useEffect(() => {
    if (!ticketId) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.dataset.drawerOpen = "1";
    return () => {
      document.body.style.overflow = original;
      delete document.body.dataset.drawerOpen;
    };
  }, [ticketId]);

  if (!ticketId) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex"
      role="dialog"
      aria-modal="true"
      aria-label="Ticket details"
    >
      {/* Scrim — click to close. backdrop-blur de-emphasizes the rest
          of the dashboard so the operator's eye lands on the ticket. */}
      <button
        type="button"
        aria-label="Close ticket"
        onClick={close}
        className="drawer-scrim flex-1 cursor-default bg-slate-900/60 backdrop-blur-md"
      />

      {/* Panel — pure content. No header strip, no floating buttons.
          The user closes via ESC or by clicking the scrim. Removing
          the top-right ✕/↗ buttons lets the ticket title sit at the
          absolute top of the panel with no horizontal chrome above it. */}
      <div
        ref={panelRef}
        className="drawer relative flex w-full max-w-5xl flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {loading && !ticket && (
            <div className="py-8 text-center text-sm text-slate-500">Loading…</div>
          )}
          {error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              {error}
            </div>
          )}
          {ticket && <TicketDetailView ticket={ticket} users={users} />}
        </div>
      </div>
    </div>
  );
}
