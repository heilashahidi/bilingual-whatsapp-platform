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
export type ViewPref = "kanban" | "list";

export interface UiPrefs {
  density: DensityPref;
  bilingual: boolean;
  view: ViewPref;
}

const DEFAULTS: UiPrefs = {
  density: "comfortable",
  bilingual: true,
  view: "kanban",
};

const STORAGE_KEY = "tickets.uiPrefs.v1";

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
