"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { fetchTicket } from "@/lib/api";
import { getSocket, type TicketChangedEvent } from "@/lib/socket";
import type { InternalUser, TicketDetail } from "@/lib/types";
import { TicketDetailView } from "../[id]/_components/ticket-detail";

// Persistent right-pane detail for the Front-style inbox view. Unlike the
// drawer, this lives inside the page layout — when nothing is selected we
// render an empty state instead of unmounting.

export function DetailPane({ users }: { users: InternalUser[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ticketId = searchParams.get("ticket");

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("ticket");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Loader for the current ticket — used by both the initial open and
  // by realtime events that mutate this ticket.
  const loadTicket = useCallback(
    async (id: string, signal?: { cancelled: boolean }) => {
      try {
        const t = await fetchTicket(id);
        if (!signal?.cancelled) setTicket(t);
      } catch (e) {
        if (!signal?.cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load ticket");
        }
      }
    },
    []
  );

  // Initial / on-open fetch
  useEffect(() => {
    if (!ticketId) {
      setTicket(null);
      setError(null);
      return;
    }
    // Clear the previous ticket's data immediately so the user never
    // sees stale notes / messages / actions from the prior selection
    // during the fetch gap (otherwise A's notes briefly appear under
    // B's URL before B's data arrives).
    setTicket(null);
    const signal = { cancelled: false };
    setLoading(true);
    setError(null);
    loadTicket(ticketId, signal).finally(() => {
      if (!signal.cancelled) setLoading(false);
    });
    return () => {
      signal.cancelled = true;
    };
  }, [ticketId, loadTicket]);

  // Live updates: any time the backend broadcasts ticket:changed for the
  // currently-open ticket, refetch. Covers assignment, severity changes,
  // notes added, messages, etc. Without this the pane goes stale until
  // the user re-selects the ticket.
  useEffect(() => {
    if (!ticketId) return;
    const socket = getSocket();
    const handler = (event: TicketChangedEvent) => {
      if (event.ticketId === ticketId) {
        loadTicket(ticketId);
      }
    };
    socket.on("ticket:changed", handler);
    return () => {
      socket.off("ticket:changed", handler);
    };
  }, [ticketId, loadTicket]);

  if (!ticketId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-slate-300">
          <path d="M3 7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-4l-5 4v-4H7a4 4 0 0 1-4-4z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div>
          <div className="text-sm font-medium text-slate-600">
            Select a conversation
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Click a ticket from the list to see the full thread.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-2.5">
        <div className="text-xs font-mono text-slate-500">
          #{ticketId.slice(0, 8)}
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={`/tickets/${ticketId}`}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            title="Open in full page"
          >
            Open full
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M7 17L17 7M9 7h8v8" />
            </svg>
          </Link>
          <button
            type="button"
            onClick={close}
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
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
  );
}
