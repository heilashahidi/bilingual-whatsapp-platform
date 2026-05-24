"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchTickets } from "@/lib/api";
import { getSocket } from "@/lib/socket";

// "Tickets" nav link with a small badge showing the count of
// unresolved tickets (status ∈ {open, in_progress, waiting_on_agent}).
// Mirrors the IncidentsNavLink pattern — the badge is a peripheral
// "stuff needs attention" signal, not a vanity total. Resolved /
// closed tickets are excluded so the number is actionable; it goes
// up when work arrives and down when work is finished.
//
// Refresh strategy: fetch on mount, refetch when the socket fires
// ticket:changed, plus a 90s safety poll. Fetches with limit:200
// matching the inbox page so we get the same set.

export function TicketsNavLink() {
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const data = await fetchTickets({ limit: 200 });
        if (cancelled) return;
        const active = data.tickets.filter(
          (t) =>
            t.status === "open" ||
            t.status === "in_progress" ||
            t.status === "waiting_on_agent"
        ).length;
        setCount(active);
      } catch {
        // Non-fatal — leave the previous count rather than zeroing
        // out and tricking the operator into thinking the queue
        // is empty.
      }
    }

    refresh();

    const socket = getSocket();
    socket.on("ticket:changed", refresh);

    const interval = setInterval(refresh, 90_000);

    return () => {
      cancelled = true;
      socket.off("ticket:changed", refresh);
      clearInterval(interval);
    };
  }, []);

  return (
    <Link
      href="/tickets"
      className="inline-flex items-center gap-1.5 hover:text-slate-900"
    >
      Tickets
      {count > 0 && (
        <span
          className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-700 px-1 text-[10px] font-semibold leading-none text-white"
          title={`${count} unresolved ticket${count === 1 ? "" : "s"}`}
          aria-label={`${count} unresolved tickets`}
        >
          {count}
        </span>
      )}
    </Link>
  );
}
