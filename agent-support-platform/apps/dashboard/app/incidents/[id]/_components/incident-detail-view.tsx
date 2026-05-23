"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateIncident } from "@/lib/api";
import { SEVERITY_DOT, SEVERITY_PILL } from "@/lib/severity-styles";
import type {
  Country,
  IncidentDetail,
  IncidentStatus,
} from "@/lib/types";

const STATUS_FLOW: { key: IncidentStatus; label: string; tone: string }[] = [
  { key: "detected",   label: "Detected",   tone: "border-rose-300 bg-rose-50 text-rose-800" },
  { key: "confirmed",  label: "Confirmed",  tone: "border-amber-300 bg-amber-50 text-amber-800" },
  { key: "mitigating", label: "Mitigating", tone: "border-sky-300 bg-sky-50 text-sky-800" },
  { key: "resolved",   label: "Resolved",   tone: "border-emerald-300 bg-emerald-50 text-emerald-800" },
];

const STATUS_PILL: Record<IncidentStatus, string> = {
  detected:   "bg-rose-100 text-rose-800 ring-rose-200",
  confirmed:  "bg-amber-100 text-amber-800 ring-amber-200",
  mitigating: "bg-sky-100 text-sky-800 ring-sky-200",
  resolved:   "bg-emerald-100 text-emerald-800 ring-emerald-200",
};

const COUNTRY_FLAG: Record<Country, string> = { HT: "🇭🇹", DO: "🇩🇴", CD: "🇨🇩" };
const COUNTRY_LABEL: Record<Country, string> = {
  HT: "Haiti",
  DO: "Dominican Republic",
  CD: "DR Congo",
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

function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function IncidentDetailView({ incident }: { incident: IncidentDetail }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Local draft state for the editable text fields. We keep both the
  // pristine "saved" snapshot and the current draft so we can render
  // a Save button only when the user actually changed something.
  const [rootCauseDraft, setRootCauseDraft] = useState(incident.rootCause ?? "");
  const [resolutionDraft, setResolutionDraft] = useState(
    incident.resolutionNotes ?? ""
  );
  const rootCauseDirty = rootCauseDraft !== (incident.rootCause ?? "");
  const resolutionDirty = resolutionDraft !== (incident.resolutionNotes ?? "");

  function saveStatus(next: IncidentStatus) {
    if (next === incident.status) return;
    setError(null);
    startTransition(async () => {
      try {
        await updateIncident(incident.id, { status: next });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update status");
      }
    });
  }

  function saveRootCause() {
    setError(null);
    startTransition(async () => {
      try {
        await updateIncident(incident.id, { rootCause: rootCauseDraft });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save root cause");
      }
    });
  }

  function saveResolution() {
    setError(null);
    startTransition(async () => {
      try {
        await updateIncident(incident.id, {
          resolutionNotes: resolutionDraft,
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save resolution notes");
      }
    });
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {/* Header — severity, title, status, top-line meta */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex h-5 items-center rounded px-1.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${SEVERITY_PILL[incident.severity]}`}
              >
                {incident.severity}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_PILL[incident.status]}`}
              >
                {incident.status}
              </span>
              {incident.isNetworkRelated && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                  network
                </span>
              )}
            </div>
            <h1 className="mt-2 text-xl font-semibold text-slate-900">
              {incident.title}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              {incident.category && (
                <span>{incident.category.replace(/_/g, " ")}</span>
              )}
              <span>
                {incident.tickets.length} ticket
                {incident.tickets.length === 1 ? "" : "s"}
              </span>
              <span>
                {incident.affectedBranches.length} branch
                {incident.affectedBranches.length === 1 ? "" : "es"} affected
              </span>
              <span title={formatAbsolute(incident.detectedAt)}>
                detected {formatRelative(incident.detectedAt)}
              </span>
              {incident.resolvedAt && (
                <span title={formatAbsolute(incident.resolvedAt)}>
                  resolved {formatRelative(incident.resolvedAt)}
                </span>
              )}
            </div>
          </div>

          <Link
            href={`/tickets?incident=${incident.id}`}
            className="shrink-0 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Open in inbox →
          </Link>
        </div>

        {/* Lifecycle status controls — clicking a stage PATCHes the
            incident. The current stage is highlighted; others are
            available as the next-step. */}
        <div className="mt-5">
          <div className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">
            Lifecycle
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {STATUS_FLOW.map((s) => {
              const isCurrent = incident.status === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => saveStatus(s.key)}
                  disabled={pending || isCurrent}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition disabled:cursor-default ${
                    isCurrent
                      ? `${s.tone} ring-1 ring-inset`
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                  title={
                    isCurrent
                      ? `Already ${s.label.toLowerCase()}`
                      : `Move to ${s.label.toLowerCase()}`
                  }
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Affected countries + branches summary */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SummaryCard label="Affected countries">
          {incident.affectedCountries.length === 0 ? (
            <span className="text-slate-400">None recorded</span>
          ) : (
            <ul className="space-y-1">
              {incident.affectedCountries.map((c) => (
                <li key={c} className="flex items-center gap-2 text-sm">
                  <span aria-hidden className="text-base leading-none">
                    {COUNTRY_FLAG[c]}
                  </span>
                  <span className="text-slate-800">{COUNTRY_LABEL[c]}</span>
                </li>
              ))}
            </ul>
          )}
        </SummaryCard>

        <SummaryCard label="Affected branches">
          {incident.affectedBranches.length === 0 ? (
            <span className="text-slate-400">None recorded</span>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {incident.affectedBranches.map((b) => (
                <li
                  key={b}
                  className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                >
                  {b}
                </li>
              ))}
            </ul>
          )}
        </SummaryCard>
      </div>

      {/* Root cause editor */}
      <FieldCard
        label="Root cause"
        hint="What is actually broken? Be specific so the postmortem is useful."
        dirty={rootCauseDirty}
        pending={pending}
        onSave={saveRootCause}
        onReset={() => setRootCauseDraft(incident.rootCause ?? "")}
      >
        <textarea
          value={rootCauseDraft}
          onChange={(e) => setRootCauseDraft(e.target.value)}
          rows={3}
          placeholder="e.g. iOS 17.4 WebKit regression triggers infinite loop when rendering the withdrawals chart."
          className="w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
        />
      </FieldCard>

      {/* Resolution notes editor */}
      <FieldCard
        label="Resolution notes"
        hint="What did we tell affected agents, and what's the permanent fix?"
        dirty={resolutionDirty}
        pending={pending}
        onSave={saveResolution}
        onReset={() => setResolutionDraft(incident.resolutionNotes ?? "")}
      >
        <textarea
          value={resolutionDraft}
          onChange={(e) => setResolutionDraft(e.target.value)}
          rows={3}
          placeholder="e.g. Broadcast to all affected agents: update to iOS 17.4.1. App v3.8.2 ships next week with native fix."
          className="w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
        />
      </FieldCard>

      {/* Contributing tickets timeline */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
          <div>
            <div className="text-sm font-semibold text-slate-900">
              Contributing tickets
            </div>
            <div className="text-[11px] text-slate-500">
              In order of arrival (newest first)
            </div>
          </div>
          <Link
            href={`/tickets?incident=${incident.id}`}
            className="text-xs text-slate-500 hover:text-slate-900"
          >
            View in inbox →
          </Link>
        </div>
        {incident.tickets.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-slate-400">
            No tickets in this cluster yet.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {incident.tickets.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/tickets?ticket=${t.id}`}
                  className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-slate-50"
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[t.severity]}`}
                    title={`${t.severity} severity`}
                  />
                  <span aria-hidden className="shrink-0 text-sm leading-none">
                    {COUNTRY_FLAG[t.agent.country]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-slate-900">
                      {t.agent.name}
                    </div>
                    <div className="truncate text-[11px] text-slate-500">
                      {t.agent.branch.name}
                    </div>
                  </div>
                  <span className="shrink-0 text-[10.5px] uppercase tracking-wide text-slate-400">
                    {t.status.replace(/_/g, " ")}
                  </span>
                  <span
                    className="shrink-0 text-[11px] text-slate-500"
                    title={formatAbsolute(t.createdAt)}
                  >
                    {formatRelative(t.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function FieldCard({
  label,
  hint,
  dirty,
  pending,
  onSave,
  onReset,
  children,
}: {
  label: string;
  hint?: string;
  dirty: boolean;
  pending: boolean;
  onSave: () => void;
  onReset: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">
            {label}
          </div>
          {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
        </div>
        {dirty && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onReset}
              disabled={pending}
              className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={pending}
              className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:bg-slate-400"
            >
              Save
            </button>
          </div>
        )}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}
