"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchTickets } from "@/lib/api";
import { getSocket } from "@/lib/socket";

// Nav badge of unresolved tickets (open / in_progress / waiting_on_agent).
// Refreshes on ticket:changed plus a 90s safety poll.
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
        // Non-fatal — keep stale count rather than zeroing the badge.
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
