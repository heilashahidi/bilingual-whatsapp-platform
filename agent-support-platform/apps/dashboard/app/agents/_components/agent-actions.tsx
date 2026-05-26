"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { verifyAgent, rejectAgent } from "@/lib/api";
import type { Agent } from "@/lib/types";

// Inline promote / reject actions for the /agents quarantine queue
// (SECURITY.md §5.1). Restricted UI surface — the API enforces the
// real role check (admin / operations for verify, admin for reject),
// so unauthorized users get a 403 on click rather than a hidden button.
// Rendering the buttons anyway avoids leaking role info via the UI.
export function AgentActions({ agent }: { agent: Agent }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isVerified = agent.verifiedAt !== null && agent.rejectedAt === null;
  const isRejected = agent.rejectedAt !== null;

  function verify() {
    setError(null);
    startTransition(async () => {
      try {
        await verifyAgent(agent.id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Verify failed");
      }
    });
  }
  function reject() {
    if (
      !confirm(
        `Mark ${agent.phoneNumber} as a confirmed scammer/spammer? Their messages will stay quarantined.`
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await rejectAgent(agent.id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Reject failed");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {!isVerified && (
          <button
            type="button"
            onClick={verify}
            disabled={pending}
            className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:bg-slate-300"
          >
            {isRejected ? "Re-verify" : "Verify"}
          </button>
        )}
        {!isRejected && (
          <button
            type="button"
            onClick={reject}
            disabled={pending}
            className="rounded-md border border-rose-300 px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:bg-slate-100"
          >
            Reject
          </button>
        )}
      </div>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
