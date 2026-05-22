import type { AuditAction, AuditEvent } from "@/lib/types";

const ACTION_VERB: Record<AuditAction, string> = {
  ticket_created: "created the ticket",
  status_changed: "changed status",
  severity_changed: "changed severity",
  category_changed: "changed category",
  assigned: "assigned",
  unassigned: "unassigned",
  tagged: "updated tags",
  message_sent: "replied to the agent",
  note_added: "added an internal note",
  resolved: "resolved the ticket",
  deleted: "deleted the ticket",
};

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function actorLabel(event: AuditEvent): string {
  if (event.actorEmail) return event.actorEmail.split("@")[0];
  return "System";
}

function diffDescription(event: AuditEvent): string | null {
  const p = event.payload as Record<string, unknown> | null;
  if (!p) return null;
  if (typeof p.from !== "undefined" && typeof p.to !== "undefined") {
    return `${p.from ?? "—"} → ${p.to ?? "—"}`;
  }
  if (event.action === "ticket_created" && typeof p.severity === "string") {
    return `${p.severity} / ${p.category}`;
  }
  if (event.action === "note_added" && typeof p.snippet === "string") {
    return `"${p.snippet}"`;
  }
  if (event.action === "resolved") {
    return p.hasSummary ? "with summary" : "no summary";
  }
  return null;
}

export function ActivityPanel({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Activity
        </h3>
        <p className="text-xs text-slate-400 italic">No activity recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Activity
      </h3>
      <ol className="relative space-y-3 border-l border-slate-200 pl-4">
        {events.map((e) => {
          const detail = diffDescription(e);
          return (
            <li key={e.id} className="relative">
              <span className="absolute -left-[1.07rem] top-1.5 h-2 w-2 rounded-full bg-slate-300 ring-2 ring-white" />
              <div className="text-xs text-slate-700">
                <span className="font-medium text-slate-900">
                  {actorLabel(e)}
                </span>{" "}
                {ACTION_VERB[e.action] || e.action.replace(/_/g, " ")}
                {detail && (
                  <span className="text-slate-500">: {detail}</span>
                )}
              </div>
              <div className="mt-0.5 text-[10px] text-slate-400">
                {formatRelative(e.createdAt)}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
