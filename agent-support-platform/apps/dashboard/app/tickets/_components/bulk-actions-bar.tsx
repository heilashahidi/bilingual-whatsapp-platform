"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTicket, type TicketPatch } from "@/lib/api";
import type { InternalUser, Severity } from "@/lib/types";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

// Floating bar that appears when 1+ tickets are checkbox-selected on the
// kanban. Applies a single patch to every selected ticket; failures show
// inline. Optimistic UI is unnecessary because realtime push refreshes
// the cards within ~100ms of the last PATCH completing.
export function BulkActionsBar({
  selectedIds,
  users,
  onClear,
  onAfterAction,
}: {
  selectedIds: Set<string>;
  users: InternalUser[];
  onClear: () => void;
  onAfterAction: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (selectedIds.size === 0) return null;

  const ids = Array.from(selectedIds);

  function bulkPatch(patch: TicketPatch) {
    setError(null);
    startTransition(async () => {
      const results = await Promise.allSettled(
        ids.map((id) => updateTicket(id, patch))
      );
      const failures = results.filter((r) => r.status === "rejected").length;
      if (failures) {
        setError(
          `${failures} of ${ids.length} updates failed. Some tickets may have changed; the page will refresh.`
        );
      }
      router.refresh();
      onAfterAction();
    });
  }

  return (
    <div className="fixed inset-x-0 bottom-4 z-40 mx-auto flex max-w-3xl items-center gap-3 rounded-full bg-slate-900 px-4 py-2.5 shadow-lg ring-1 ring-slate-700">
      <span className="text-sm font-medium text-white">
        {selectedIds.size} selected
      </span>

      <div className="h-5 w-px bg-slate-600" />

      {/* Severity */}
      <select
        defaultValue=""
        disabled={pending}
        onChange={(e) => {
          if (e.target.value) {
            bulkPatch({ severity: e.target.value as Severity });
            e.target.value = "";
          }
        }}
        className="rounded-md bg-slate-800 px-2 py-1 text-xs text-white"
      >
        <option value="" disabled>
          Severity…
        </option>
        {SEVERITIES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      {/* Assignee */}
      <select
        defaultValue=""
        disabled={pending}
        onChange={(e) => {
          if (e.target.value === "__UNASSIGN__") {
            bulkPatch({ assignedTo: null });
            e.target.value = "";
          } else if (e.target.value) {
            bulkPatch({ assignedTo: e.target.value });
            e.target.value = "";
          }
        }}
        className="rounded-md bg-slate-800 px-2 py-1 text-xs text-white"
      >
        <option value="" disabled>
          Assign…
        </option>
        <option value="__UNASSIGN__">Unassign</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => bulkPatch({ status: "resolved" })}
        disabled={pending}
        className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        Resolve
      </button>
      <button
        type="button"
        onClick={() => bulkPatch({ status: "closed" })}
        disabled={pending}
        className="rounded-md bg-slate-700 px-2 py-1 text-xs font-medium text-white hover:bg-slate-600 disabled:opacity-50"
      >
        Close
      </button>

      <div className="h-5 w-px bg-slate-600" />

      <button
        type="button"
        onClick={onClear}
        disabled={pending}
        className="text-xs text-slate-300 hover:text-white"
      >
        Clear
      </button>

      {error && (
        <span className="ml-2 max-w-xs truncate text-xs text-red-300">
          {error}
        </span>
      )}
    </div>
  );
}
