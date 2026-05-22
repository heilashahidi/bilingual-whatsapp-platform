import Link from "next/link";
import { fetchIncidents } from "@/lib/api";
import { getServerApiToken } from "@/lib/auth-server";
import type { Country, Incident, IncidentStatus, Severity } from "@/lib/types";

export const dynamic = "force-dynamic";

const statusStyle: Record<IncidentStatus, string> = {
  detected: "bg-rose-100 text-rose-800 ring-rose-200",
  confirmed: "bg-amber-100 text-amber-800 ring-amber-200",
  mitigating: "bg-sky-100 text-sky-800 ring-sky-200",
  resolved: "bg-emerald-100 text-emerald-800 ring-emerald-200",
};

const severityStyle: Record<Severity, string> = {
  critical: "bg-rose-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-amber-400 text-amber-950",
  low: "bg-slate-300 text-slate-800",
};

const countryFlag: Record<Country, string> = {
  HT: "🇭🇹",
  DO: "🇩🇴",
  CD: "🇨🇩",
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

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const token = await getServerApiToken();

  const filterStatus =
    searchParams?.status === "detected" ||
    searchParams?.status === "confirmed" ||
    searchParams?.status === "mitigating" ||
    searchParams?.status === "resolved"
      ? (searchParams.status as IncidentStatus)
      : undefined;

  let incidents: Incident[] = [];
  let error: string | null = null;
  try {
    incidents = await fetchIncidents(
      filterStatus ? { status: filterStatus } : {},
      token
    );
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }

  const activeCount = incidents.filter(
    (i) => i.status === "detected" || i.status === "confirmed"
  ).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Incidents</h1>
        <span className="text-sm text-slate-500">
          {incidents.length} {filterStatus ? `${filterStatus} ` : ""}
          incident{incidents.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <FilterTab href="/incidents" active={!filterStatus}>
          All
        </FilterTab>
        <FilterTab
          href="/incidents?status=detected"
          active={filterStatus === "detected"}
        >
          Detected{activeCount > 0 && !filterStatus ? ` (${activeCount})` : ""}
        </FilterTab>
        <FilterTab
          href="/incidents?status=confirmed"
          active={filterStatus === "confirmed"}
        >
          Confirmed
        </FilterTab>
        <FilterTab
          href="/incidents?status=mitigating"
          active={filterStatus === "mitigating"}
        >
          Mitigating
        </FilterTab>
        <FilterTab
          href="/incidents?status=resolved"
          active={filterStatus === "resolved"}
        >
          Resolved
        </FilterTab>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-medium">Failed to load incidents</div>
          <div className="mt-1">{error}</div>
        </div>
      )}

      {!error && incidents.length === 0 && (
        <div className="rounded-md border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {filterStatus
            ? `No ${filterStatus} incidents.`
            : "No incidents yet. Patterns are auto-detected when 3+ tickets in the same country and category arrive within 30 minutes."}
        </div>
      )}

      {incidents.length > 0 && (
        <ul className="space-y-3">
          {incidents.map((i) => (
            <li
              key={i.id}
              className="rounded-lg border border-slate-200 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex h-5 items-center rounded px-1.5 text-[10px] font-semibold uppercase tracking-wide ${severityStyle[i.severity]}`}
                    >
                      {i.severity}
                    </span>
                    <h3 className="text-sm font-semibold text-slate-900">
                      {i.title}
                    </h3>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusStyle[i.status]}`}
                    >
                      {i.status}
                    </span>
                    {i.isNetworkRelated && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                        network
                      </span>
                    )}
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span>
                      {i.affectedCountries.map((c) => (
                        <span key={c} className="mr-1" title={c}>
                          {countryFlag[c]}
                        </span>
                      ))}
                    </span>
                    <span>
                      {i.ticketCount} ticket{i.ticketCount === 1 ? "" : "s"}
                    </span>
                    <span>
                      {i.affectedBranches.length} branch
                      {i.affectedBranches.length === 1 ? "" : "es"} affected
                    </span>
                    {i.category && <span>{i.category.replace(/_/g, " ")}</span>}
                    <span>detected {formatRelative(i.detectedAt)}</span>
                    {i.resolvedAt && (
                      <span>resolved {formatRelative(i.resolvedAt)}</span>
                    )}
                  </div>

                  {(i.rootCause || i.resolutionNotes) && (
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      {i.rootCause && (
                        <div>
                          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            Root cause
                          </div>
                          <p className="mt-1 line-clamp-3 text-sm text-slate-700">
                            {i.rootCause}
                          </p>
                        </div>
                      )}
                      {i.resolutionNotes && (
                        <div>
                          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            Resolution
                          </div>
                          <p className="mt-1 line-clamp-3 text-sm text-slate-700">
                            {i.resolutionNotes}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <Link
                  href={`/tickets?incident=${i.id}`}
                  className="shrink-0 self-start rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  View tickets →
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition ${
        active
          ? "bg-slate-900 text-white ring-slate-900"
          : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
      }`}
    >
      {children}
    </Link>
  );
}
