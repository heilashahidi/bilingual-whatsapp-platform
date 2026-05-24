"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Agent, Country, Severity, TicketCategory } from "@/lib/types";
import { fetchAgents, createOutreachTicket } from "@/lib/api";

// "Outreach" ticket — initiated by the support team rather than by an
// inbound WhatsApp from the field. The flow is:
//
//   1. Pick an agent (search by name / phone / branch)
//   2. Compose the first message in English
//   3. Set severity + category + optional tags
//   4. Submit → backend translates the message into the agent's preferred
//      language, sends via WhatsApp, and creates the ticket as if the
//      agent had opened it (status="open", direction of first message is
//      "outbound").
//
// Requires backend endpoint: POST /api/tickets/outreach
//   See lib/api.ts → createOutreachTicket for the request shape.

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const CATEGORIES: { value: TicketCategory; label: string }[] = [
  { value: "bug_report", label: "Bug report" },
  { value: "operational_complaint", label: "Operational complaint" },
  { value: "feature_request", label: "Feature request" },
  { value: "question", label: "Question" },
  { value: "other", label: "Other" },
];

const COUNTRY_LANG: Record<Country, string> = {
  HT: "Kreyòl",
  DO: "Español",
  CD: "Français",
};


export function NewTicketModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Form
  const [agent, setAgent] = useState<Agent | null>(null);
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [category, setCategory] = useState<TicketCategory>("question");

  // Esc to close + body scroll lock
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const canSubmit = !!agent && message.trim().length > 0 && !pending;

  function submit() {
    if (!canSubmit || !agent) return;
    setError(null);
    startTransition(async () => {
      try {
        const created = await createOutreachTicket({
          agentId: agent.id,
          message: message.trim(),
          severity,
          category,
        });
        router.refresh();
        onClose();
        // Navigate to the new ticket so the user can keep the thread open.
        router.push(`/tickets/${created.id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create ticket");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">New outreach ticket</h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              Open a thread with a field agent. Your message is auto-translated to their language.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          {/* Agent picker */}
          <Field label="Agent" hint={agent ? `Will receive in ${COUNTRY_LANG[agent.country]}` : "Search by name, phone, or branch"}>
            <AgentPicker value={agent} onChange={setAgent} />
          </Field>

          {/* Message */}
          <Field
            label="Message (English)"
            hint={agent ? `Auto-translated to ${COUNTRY_LANG[agent.country]} on send` : "Choose an agent first"}
          >
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Hi — checking in on yesterday's cashout issue. Are the failures still happening?"
              rows={4}
              className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13.5px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15"
            />
          </Field>

          {/* Severity + Category */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Severity">
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as Severity)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] capitalize text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15"
              >
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Category">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as TicketCategory)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15"
              >
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
          </div>

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
              {error}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <span className="text-[11.5px] text-slate-500">
            ⌘↵ to send
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[13px] font-medium text-white shadow-sm hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Sending…" : "Send & open ticket"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-slate-500">{label}</span>
        {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

// Debounced search-as-you-type against /api/agents?q=…
function AgentPicker({ value, onChange }: { value: Agent | null; onChange: (a: Agent | null) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Agent[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    if (q.trim().length < 1 && !results.length) return;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const list = await fetchAgents({ q, limit: 6 });
        setResults(list);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [q, open]);

  // Click outside closes
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="rounded bg-slate-200 px-1.5 py-px font-mono text-[10px] font-semibold tracking-wide text-slate-700">
            {value.country}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-slate-900">{value.name}</div>
            <div className="truncate text-[11.5px] text-slate-500">
              {value.branch.name} · {value.phoneNumber}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { onChange(null); setQ(""); }}
          className="text-[11.5px] font-medium text-slate-500 hover:text-slate-900"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder="Junior Pierre, +509…, Les Cayes…"
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15"
      />
      {open && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {loading && (
            <div className="px-3 py-2 text-[12px] text-slate-400">Searching…</div>
          )}
          {!loading && results.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-slate-400">
              {q.trim() ? "No matches." : "Start typing to search agents."}
            </div>
          )}
          {results.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => { onChange(a); setOpen(false); }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-50"
            >
              <span className="rounded bg-slate-100 px-1.5 py-px font-mono text-[10px] font-semibold tracking-wide text-slate-600">
                {a.country}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-slate-900">{a.name}</div>
                <div className="truncate text-[11.5px] text-slate-500">
                  {a.branch.name} · {a.phoneNumber}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
