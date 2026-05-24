"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchTicket } from "@/lib/api";
import { getSocket, type TicketChangedEvent } from "@/lib/socket";
import type { Severity, TicketDetail } from "@/lib/types";

interface ToastEntry {
  id: string;
  ticket: TicketDetail;
  kind: "created" | "message";
}

const TOAST_TIMEOUT_MS = 8000;

const severityRing: Record<Severity, string> = {
  critical: "ring-red-300",
  high: "ring-orange-300",
  medium: "ring-amber-300",
  low: "ring-slate-300",
};

const severityBadge: Record<Severity, string> = {
  critical: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-slate-100 text-slate-700",
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const socket = getSocket();

    const handler = async (event: TicketChangedEvent) => {
      // Toast on new tickets and new inbound messages. "updated" events
      // (status/assignment) are too noisy and already covered by RealtimeRefresh.
      if (event.kind !== "created" && event.kind !== "message") return;

      try {
        const ticket = await fetchTicket(event.ticketId);
        // Skip outbound replies — the operator just typed them; no toast needed.
        if (event.kind === "message") {
          const latest = ticket.messages[ticket.messages.length - 1];
          if (latest?.direction !== "inbound") return;
        }
        const id = `${event.ticketId}-${Date.now()}`;
        setToasts((prev) => [...prev, { id, ticket, kind: event.kind as "created" | "message" }]);
        window.setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, TOAST_TIMEOUT_MS);
      } catch (err) {
        // Drop toast silently, but log so a fetch outage is diagnosable.
        console.error("toast-container: fetchTicket failed", err);
      }
    };

    socket.on("ticket:changed", handler);
    return () => {
      socket.off("ticket:changed", handler);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2">
      {toasts.map((t) => (
        <ToastCard
          key={t.id}
          ticket={t.ticket}
          kind={t.kind}
          onDismiss={() => dismiss(t.id)}
        />
      ))}
    </div>
  );
}

function ToastCard({
  ticket,
  kind,
  onDismiss,
}: {
  ticket: TicketDetail;
  kind: "created" | "message";
  onDismiss: () => void;
}) {
  // GET /api/tickets/:id returns messages chronologically (asc); the latest
  // is at the END for message events, the only one for created events.
  const latest =
    kind === "message"
      ? ticket.messages[ticket.messages.length - 1]
      : ticket.messages[0];
  const snippet = latest?.translatedText || latest?.originalText || "(no body)";

  return (
    <div
      className={`pointer-events-auto w-80 rounded-lg bg-white p-3 shadow-lg ring-2 ${severityRing[ticket.severity]} toast-enter`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${severityBadge[ticket.severity]}`}
          >
            {ticket.severity}
          </span>
          <span className="text-xs font-medium text-slate-700">
            {kind === "created" ? "new ticket" : "new reply"}
          </span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-slate-400 hover:text-slate-700"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
      <div className="text-sm font-medium text-slate-900">
        {ticket.agent.name}
      </div>
      <div className="text-xs text-slate-500">
        {ticket.agent.branch.name} · {ticket.agent.country}
      </div>
      <p className="mt-2 line-clamp-2 text-sm text-slate-700">{snippet}</p>
      <Link
        href={`/tickets/${ticket.id}`}
        className="mt-2 inline-block text-xs font-medium text-slate-900 underline hover:text-slate-700"
        onClick={onDismiss}
      >
        View ticket →
      </Link>
    </div>
  );
}
