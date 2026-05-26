"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchAgents } from "@/lib/api";

// Nav badge that shows how many numbers are sitting in the quarantine
// queue waiting for admin review (SECURITY.md §5.1). Refreshes on a
// 90s safety poll — the queue changes slowly enough that real-time
// invalidation isn't worth a socket event.
export function AgentsNavLink() {
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const agents = await fetchAgents({
          verification: "pending",
          limit: 200,
        });
        if (cancelled) return;
        setCount(agents.length);
      } catch {
        // Non-fatal — keep stale count rather than zeroing the badge.
      }
    }

    refresh();
    const interval = setInterval(refresh, 90_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <Link
      href="/agents?verification=pending"
      className="inline-flex items-center gap-1.5 hover:text-slate-900"
    >
      Agents
      {count > 0 && (
        <span
          className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold leading-none text-white"
          title={`${count} number${count === 1 ? "" : "s"} pending verification`}
          aria-label={`${count} numbers pending verification`}
        >
          {count}
        </span>
      )}
    </Link>
  );
}
