import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchIncident } from "@/lib/api";
import { getServerApiToken } from "@/lib/auth-server";
import { IncidentDetailView } from "./_components/incident-detail-view";

export const dynamic = "force-dynamic";

export default async function IncidentDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const token = await getServerApiToken();
  let incident;
  let error: string | null = null;
  try {
    incident = await fetchIncident(params.id, token);
  } catch (e) {
    const status = e instanceof Error ? e.message : "";
    if (status.includes("404")) notFound();
    error = e instanceof Error ? e.message : "Unknown error";
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link
        href="/incidents"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
          <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to incidents
      </Link>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <div className="font-medium">Failed to load incident</div>
          <div className="mt-1 text-rose-700">{error}</div>
        </div>
      )}

      {incident && <IncidentDetailView incident={incident} />}
    </div>
  );
}
