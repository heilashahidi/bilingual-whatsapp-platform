"use client";

import { useSession } from "next-auth/react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useMemo } from "react";
import type { Country, InternalUser, Severity } from "@/lib/types";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const COUNTRIES: Country[] = ["HT", "DO", "CD"];

export interface ActiveFilters {
  severities: Set<Severity>;
  countries: Set<Country>;
  assigneeId: string | "me" | "unassigned" | null;
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
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <input
          type="text"
          value={filters.search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search agent, message, branch, tags…"
          className="min-w-[14rem] flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />

        {/* Quick assignee filters */}
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
            filters.assigneeId && filters.assigneeId !== "me" && filters.assigneeId !== "unassigned"
              ? filters.assigneeId
              : ""
          }
          onChange={(e) => setAssignee(e.target.value || null)}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
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
        <span className="text-xs uppercase tracking-wide text-slate-500">
          Severity
        </span>
        {SEVERITIES.map((s) => (
          <ChipButton
            key={s}
            active={filters.severities.has(s)}
            onClick={() => toggleListParam("severity", s)}
          >
            {s}
          </ChipButton>
        ))}

        <span className="ml-3 text-xs uppercase tracking-wide text-slate-500">
          Country
        </span>
        {COUNTRIES.map((c) => (
          <ChipButton
            key={c}
            active={filters.countries.has(c)}
            onClick={() => toggleListParam("country", c)}
          >
            {c}
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
      className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition ${
        active
          ? "bg-slate-900 text-white ring-slate-900"
          : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      {children}
    </button>
  );
}
