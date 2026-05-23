"use client";

import { useSession } from "next-auth/react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useMemo } from "react";
import type { Country, InternalUser, Severity } from "@/lib/types";
import { SEVERITY_DOT } from "@/lib/severity-styles";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const COUNTRIES: Country[] = ["HT", "DO", "CD"];

const COUNTRY_LABEL: Record<Country, { flag: string; name: string }> = {
  HT: { flag: "🇭🇹", name: "Haiti" },
  DO: { flag: "🇩🇴", name: "Dom. Republic" },
  CD: { flag: "🇨🇩", name: "DR Congo" },
};

export interface ActiveFilters {
  severities: Set<Severity>;
  countries: Set<Country>;
  assigneeId: string | "me" | "unassigned" | null;
  incidentId: string | null;
  search: string;
}

export function readFiltersFromParams(
  params: URLSearchParams
): ActiveFilters {
  return {
    severities: new Set(
      (params.get("severity")?.split(",").filter(Boolean) as Severity[]) || []
    ),
    countries: new Set(
      (params.get("country")?.split(",").filter(Boolean) as Country[]) || []
    ),
    assigneeId: (params.get("assignee") as ActiveFilters["assigneeId"]) || null,
    incidentId: params.get("incident") || null,
    search: params.get("q") || "",
  };
}

export function FiltersBar({ users }: { users: InternalUser[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();

  const filters = useMemo(
    () => readFiltersFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams]
  );

  const updateParams = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const p = new URLSearchParams(searchParams.toString());
      mutate(p);
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  function toggleListParam(key: string, value: string) {
    updateParams((p) => {
      const current = (p.get(key)?.split(",") || []).filter(Boolean);
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      if (next.length) p.set(key, next.join(","));
      else p.delete(key);
    });
  }

  function setAssignee(value: ActiveFilters["assigneeId"]) {
    updateParams((p) => {
      if (value) p.set("assignee", value);
      else p.delete("assignee");
    });
  }

  function setSearch(value: string) {
    updateParams((p) => {
      if (value.trim()) p.set("q", value);
      else p.delete("q");
    });
  }

  function clearAll() {
    router.replace(pathname, { scroll: false });
  }

  const anyActive =
    filters.severities.size ||
    filters.countries.size ||
    filters.assigneeId ||
    filters.search;

  const sessionUserId = (session?.user as { id?: string } | undefined)?.id;

  return (
    <div className="space-y-2.5 rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="flex min-w-[16rem] flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-slate-500 focus-within:border-emerald-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-emerald-500/15">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>
          </svg>
          <input
            id="tickets-search"
            type="text"
            value={filters.search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agent, branch, message, tag…  (press / to focus)"
            className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-slate-900 outline-none placeholder:text-slate-400"
          />
        </div>

        <ChipButton
          active={filters.assigneeId === "me"}
          disabled={!sessionUserId}
          onClick={() => setAssignee(filters.assigneeId === "me" ? null : "me")}
          title={!sessionUserId ? "Sign in to filter your tickets" : ""}
        >
          My tickets
        </ChipButton>
        <ChipButton
          active={filters.assigneeId === "unassigned"}
          onClick={() =>
            setAssignee(filters.assigneeId === "unassigned" ? null : "unassigned")
          }
        >
          Unassigned
        </ChipButton>

        <select
          value={
            filters.assigneeId &&
            filters.assigneeId !== "me" &&
            filters.assigneeId !== "unassigned"
              ? filters.assigneeId
              : ""
          }
          onChange={(e) => setAssignee(e.target.value || null)}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12.5px] text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15"
        >
          <option value="">Any assignee</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>

        {anyActive ? (
          <button
            type="button"
            onClick={clearAll}
            className="ml-auto text-xs text-slate-500 hover:text-slate-900"
          >
            Clear filters
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          Severity
        </span>
        {SEVERITIES.map((s) => (
          <ChipButton
            key={s}
            active={filters.severities.has(s)}
            onClick={() => toggleListParam("severity", s)}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${SEVERITY_DOT[s]}`} />
            {s}
          </ChipButton>
        ))}

        <span className="ml-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          Country
        </span>
        {COUNTRIES.map((c) => (
          <ChipButton
            key={c}
            active={filters.countries.has(c)}
            onClick={() => toggleListParam("country", c)}
          >
            <span aria-hidden>{COUNTRY_LABEL[c].flag}</span>
            {COUNTRY_LABEL[c].name}
          </ChipButton>
        ))}
      </div>
    </div>
  );
}

function ChipButton({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ring-1 ring-inset transition ${
        active
          ? "bg-slate-900 text-white ring-slate-900 hover:bg-slate-800"
          : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      {children}
    </button>
  );
}
