"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useSession } from "next-auth/react";
import type { Ticket } from "@/lib/types";

// Front-style left rail. Each inbox is a shortcut that writes a specific
// set of URL params (severity / status / assignee), so the conversation
// list filters reactively as you click between them.

type InboxKey =
  | "all"
  | "mine"
  | "unassigned"
  | "open"
  | "in_progress"
  | "waiting"
  | "resolved";

interface InboxDef {
  key: InboxKey;
  label: string;
  icon: React.ReactNode;
  // Returns true when this inbox's filter set matches the current URL params
  match: (
    params: URLSearchParams,
    sessionUserId: string | undefined
  ) => boolean;
  // Counts the tickets that belong in this inbox (visible-only — closed
  // tickets are filtered out by the shell before this runs)
  count: (tickets: Ticket[], sessionUserId: string | undefined) => number;
  // Params to write when clicked
  href: (sessionUserId: string | undefined) => string;
}

function inboxes(pathname: string): InboxDef[] {
  return [
    {
      key: "all",
      label: "All tickets",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 7h18M3 12h18M3 17h18" strokeLinecap="round" />
        </svg>
      ),
      // "All" is active when no inbox-defining params are set
      match: (p) =>
        !p.get("assignee") && !p.get("status") && !p.get("inbox"),
      count: (t) => t.length,
      href: () => pathname,
    },
    {
      key: "mine",
      label: "My tickets",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" strokeLinecap="round" />
        </svg>
      ),
      match: (p) => p.get("assignee") === "me",
      count: (t, uid) => (uid ? t.filter((x) => x.assignedTo === uid).length : 0),
      href: () => `${pathname}?assignee=me`,
    },
    {
      key: "unassigned",
      label: "Unassigned",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="8" r="4" strokeDasharray="2 2" />
          <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" strokeLinecap="round" />
        </svg>
      ),
      match: (p) => p.get("assignee") === "unassigned",
      count: (t) => t.filter((x) => !x.assignedTo).length,
      href: () => `${pathname}?assignee=unassigned`,
    },
  ];
}

function statusInboxes(pathname: string): InboxDef[] {
  return [
    {
      key: "open",
      label: "Open",
      icon: <Dot className="bg-sky-500" />,
      match: (p) => p.get("status") === "open",
      count: (t) => t.filter((x) => x.status === "open").length,
      href: () => `${pathname}?status=open`,
    },
    {
      key: "in_progress",
      label: "In progress",
      icon: <Dot className="bg-violet-500" />,
      match: (p) => p.get("status") === "in_progress",
      count: (t) => t.filter((x) => x.status === "in_progress").length,
      href: () => `${pathname}?status=in_progress`,
    },
    {
      key: "waiting",
      label: "Waiting on agent",
      icon: <Dot className="bg-amber-500" />,
      match: (p) => p.get("status") === "waiting_on_agent",
      count: (t) => t.filter((x) => x.status === "waiting_on_agent").length,
      href: () => `${pathname}?status=waiting_on_agent`,
    },
    {
      key: "resolved",
      label: "Resolved",
      icon: <Dot className="bg-emerald-500" />,
      match: (p) => p.get("status") === "resolved",
      count: (t) => t.filter((x) => x.status === "resolved").length,
      href: () => `${pathname}?status=resolved`,
    },
  ];
}

export function InboxSidebar({ tickets }: { tickets: Ticket[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const uid = (session?.user as { id?: string } | undefined)?.id;

  const params = useMemo(
    () => new URLSearchParams(searchParams.toString()),
    [searchParams]
  );

  return (
    <nav className="flex h-full w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-slate-200 bg-slate-50/60 px-3 py-4 text-[13px]">
      <Section title="Inboxes">
        {inboxes(pathname).map((i) => (
          <Row
            key={i.key}
            href={i.href(uid)}
            active={i.match(params, uid)}
            icon={i.icon}
            label={i.label}
            count={i.count(tickets, uid)}
          />
        ))}
      </Section>

      <Section title="By status">
        {statusInboxes(pathname).map((i) => (
          <Row
            key={i.key}
            href={i.href(uid)}
            active={i.match(params, uid)}
            icon={i.icon}
            label={i.label}
            count={i.count(tickets, uid)}
          />
        ))}
      </Section>
    </nav>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 px-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-400">
        {title}
      </div>
      <div className="space-y-px">{children}</div>
    </div>
  );
}

function Row({
  href,
  active,
  icon,
  label,
  count,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 transition ${
        active
          ? "bg-slate-200/70 font-medium text-slate-900"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}
    >
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-slate-500">
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {count > 0 && (
        <span
          className={`shrink-0 rounded-md px-1.5 text-[11px] font-mono tabular-nums ${
            active
              ? "bg-white text-slate-700"
              : "bg-slate-100 text-slate-500"
          }`}
        >
          {count}
        </span>
      )}
    </Link>
  );
}

function Dot({ className }: { className: string }) {
  return <span className={`h-1.5 w-1.5 rounded-full ${className}`} />;
}
