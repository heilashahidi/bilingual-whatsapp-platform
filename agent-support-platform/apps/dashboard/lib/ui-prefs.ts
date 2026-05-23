"use client";

import { useEffect, useState } from "react";

// Per-user UI preferences for the tickets view. Stored in localStorage so
// they survive a refresh without a backend roundtrip. The values are
// intentionally cosmetic — nothing here affects what data is loaded.
//
// If we ever want server-side persistence (e.g. so a user's prefs travel
// across devices), swap the body of useUiPrefs() for a fetch/PATCH against
// /api/me/preferences and keep the hook shape identical.

export type DensityPref = "comfortable" | "compact";
// "inbox" is the new Front-style three-pane default. "kanban" stays as
// an alternate. "list" is retained for users who want the wide tabular
// view without the right-pane detail.
export type ViewPref = "inbox" | "kanban" | "list";

export interface UiPrefs {
  density: DensityPref;
  bilingual: boolean;
  view: ViewPref;
  // Whether the left inbox sidebar (All / My / Unassigned + by-status)
  // is open. Toggleable via a hamburger button so operators can give
  // the conversation list more horizontal room when needed.
  sidebarOpen: boolean;
}

const DEFAULTS: UiPrefs = {
  density: "comfortable",
  // Default to English-only across every surface (kanban cards,
  // conversation list snippets, ticket detail message bubbles).
  // Operators reading triage queues don't want the foreign-language
  // secondary line by default — they can opt into it with the
  // bilingual toggle in the page header when they're working an
  // ambiguous translation.
  bilingual: false,
  view: "inbox",
  sidebarOpen: true,
};

// Storage-key version bumps invalidate everyone's saved prefs and
// re-apply DEFAULTS on next load. Use sparingly — the user loses their
// density/view/sidebar choices too.
//
// v2: switched the default view from "kanban" to "inbox"
// v3: switched the default bilingual from true to false (English-only
//     until the operator explicitly toggles bilingual on)
const STORAGE_KEY = "tickets.uiPrefs.v3";

function readStorage(): UiPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<UiPrefs>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

export function useUiPrefs(): [UiPrefs, (patch: Partial<UiPrefs>) => void] {
  // Start with DEFAULTS on first paint to avoid SSR/CSR mismatches; hydrate
  // the real value on mount. The 1-frame flash is invisible in practice
  // because the page itself is data-loading at that moment.
  const [prefs, setPrefs] = useState<UiPrefs>(DEFAULTS);

  useEffect(() => {
    setPrefs(readStorage());
  }, []);

  const update = (patch: Partial<UiPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* quota / disabled storage — ignore */
      }
      return next;
    });
  };

  return [prefs, update];
}
