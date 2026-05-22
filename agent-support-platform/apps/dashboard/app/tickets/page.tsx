import Link from "next/link";
import { fetchTickets } from "@/lib/api";
import type { Severity, TicketStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const severityStyles: Record<Severity, string> = {
  critical: "bg-red-100 text-red-800 ring-red-200",
  high: "bg-orange-100 text-orange-800 ring-orange-200",
  medium: "bg-amber-100 text-amber-800 ring-amber-200",
  low: "bg-slate-100 text-slate-700 ring-slate-200",
};

const statusStyles: Record<TicketStatus, string> = {
  open: "bg-blue-100 text-blue-800",
  in_progress: "bg-violet-100 text-violet-800",
  waiting_on_agent: "bg-yellow-100 text-yellow-800",
  resolved: "bg-emerald-100 text-emerald-800",
  closed: "bg-slate-100 text-slate-600",
};

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatDeadline(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs < 0) return "overdue";
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}

export default async function TicketsPage() {
  let data;
  let error: string | null = null;
  try {
    data = await fetchTickets({ limit: 100 });
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Tickets</h1>
        {data && (
          <span className="text-sm text-slate-500">
            {data.total} total
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

      {data && data.tickets.length === 0 && (
        <div className="rounded-md border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No tickets yet. Send a message to the Twilio WhatsApp sandbox to create one.
        </div>
      )}

      {data && data.tickets.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Severity</th>
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">Latest message</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">SLA</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.tickets.map((t) => {
                const latest = t.messages[0];
                return (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/tickets/${t.id}`} className="block">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${severityStyles[t.severity]}`}
                        >
                          {t.severity}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/tickets/${t.id}`} className="block">
                        <div className="font-medium text-slate-900">{t.agent.name}</div>
                        <div className="text-xs text-slate-500">
                          {t.agent.branch.name} · {t.agent.country}
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 max-w-md">
                      <Link href={`/tickets/${t.id}`} className="block">
                        <div className="truncate text-slate-700">
                          {latest?.translatedText || latest?.originalText || "—"}
                        </div>
                        {t.tags.length > 0 && (
                          <div className="mt-1 flex gap-1">
                            {t.tags.slice(0, 3).map((tag) => (
                              <span
                                key={tag}
                                className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/tickets/${t.id}`} className="block">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs ${statusStyles[t.status]}`}
                        >
                          {t.status.replace(/_/g, " ")}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <Link href={`/tickets/${t.id}`} className="block">
                        {formatDeadline(t.slaFirstResponseDeadline)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      <Link href={`/tickets/${t.id}`} className="block">
                        {formatRelative(t.createdAt)}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
