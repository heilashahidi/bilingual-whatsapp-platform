"use client";

import type { TicketStatus } from "@/lib/types";
import type { UiPrefs } from "@/lib/ui-prefs";

// Header row that sits between the page title and the FiltersBar.
// Owns: view toggle (kanban/list), density toggle, bilingual toggle,
// New ticket button. All state passes through props — the shell owns it.

export type StatusCounts = Partial<Record<TicketStatus, number>>;

// Order matches the operator's mental flow: incoming → triaged → waiting
// → done. Closed is intentionally excluded — it's archive, not queue
// shape; surfacing the closed count just makes the line longer without
// telling operators anything actionable.
const STATUS_DISPLAY: { key: TicketStatus; label: string }[] = [
  { key: "open",             label: "open" },
  { key: "in_progress",      label: "in progress" },
  { key: "waiting_on_agent", label: "waiting" },
  { key: "resolved",         label: "resolved" },
];

export function PageHeader({
  prefs,
  onPrefsChange,
  onNewTicket,
  statusCounts,
}: {
  prefs: UiPrefs;
  onPrefsChange: (patch: Partial<UiPrefs>) => void;
  onNewTicket: () => void;
  statusCounts?: StatusCounts;
}) {
  const breakdown = statusCounts
    ? STATUS_DISPLAY.filter((s) => (statusCounts[s.key] ?? 0) > 0).map(
        (s) => `${statusCounts[s.key]} ${s.label}`
      )
    : [];

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Tickets
        </h1>
        {breakdown.length > 0 ? (
          <span className="text-sm text-slate-500">
            {breakdown.join(" · ")}
          </span>
        ) : (
          statusCounts && (
            <span className="text-sm text-slate-400">no tickets</span>
          )
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* View toggle — inbox (Front-style three-pane) / kanban / list */}
        <Segmented
          ariaLabel="View"
          value={prefs.view}
          onChange={(v) => onPrefsChange({ view: v as UiPrefs["view"] })}
          options={[
            {
              value: "inbox",
              label: "Inbox",
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M3 7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" />
                  <path d="M3 13h5l1 2h6l1-2h5" />
                </svg>
              ),
            },
            {
              value: "kanban",
              label: "Kanban",
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <rect x="3"  y="4" width="5" height="16" rx="1" />
                  <rect x="10" y="4" width="5" height="10" rx="1" />
                  <rect x="17" y="4" width="4" height="14" rx="1" />
                </svg>
              ),
            },
            {
              value: "list",
              label: "List",
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
                </svg>
              ),
            },
          ]}
        />

        {/* Density toggle */}
        <Segmented
          ariaLabel="Density"
          value={prefs.density}
          onChange={(v) => onPrefsChange({ density: v as UiPrefs["density"] })}
          options={[
            {
              value: "comfortable",
              label: "Comfortable",
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <rect x="4" y="5"  width="16" height="5" rx="1" />
                  <rect x="4" y="14" width="16" height="5" rx="1" />
                </svg>
              ),
            },
            {
              value: "compact",
              label: "Compact",
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
                </svg>
              ),
            },
          ]}
        />

        {/* Bilingual toggle — show agent's original message under translation */}
        <button
          type="button"
          onClick={() => onPrefsChange({ bilingual: !prefs.bilingual })}
          aria-pressed={prefs.bilingual}
          title="Show messages in the field agent's original language instead of the English translation"
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-medium transition ${
            prefs.bilingual
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
          }`}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="M5 8h6M8 5v3M5 14l3-6 3 6M6 12h4M13 16l3-6 3 6M14 14h4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Bilingual
        </button>

        {/* New ticket */}
        <button
          type="button"
          onClick={onNewTicket}
          className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-[12.5px] font-medium text-white shadow-sm transition hover:bg-slate-800"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          New ticket
        </button>
      </div>
    </div>
  );
}

// ── Segmented control ────────────────────────────────────────────────
// 2-option icon/label switch. Icon-only by default, with the label shown
// in a tooltip; if we ever need >2 options, swap for a Radix Toggle Group.

function Segmented<T extends string>({
  ariaLabel,
  value,
  onChange,
  options,
}: {
  ariaLabel: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon: React.ReactNode }[];
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            title={o.label}
            className={`inline-flex h-7 w-9 items-center justify-center rounded-md text-[12px] transition ${
              active
                ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            {o.icon}
            <span className="sr-only">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
