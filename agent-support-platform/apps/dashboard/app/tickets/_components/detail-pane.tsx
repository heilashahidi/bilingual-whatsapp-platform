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

  // Sync the browser tab title to the currently-opened ticket so
  // operators with multiple tabs can distinguish them at a glance.
  // Reverts to the default on unmount or when the selection clears.
  useEffect(() => {
    if (!ticket) return;
    const firstInbound = ticket.messages.find((m) => m.direction === "inbound");
    const snippet = (firstInbound?.translatedText ||
      firstInbound?.originalText ||
      ticket.category)
      .replace(/\s+/g, " ")
      .trim();
    const short = snippet.length > 60 ? snippet.slice(0, 57) + "…" : snippet;
    const previous = document.title;
    document.title = `${short} · #${ticket.id.slice(0, 8)} · Agent Support`;
    return () => {
      document.title = previous;
    };
  }, [ticket]);

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
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-2">
        <div className="flex items-center gap-2">
          {/* Back-to-list button — visible only on mobile, where the
              detail pane occupies the full width and the user otherwise
              has no way to return to the conversation list. */}
          <button
            type="button"
            onClick={close}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900 lg:hidden"
            aria-label="Back to conversations"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </button>
          <div className="text-xs font-mono text-slate-500">
            #{ticketId.slice(0, 8)}
          </div>
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

      <div className="flex-1 overflow-y-auto px-5 pt-3 pb-4">
        {loading && !ticket && <DetailSkeleton />}
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

// Placeholder shaped roughly like the real TicketDetailView — header
// row, status pills, a few "message bubble" blocks, and a sidebar
// column. Reduces perceived latency when switching between tickets
// since the user sees an instant layout change instead of empty space.
function DetailSkeleton() {
  return (
    <div className="animate-pulse space-y-5">
      {/* Header: title + badges */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-5 w-3/4 rounded bg-slate-200" />
            <div className="h-3 w-20 rounded bg-slate-200" />
          </div>
          <div className="flex shrink-0 gap-2">
            <div className="h-5 w-14 rounded-full bg-slate-200" />
            <div className="h-5 w-16 rounded-full bg-slate-200" />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="h-3 w-20 rounded bg-slate-200" />
          <div className="h-3 w-24 rounded bg-slate-200" />
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Conversation column */}
        <div className="space-y-4 lg:col-span-2">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            <div className="border-b border-slate-200 bg-white/60 px-4 py-2.5">
              <div className="h-3 w-24 rounded bg-slate-200" />
            </div>
            <div className="space-y-3 p-4">
              {/* Inbound bubble */}
              <div className="flex justify-start">
                <div className="w-3/5 space-y-2 rounded-lg bg-white p-3 ring-1 ring-slate-200">
                  <div className="h-3 w-32 rounded bg-slate-100" />
                  <div className="h-3 w-full rounded bg-slate-100" />
                  <div className="h-3 w-4/5 rounded bg-slate-100" />
                </div>
              </div>
              {/* Outbound bubble */}
              <div className="flex justify-end">
                <div className="w-1/2 space-y-2 rounded-lg bg-slate-300 p-3">
                  <div className="h-3 w-24 rounded bg-slate-400/60" />
                  <div className="h-3 w-full rounded bg-slate-400/60" />
                </div>
              </div>
            </div>
          </div>
          <div className="h-24 rounded-lg border border-slate-200 bg-slate-50" />
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="h-40 rounded-lg border border-slate-200 bg-white" />
          <div className="h-28 rounded-lg border border-slate-200 bg-white" />
        </div>
      </div>
    </div>
  );
}
