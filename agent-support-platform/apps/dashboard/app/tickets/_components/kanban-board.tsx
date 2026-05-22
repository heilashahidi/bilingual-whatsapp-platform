"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

import { updateTicket } from "@/lib/api";
import type { Severity, Ticket, TicketStatus } from "@/lib/types";
import { SlaTimer } from "./sla-timer";

type KanbanStatus = Exclude<TicketStatus, "closed">;

const COLUMNS: { status: KanbanStatus; label: string; accent: string }[] = [
  { status: "open", label: "Open", accent: "bg-blue-50 border-blue-200" },
  { status: "in_progress", label: "In progress", accent: "bg-violet-50 border-violet-200" },
  { status: "waiting_on_agent", label: "Waiting on agent", accent: "bg-yellow-50 border-yellow-200" },
  { status: "resolved", label: "Resolved", accent: "bg-emerald-50 border-emerald-200" },
];

const severityStyles: Record<Severity, string> = {
  critical: "bg-red-100 text-red-800 ring-red-200",
  high: "bg-orange-100 text-orange-800 ring-orange-200",
  medium: "bg-amber-100 text-amber-800 ring-amber-200",
  low: "bg-slate-100 text-slate-700 ring-slate-200",
};

export function KanbanBoard({ tickets: serverTickets }: { tickets: Ticket[] }) {
  // Local state shadows server props for optimistic drag-drop. Resyncs when
  // server pushes new data (via realtime refresh).
  const [tickets, setTickets] = useState(serverTickets);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTickets(serverTickets);
  }, [serverTickets]);

  // Require 8px of movement before a drag activates, so a click still
  // navigates via the Link wrapper.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const grouped: Record<KanbanStatus, Ticket[]> = {
    open: [],
    in_progress: [],
    waiting_on_agent: [],
    resolved: [],
  };
  for (const t of tickets) {
    if (t.status === "closed") continue;
    grouped[t.status as KanbanStatus]?.push(t);
  }

  const activeTicket = activeId ? tickets.find((t) => t.id === activeId) : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    setError(null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const newStatus = String(over.id) as KanbanStatus;
    const ticketId = String(active.id);
    const ticket = tickets.find((t) => t.id === ticketId);
    if (!ticket || ticket.status === newStatus) return;

    // Optimistic update
    const previousStatus = ticket.status;
    setTickets((prev) =>
      prev.map((t) =>
        t.id === ticketId ? { ...t, status: newStatus } : t
      )
    );

    try {
      await updateTicket(ticketId, { status: newStatus });
      // The server will emit `ticket:changed` → RealtimeRefresh triggers a
      // refresh → useEffect resyncs from serverTickets.
    } catch (e) {
      // Revert
      setTickets((prev) =>
        prev.map((t) =>
          t.id === ticketId ? { ...t, status: previousStatus } : t
        )
      );
      setError(e instanceof Error ? e.message : "Failed to move ticket");
    }
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => (
          <Column
            key={col.status}
            status={col.status}
            label={col.label}
            accent={col.accent}
            tickets={grouped[col.status]}
          />
        ))}
      </div>

      <DragOverlay>
        {activeTicket ? <CardContent ticket={activeTicket} dragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  status,
  label,
  accent,
  tickets,
}: {
  status: KanbanStatus;
  label: string;
  accent: string;
  tickets: Ticket[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-lg border bg-slate-50/50 border-slate-200 min-h-[60vh] transition-colors ${
        isOver ? "ring-2 ring-slate-400 bg-slate-100" : ""
      }`}
    >
      <div
        className={`flex items-center justify-between rounded-t-lg border-b px-3 py-2 ${accent}`}
      >
        <h2 className="text-sm font-semibold text-slate-800">{label}</h2>
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium text-slate-700">
          {tickets.length}
        </span>
      </div>
      <div className="flex-1 space-y-2 p-2">
        {tickets.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-slate-400">
            drop tickets here
          </div>
        ) : (
          tickets.map((t) => <DraggableCard key={t.id} ticket={t} />)
        )}
      </div>
    </div>
  );
}

function DraggableCard({ ticket }: { ticket: Ticket }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: ticket.id });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
        // Hide the original spot while the overlay renders the moving card
        opacity: isDragging ? 0 : 1,
      }
    : undefined;

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Link
        href={`/tickets/${ticket.id}`}
        className="block rounded-md bg-white p-3 ring-1 ring-slate-200 transition hover:ring-slate-400 hover:shadow-sm"
      >
        <CardContent ticket={ticket} />
      </Link>
    </div>
  );
}

function CardContent({
  ticket,
  dragging = false,
}: {
  ticket: Ticket;
  dragging?: boolean;
}) {
  const latest = ticket.messages[0];
  const snippet =
    latest?.translatedText || latest?.originalText || "(no messages)";

  return (
    <div
      className={
        dragging
          ? "rounded-md bg-white p-3 ring-1 ring-slate-400 shadow-lg cursor-grabbing"
          : "cursor-grab"
      }
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${severityStyles[ticket.severity]}`}
        >
          {ticket.severity}
        </span>
        <SlaTimer deadline={ticket.slaFirstResponseDeadline} />
      </div>

      <div className="text-sm font-medium text-slate-900 truncate">
        {ticket.agent.name}
      </div>
      <div className="text-xs text-slate-500 truncate">
        {ticket.agent.branch.name} · {ticket.agent.country}
      </div>

      <p className="mt-2 text-sm text-slate-700 line-clamp-2">{snippet}</p>

      {ticket.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {ticket.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {ticket.incident && (
        <div className="mt-2 rounded bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700">
          incident: {ticket.incident.title}
        </div>
      )}
    </div>
  );
}
