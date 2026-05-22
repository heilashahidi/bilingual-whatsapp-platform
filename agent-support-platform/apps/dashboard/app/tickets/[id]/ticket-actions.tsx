"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  deleteTicket,
  resolveTicket,
  updateTicket,
  type TicketPatch,
} from "@/lib/api";
import type {
  InternalUser,
  Severity,
  TicketCategory,
  TicketDetail,
  TicketStatus,
} from "@/lib/types";

const STATUSES: TicketStatus[] = [
  "open",
  "in_progress",
  "waiting_on_agent",
  "resolved",
  "closed",
];

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

const CATEGORIES: TicketCategory[] = [
  "bug_report",
  "operational_complaint",
  "feature_request",
  "question",
  "other",
];

export function TicketActions({
  ticket,
  users,
}: {
  ticket: TicketDetail;
  users: InternalUser[];
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolutionSummary, setResolutionSummary] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isOpen = ticket.status !== "resolved" && ticket.status !== "closed";
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";

  function applyPatch(patch: TicketPatch) {
    setError(null);
    startTransition(async () => {
      try {
        await updateTicket(ticket.id, patch);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Update failed");
      }
    });
  }

  function handleResolve() {
    setError(null);
    startTransition(async () => {
      try {
        await resolveTicket(ticket.id, resolutionSummary.trim() || undefined);
        setResolving(false);
        setResolutionSummary("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Resolve failed");
      }
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      try {
        await deleteTicket(ticket.id);
        // Soft-deleted — navigate back to the kanban
        router.push("/tickets");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete failed");
        setConfirmDelete(false);
      }
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Actions
      </h3>

      <Field label="Status">
        <select
          value={ticket.status}
          disabled={pending}
          onChange={(e) =>
            applyPatch({ status: e.target.value as TicketStatus })
          }
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Severity">
        <select
          value={ticket.severity}
          disabled={pending}
          onChange={(e) =>
            applyPatch({ severity: e.target.value as Severity })
          }
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100"
        >
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Category">
        <select
          value={ticket.category}
          disabled={pending}
          onChange={(e) =>
            applyPatch({ category: e.target.value as TicketCategory })
          }
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Assignee">
        <select
          value={ticket.assignedTo || ""}
          disabled={pending}
          onChange={(e) =>
            applyPatch({ assignedTo: e.target.value || null })
          }
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100"
        >
          <option value="">Unassigned</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.role})
            </option>
          ))}
        </select>
      </Field>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {error}
        </div>
      )}

      <div className="pt-2 border-t border-slate-100">
        {isOpen && !resolving && (
          <button
            type="button"
            onClick={() => setResolving(true)}
            disabled={pending}
            className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:bg-slate-300"
          >
            Resolve ticket
          </button>
        )}

        {isOpen && resolving && (
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-600">
              Resolution summary (optional — feeds the knowledge base)
            </label>
            <textarea
              value={resolutionSummary}
              onChange={(e) => setResolutionSummary(e.target.value)}
              rows={3}
              placeholder="What was the problem and how was it fixed?"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              disabled={pending}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleResolve}
                disabled={pending}
                className="flex-1 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:bg-slate-300"
              >
                {pending ? "Resolving…" : "Confirm resolve"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setResolving(false);
                  setResolutionSummary("");
                }}
                disabled={pending}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {!isOpen && (
          <button
            type="button"
            onClick={() => applyPatch({ status: "open" })}
            disabled={pending}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:bg-slate-100"
          >
            Reopen ticket
          </button>
        )}

        {ticket.status === "resolved" && (
          <button
            type="button"
            onClick={() => applyPatch({ status: "closed" })}
            disabled={pending}
            className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:bg-slate-100"
          >
            Close ticket
          </button>
        )}
      </div>

      {/* Admin-only soft delete. Hidden for non-admins entirely. */}
      {isAdmin && (
        <div className="border-t border-slate-200 pt-3">
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={pending}
              className="w-full rounded-md border border-red-200 px-3 py-2 text-xs text-red-700 hover:bg-red-50 disabled:bg-slate-100"
            >
              Delete ticket (admin)
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-red-800">
                Soft-deletes this ticket. The row stays in the database for
                audit; the UI hides it. Sure?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={pending}
                  className="flex-1 rounded-md bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700 disabled:bg-slate-300"
                >
                  {pending ? "Deleting…" : "Confirm delete"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  disabled={pending}
                  className="rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-slate-500">{label}</label>
      {children}
    </div>
  );
}
