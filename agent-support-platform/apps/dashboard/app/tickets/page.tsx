import Link from "next/link";
import { fetchTickets } from "@/lib/api";
import { RealtimeRefresh } from "@/lib/realtime-refresh";
import type { Severity, Ticket, TicketStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const severityStyles: Record<Severity, string> = {
  critical: "bg-red-100 text-red-800 ring-red-200",
  high: "bg-orange-100 text-orange-800 ring-orange-200",
  medium: "bg-amber-100 text-amber-800 ring-amber-200",
  low: "bg-slate-100 text-slate-700 ring-slate-200",
};

type KanbanStatus = Exclude<TicketStatus, "closed">;

const COLUMNS: { status: KanbanStatus; label: string; accent: string }[] = [
  { status: "open", label: "Open", accent: "bg-blue-50 border-blue-200" },
  { status: "in_progress", label: "In progress", accent: "bg-violet-50 border-violet-200" },
  { status: "waiting_on_agent", label: "Waiting on agent", accent: "bg-yellow-50 border-yellow-200" },
  { status: "resolved", label: "Resolved", accent: "bg-emerald-50 border-emerald-200" },
];

function formatDeadline(iso: string | null): { text: string; color: string } {
  if (!iso) return { text: "no SLA", color: "text-slate-400" };
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs < 0) {
    const mins = Math.round(-diffMs / 60000);
    if (mins < 60) return { text: `overdue ${mins}m`, color: "text-red-600 font-medium" };
    const hours = Math.round(mins / 60);
    return { text: `overdue ${hours}h`, color: "text-red-600 font-medium" };
  }
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return { text: `${mins}m left`, color: mins < 30 ? "text-amber-600" : "text-slate-600" };
  const hours = Math.round(mins / 60);
  if (hours < 24) return { text: `${hours}h left`, color: hours < 4 ? "text-amber-600" : "text-slate-600" };
  const days = Math.round(hours / 24);
  return { text: `${days}d left`, color: "text-slate-500" };
}

function TicketCard({ ticket }: { ticket: Ticket }) {
  const latest = ticket.messages[0];
  const sla = formatDeadline(ticket.slaFirstResponseDeadline);
  const snippet = latest?.translatedText || latest?.originalText || "(no messages)";

  return (
    <Link
      href={`/tickets/${ticket.id}`}
      className="block rounded-md bg-white p-3 ring-1 ring-slate-200 transition hover:ring-slate-400 hover:shadow-sm"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${severityStyles[ticket.severity]}`}
        >
          {ticket.severity}
        </span>
        <span className={`text-xs ${sla.color}`}>{sla.text}</span>
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
    </Link>
  );
}

function Column({
  label,
  status,
  accent,
  tickets,
}: {
  label: string;
  status: KanbanStatus;
  accent: string;
  tickets: Ticket[];
}) {
  return (
    <div className="flex flex-col rounded-lg border bg-slate-50/50 border-slate-200 min-h-[60vh]">
      <div className={`flex items-center justify-between rounded-t-lg border-b px-3 py-2 ${accent}`}>
        <h2 className="text-sm font-semibold text-slate-800">{label}</h2>
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium text-slate-700">
          {tickets.length}
        </span>
      </div>
      <div className="flex-1 space-y-2 p-2">
        {tickets.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-slate-400">
            no tickets
          </div>
        ) : (
          tickets.map((t) => <TicketCard key={t.id} ticket={t} />)
        )}
      </div>
    </div>
  );
}

export default async function TicketsPage() {
  let data;
  let error: string | null = null;
  try {
    data = await fetchTickets({ limit: 200 });
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }

  // Group by status; ignore `closed` (hidden from the kanban for now)
  const grouped: Record<KanbanStatus, Ticket[]> = {
    open: [],
    in_progress: [],
    waiting_on_agent: [],
    resolved: [],
  };
  const closedCount = data?.tickets.reduce((n, t) => (t.status === "closed" ? n + 1 : n), 0) ?? 0;

  if (data) {
    for (const t of data.tickets) {
      if (t.status === "closed") continue;
      grouped[t.status as KanbanStatus]?.push(t);
    }
  }

  return (
    <div className="space-y-4">
      <RealtimeRefresh />

      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Tickets</h1>
        {data && (
          <span className="text-sm text-slate-500">
            {data.total} total{closedCount > 0 ? ` · ${closedCount} closed` : ""}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-medium">Failed to load tickets</div>
          <div className="mt-1 text-red-700">{error}</div>
          <div className="mt-2 text-xs text-red-600">
            Is the API running at {process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}?
          </div>
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => (
            <Column
              key={col.status}
              label={col.label}
              status={col.status}
              accent={col.accent}
              tickets={grouped[col.status]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
