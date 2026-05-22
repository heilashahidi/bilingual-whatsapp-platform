"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
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
import type {
  InternalUser,
  Severity,
  Ticket,
  TicketStatus,
} from "@/lib/types";
import { SlaTimer } from "./sla-timer";
import { readFiltersFromParams } from "./filters-bar";
import { BulkActionsBar } from "./bulk-actions-bar";

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

export function KanbanBoard({
  tickets: serverTickets,
  users,
}: {
  tickets: Ticket[];
  users: InternalUser[];
}) {
  // Local state shadows server props for optimistic drag-drop. Resyncs when
  // server pushes new data (via realtime refresh).
  const [tickets, setTickets] = useState(serverTickets);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const searchParams = useSearchParams();
  const { data: session } = useSession();

  useEffect(() => {
    setTickets(serverTickets);
  }, [serverTickets]);

  // Require 8px of movement before a drag activates, so a click still
  // navigates via the Link wrapper.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Filter tickets according to URL params (managed by FiltersBar).
  const filtered = useMemo(() => {
    const filters = readFiltersFromParams(
      new URLSearchParams(searchParams.toString())
    );
    const myId = (session?.user as { id?: string } | undefined)?.id;
    const q = filters.search.trim().toLowerCase();

    return tickets.filter((t) => {
      if (filters.severities.size && !filters.severities.has(t.severity))
        return false;
      if (filters.countries.size && !filters.countries.has(t.agent.country))
        return false;
      if (filters.assigneeId === "me") {
        if (!myId || t.assignedTo !== myId) return false;
      } else if (filters.assigneeId === "unassigned") {
        if (t.assignedTo) return false;
      } else if (filters.assigneeId) {
        if (t.assignedTo !== filters.assigneeId) return false;
      }
      if (q) {
        const hay = [
          t.agent.name,
          t.agent.branch.name,
          t.agent.phoneNumber,
          ...t.tags,
          t.messages[0]?.translatedText ?? "",
          t.messages[0]?.originalText ?? "",
          t.category,
          t.productArea ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tickets, searchParams, session]);

  const grouped: Record<KanbanStatus, Ticket[]> = {
    open: [],
    in_progress: [],
    waiting_on_agent: [],
    resolved: [],
  };
  for (const t of filtered) {
    if (t.status === "closed") continue;
    grouped[t.status as KanbanStatus]?.push(t);
  }

  const activeTicket = activeId ? tickets.find((t) => t.id === activeId) : null;

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

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
            selected={selected}
            onToggleSelect={toggleSelect}
          />
        ))}
      </div>

      <DragOverlay>
        {activeTicket ? <CardContent ticket={activeTicket} dragging /> : null}
      </DragOverlay>

      <BulkActionsBar
        selectedIds={selected}
        users={users}
        onClear={clearSelection}
        onAfterAction={() => clearSelection()}
      />
    </DndContext>
  );
}

function Column({
  status,
  label,
  accent,
  tickets,
  selected,
  onToggleSelect,
}: {
  status: KanbanStatus;
  label: string;
  accent: string;
  tickets: Ticket[];
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={`flex h-[calc(100vh-14rem)] min-h-[24rem] flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-50/50 transition-colors ${
        isOver ? "ring-2 ring-slate-400 bg-slate-100" : ""
      }`}
    >
      <div
        className={`flex shrink-0 items-center justify-between border-b px-3 py-2 ${accent}`}
      >
        <h2 className="text-sm font-semibold text-slate-800">{label}</h2>
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium text-slate-700">
          {tickets.length}
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {tickets.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-slate-400">
            drop tickets here
          </div>
        ) : (
          tickets.map((t) => (
            <DraggableCard
              key={t.id}
              ticket={t}
              isSelected={selected.has(t.id)}
              onToggleSelect={onToggleSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}

function DraggableCard({
  ticket,
  isSelected,
  onToggleSelect,
}: {
  ticket: Ticket;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
}) {
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
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="relative">
      {/* Checkbox sits over the card. Stops propagation so neither drag nor link fire. */}
      <label
        className="absolute right-2 top-2 z-10 flex h-5 w-5 cursor-pointer items-center justify-center"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => {
            e.stopPropagation();
            onToggleSelect(ticket.id);
          }}
          className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-slate-900"
        />
      </label>
      <Link
        href={`/tickets/${ticket.id}`}
        className={`block rounded-md bg-white p-3 ring-1 transition hover:shadow-sm ${
          isSelected
            ? "ring-2 ring-slate-700"
            : "ring-slate-200 hover:ring-slate-400"
        }`}
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
      <div className="mb-2 flex items-center justify-between gap-2 pr-6">
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
