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
  Country,
  InternalUser,
  Severity,
  Ticket,
  TicketStatus,
} from "@/lib/types";
import { SlaTimer } from "./sla-timer";
import { readFiltersFromParams } from "./filters-bar";
import { BulkActionsBar } from "./bulk-actions-bar";

type KanbanStatus = Exclude<TicketStatus, "closed">;

// Column accent — controls the small dot beside the column title and the
// "drop zone" ring when a card hovers. Keep palettes muted so cards stand out.
const COLUMNS: {
  status: KanbanStatus;
  label: string;
  dotClass: string;
  ringClass: string;
}[] = [
  { status: "open",             label: "Open",             dotClass: "bg-sky-500",     ringClass: "ring-sky-300/60 bg-sky-50/60" },
  { status: "in_progress",      label: "In progress",      dotClass: "bg-violet-500",  ringClass: "ring-violet-300/60 bg-violet-50/60" },
  { status: "waiting_on_agent", label: "Waiting on agent", dotClass: "bg-amber-500",   ringClass: "ring-amber-300/60 bg-amber-50/60" },
  { status: "resolved",         label: "Resolved",         dotClass: "bg-emerald-500", ringClass: "ring-emerald-300/60 bg-emerald-50/60" },
];

const severityStyles: Record<Severity, { chip: string; dot: string }> = {
  critical: { chip: "bg-rose-50    text-rose-700    ring-rose-200/80",    dot: "bg-rose-500" },
  high:     { chip: "bg-orange-50  text-orange-700  ring-orange-200/80",  dot: "bg-orange-500" },
  medium:   { chip: "bg-amber-50   text-amber-700   ring-amber-200/80",   dot: "bg-amber-500" },
  low:      { chip: "bg-slate-50   text-slate-600   ring-slate-200",      dot: "bg-slate-400" },
};

const COUNTRY_META: Record<Country, { flag: string; label: string; langCode: string; langLabel: string }> = {
  HT: { flag: "🇭🇹", label: "Haiti",              langCode: "ht", langLabel: "Kreyòl" },
  DO: { flag: "🇩🇴", label: "Dominican Republic", langCode: "es", langLabel: "Español" },
  CD: { flag: "🇨🇩", label: "DR Congo",           langCode: "fr", langLabel: "Français" },
};

const CONNECTIVITY_DOT: Record<string, string> = {
  online:       "bg-emerald-500",
  intermittent: "bg-amber-500",
  offline:      "bg-slate-300",
  unknown:      "bg-slate-300",
};

const CONNECTIVITY_LABEL: Record<string, string> = {
  online:       "Online",
  intermittent: "Intermittent",
  offline:      "Offline",
  unknown:      "Unknown",
};

// Small status dot beside the agent's name. When the agent is "online" we
// add a pulsing halo (Tailwind's animate-ping) so live agents jump out on
// a busy board. Intermittent/offline are quiet — no animation.
function ConnectivityDot({ status }: { status: string }) {
  const color = CONNECTIVITY_DOT[status] ?? CONNECTIVITY_DOT.unknown;
  const isOnline = status === "online";
  return (
    <span
      className="relative inline-flex h-2 w-2 shrink-0"
      title={`Connectivity: ${CONNECTIVITY_LABEL[status] ?? "Unknown"}`}
    >
      {isOnline && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
    </span>
  );
}

export function KanbanBoard({
  tickets: serverTickets,
  users,
  density = "comfortable",
  bilingual = true,
}: {
  tickets: Ticket[];
  users: InternalUser[];
  density?: "comfortable" | "compact";
  bilingual?: boolean;
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
      if (filters.severities.size && !filters.severities.has(t.severity)) return false;
      if (filters.countries.size && !filters.countries.has(t.agent.country)) return false;
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
        ].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tickets, searchParams, session]);

  const grouped: Record<KanbanStatus, Ticket[]> = {
    open: [], in_progress: [], waiting_on_agent: [], resolved: [],
  };
  for (const t of filtered) {
    if (t.status === "closed") continue;
    grouped[t.status as KanbanStatus]?.push(t);
  }

  const userById = useMemo(() => {
    const m = new Map(users.map((u) => [u.id, u] as const));
    return (id: string | null) => (id ? m.get(id) ?? null : null);
  }, [users]);

  const activeTicket = activeId ? tickets.find((t) => t.id === activeId) : null;

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function clearSelection() { setSelected(new Set()); }

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

    const previousStatus = ticket.status;
    setTickets((prev) =>
      prev.map((t) => (t.id === ticketId ? { ...t, status: newStatus } : t))
    );

    try {
      await updateTicket(ticketId, { status: newStatus });
    } catch (e) {
      setTickets((prev) =>
        prev.map((t) => (t.id === ticketId ? { ...t, status: previousStatus } : t))
      );
      setError(e instanceof Error ? e.message : "Failed to move ticket");
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {error && (
        <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => (
          <Column
            key={col.status}
            status={col.status}
            label={col.label}
            dotClass={col.dotClass}
            ringClass={col.ringClass}
            tickets={grouped[col.status]}
            selected={selected}
            onToggleSelect={toggleSelect}
            userById={userById}
            density={density}
            bilingual={bilingual}
          />
        ))}
      </div>

      <DragOverlay>
        {activeTicket ? (
          <CardContent ticket={activeTicket} userById={userById} density={density} bilingual={bilingual} dragging />
        ) : null}
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
  dotClass,
  ringClass,
  tickets,
  selected,
  onToggleSelect,
  userById,
  density,
  bilingual,
}: {
  status: KanbanStatus;
  label: string;
  dotClass: string;
  ringClass: string;
  tickets: Ticket[];
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  userById: (id: string | null) => InternalUser | null;
  density: "comfortable" | "compact";
  bilingual: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={`flex h-[calc(100vh-14rem)] min-h-[24rem] flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70 transition-colors ${
        isOver ? `ring-2 ${ringClass}` : ""
      }`}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white/80 px-3 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${dotClass}`} />
          <h2 className="text-[13px] font-semibold tracking-tight text-slate-800">
            {label}
          </h2>
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">
            {tickets.length}
          </span>
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {tickets.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 px-2 py-8 text-center text-[11px] text-slate-400">
            drop tickets here
          </div>
        ) : (
          tickets.map((t) => (
            <DraggableCard
              key={t.id}
              ticket={t}
              isSelected={selected.has(t.id)}
              onToggleSelect={onToggleSelect}
              userById={userById}
              density={density}
              bilingual={bilingual}
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
  userById,
  density,
  bilingual,
}: {
  ticket: Ticket;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  userById: (id: string | null) => InternalUser | null;
  density: "comfortable" | "compact";
  bilingual: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: ticket.id });

  const style = transform
    ? { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0 : 1 }
    : undefined;

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="relative">
      <label
        className="absolute right-2.5 top-2.5 z-10 flex h-5 w-5 cursor-pointer items-center justify-center"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => { e.stopPropagation(); onToggleSelect(ticket.id); }}
          className="h-3.5 w-3.5 cursor-pointer rounded border-slate-300 text-emerald-600 accent-emerald-600 focus:ring-emerald-500"
        />
      </label>
      <Link
        href={`/tickets/${ticket.id}`}
        className={`block rounded-lg bg-white ${density === "compact" ? "p-2.5" : "p-3"} ring-1 transition hover:-translate-y-px hover:shadow-md ${
          isSelected
            ? "ring-2 ring-emerald-500"
            : "ring-slate-200 hover:ring-slate-300"
        }`}
      >
        <CardContent ticket={ticket} userById={userById} density={density} bilingual={bilingual} />
      </Link>
    </div>
  );
}

function CardContent({
  ticket,
  userById,
  density = "comfortable",
  bilingual = true,
  dragging = false,
}: {
  ticket: Ticket;
  userById: (id: string | null) => InternalUser | null;
  density?: "comfortable" | "compact";
  bilingual?: boolean;
  dragging?: boolean;
}) {
  const latest = ticket.messages[0];
  const translated = latest?.translatedText || "";
  const original = latest?.originalText || "";
  const snippet = translated || original || "(no messages)";
  const country = COUNTRY_META[ticket.agent.country];
  const sev = severityStyles[ticket.severity];
  const assignee = userById(ticket.assignedTo);
  const isCompact = density === "compact";
  const connDot = CONNECTIVITY_DOT[ticket.agent.connectivityStatus] ?? CONNECTIVITY_DOT.unknown;

  return (
    <div
      className={
        dragging
          ? "cursor-grabbing rounded-lg bg-white p-3 shadow-xl ring-1 ring-slate-300"
          : "cursor-grab"
      }
    >
      {/* Row 1 — severity + SLA */}
      <div className="mb-2 flex items-center justify-between gap-2 pr-6">
        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${sev.chip}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${sev.dot}`} />
          {ticket.severity}
        </span>
        <SlaTimer deadline={ticket.slaFirstResponseDeadline} />
      </div>

      {/* Row 2 — ticket meta */}
      <div className="mb-2 flex items-center gap-1.5 text-[11px] text-slate-500">
        <span className="font-mono">#{ticket.id.slice(0, 6)}</span>
        <span className="text-slate-300">·</span>
        <span title={`${country.label} · ${country.langLabel}`} className="inline-flex items-center gap-1">
          <span className="text-xs leading-none">{country.flag}</span>
          <span className="font-mono">{ticket.agent.country}</span>
        </span>
        <span className="inline-flex items-center rounded border border-slate-200 bg-slate-50 px-1 py-px font-mono text-[9.5px] uppercase tracking-wide text-slate-600">
          {country.langCode}
        </span>
      </div>

      {/* Message: translated (primary) + original (italic, dimmed) */}
      <p className="line-clamp-2 text-sm leading-snug text-slate-900">
        {snippet}
      </p>
      {bilingual && !isCompact && original && original !== translated && (
        <p
          dir="auto"
          className="mt-1 line-clamp-1 border-l-2 border-slate-200 pl-2 text-[11.5px] italic leading-snug text-slate-500"
        >
          {original}
        </p>
      )}

      {/* Agent row */}
      <div className="mt-2.5 flex items-center gap-2">
        <ConnectivityDot status={ticket.agent.connectivityStatus} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-slate-900">
            {ticket.agent.name}
          </div>
          <div className="truncate text-[11px] text-slate-500">
            {ticket.agent.branch.name}
          </div>
        </div>
        <AssigneeAvatar user={assignee} />
      </div>

      {/* Tags */}
      {!isCompact && ticket.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {ticket.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-600"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Incident grouping pill */}
      {ticket.incident && (
        <div className="mt-2 flex items-center gap-1.5 rounded-md border border-rose-200/70 bg-rose-50 px-2 py-1 text-[10.5px] font-medium text-rose-700">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
            <path d="M12 2L2 22h20L12 2z"/><path d="M12 9v5"/><circle cx="12" cy="18" r="1" fill="currentColor"/>
          </svg>
          <span className="truncate">incident: {ticket.incident.title}</span>
        </div>
      )}

      {/* Resolution summary — shows on resolved cards so triage can see at
          a glance what was done. Requires `resolutionSummary` to be present
          on the list response (not just TicketDetail). */}
      {ticket.status === "resolved" && ticket.resolutionSummary && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-[10.5px] leading-snug text-emerald-700 ring-1 ring-inset ring-emerald-200/70">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="mt-0.5 shrink-0" aria-hidden>
            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="line-clamp-2">{ticket.resolutionSummary}</span>
        </div>
      )}
    </div>
  );
}

function AssigneeAvatar({ user }: { user: InternalUser | null }) {
  if (!user) {
    return (
      <span
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-400"
        title="Unassigned"
        aria-label="Unassigned"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>
        </svg>
      </span>
    );
  }
  const initials = user.name.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  // Derive a stable hue from the user id so avatars stay distinct without a
  // hand-maintained color table.
  const hue = [...user.id].reduce((n, c) => n + c.charCodeAt(0), 0) % 360;
  return (
    <span
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9.5px] font-semibold"
      title={user.name}
      style={{
        background: `oklch(0.92 0.06 ${hue})`,
        color: `oklch(0.30 0.10 ${hue})`,
      }}
    >
      {initials}
    </span>
  );
}
