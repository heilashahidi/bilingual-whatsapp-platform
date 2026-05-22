"use client";

import Link from "next/link";
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

  // Lock body scroll while the drawer is open
  useEffect(() => {
    if (!ticketId) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
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
      {/* Scrim — click to close */}
      <button
        type="button"
        aria-label="Close ticket"
        onClick={close}
        className="drawer-scrim flex-1 cursor-default bg-slate-900/30"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="drawer flex w-full max-w-5xl flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
          <div className="text-xs font-mono text-slate-500">
            {ticketId ? `#${ticketId.slice(0, 8)}` : ""}
          </div>
          <div className="flex items-center gap-1">
            {ticketId && (
              <Link
                href={`/tickets/${ticketId}`}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                title="Open in full page"
              >
                Open full
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M7 17L17 7M9 7h8v8" />
                </svg>
              </Link>
            )}
            <button
              type="button"
              onClick={close}
              className="-mr-1 flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M6 18L18 6" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
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
