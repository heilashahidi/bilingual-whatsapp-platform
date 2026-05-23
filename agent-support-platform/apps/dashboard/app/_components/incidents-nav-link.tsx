"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchIncidents } from "@/lib/api";
import { getSocket } from "@/lib/socket";

// "Incidents" nav link with a small badge showing the count of
// unresolved incidents (status ∈ {detected, confirmed}). Replaces
// the page-level banner we briefly tried — that surface was too
// loud for the common case (1 cluster of a few tickets) and missed
// the place the operator's eye already lands when something looks
// off (the top nav). Pattern: Slack/Linear-style peripheral count.
//
// Refresh strategy: fetch on mount, refetch when the socket fires
// ticket:changed (any incident-affecting change rides those events),
// plus a 90s safety poll for the rare case the socket missed an
// event. Cheap call — the list endpoint returns a small array.

export function IncidentsNavLink() {
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const incidents = await fetchIncidents({});
        if (cancelled) return;
        const active = incidents.filter(
          (i) => i.status === "detected" || i.status === "confirmed"
        ).length;
        setCount(active);
      } catch {
        // Non-fatal — leave the previous count rather than zeroing
        // out and tricking the operator into thinking it's clear.
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
      href="/incidents"
      className="inline-flex items-center gap-1.5 hover:text-slate-900"
    >
      Incidents
      {count > 0 && (
        <span
          className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-none text-white"
          title={`${count} active incident${count === 1 ? "" : "s"}`}
          aria-label={`${count} active incidents`}
        >
          {count}
        </span>
      )}
    </Link>
  );
}
