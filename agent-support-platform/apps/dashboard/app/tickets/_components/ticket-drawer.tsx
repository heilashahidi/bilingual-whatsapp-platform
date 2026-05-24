"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { fetchTicket, fetchUsers } from "@/lib/api";
import { getSocket, type TicketChangedEvent } from "@/lib/socket";
import type { InternalUser, TicketDetail } from "@/lib/types";
import { TicketDetailView } from "../[id]/_components/ticket-detail";

// Slide-in panel opened by `?ticket=<id>` in the URL. Reuses TicketDetailView
// from the full /tickets/[id] route so behavior stays in sync. Query-param
// state (not intercepting route) keeps deep links and browser back/forward
// working naturally.
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

  // Users list cached after first fetch — rarely changes during a session.
  useEffect(() => {
    if (!ticketId) {
      setTicket(null);
      setError(null);
      return;
    }
    // Clear stale data so the previous ticket's notes/messages don't render
    // under the new URL while the fetch is in flight.
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

  // Refetch on server-side mutation (assignment, severity, new note/message).
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

  useEffect(() => {
    if (!ticketId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ticketId, close]);

  // Lock body scroll + flag the body so globals.css can hide the site
  // header. Without the flag the nav bar bleeds through the scrim.
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

  // Wait for client mount so document.body exists before portaling.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!ticketId || !mounted) return null;

  const overlay = (
    <div
      className="fixed inset-0 z-40 flex"
      role="dialog"
      aria-modal="true"
      aria-label="Ticket details"
    >
      <button
        type="button"
        aria-label="Close ticket"
        onClick={close}
        className="drawer-scrim flex-1 cursor-default bg-transparent"
      />

      <div
        ref={panelRef}
        className="drawer relative flex w-full max-w-5xl flex-col overflow-hidden border-l border-slate-200 bg-white/85 shadow-2xl backdrop-blur-xl"
      >
        <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-1">
          {ticketId && (
            <Link
              href={`/tickets/${ticketId}`}
              className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              title="Open in full page"
              aria-label="Open in full page"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M7 17L17 7M9 7h8v8" />
              </svg>
            </Link>
          )}
          <button
            type="button"
            onClick={close}
            className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pt-8 pb-5 pr-28">
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

  // Portal so the overlay is a sibling of <main>, not nested inside —
  // otherwise hiding page content would hide the drawer too.
  return createPortal(overlay, document.body);
}
