"use client";

import { useEffect, useState } from "react";

// Global shortcuts only: / focuses #tickets-search, ? toggles the help
// overlay, Esc closes it. Page-scoped shortcuts (j/k etc.) live with their
// state in the owning component (see conversation-list.tsx).
const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: "/", label: "Focus the search box" },
  { keys: "j", label: "Next ticket in the conversation list" },
  { keys: "k", label: "Previous ticket in the conversation list" },
  { keys: "?", label: "Show this shortcut list" },
  { keys: "Esc", label: "Close this overlay / drawer" },
  { keys: "⌘/Ctrl + Enter", label: "Send a reply or save a note" },
];

export function KeyboardShortcuts() {
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const isTyping =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (t && (t as HTMLElement).isContentEditable);
      if (isTyping) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "/") {
        e.preventDefault();
        const search = document.getElementById("tickets-search");
        if (search instanceof HTMLInputElement) {
          search.focus();
          search.select();
        }
      } else if (e.key === "?") {
        e.preventDefault();
        setHelpOpen((open) => !open);
      } else if (e.key === "Escape" && helpOpen) {
        setHelpOpen(false);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen]);

  if (!helpOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-6 pt-32"
      onClick={() => setHelpOpen(false)}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Keyboard shortcuts"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={() => setHelpOpen(false)}
            className="text-xs text-slate-500 hover:text-slate-900"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <ul className="space-y-1.5">
          {SHORTCUTS.map((s) => (
            <li
              key={s.keys}
              className="flex items-center justify-between gap-3 rounded px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            >
              <span>{s.label}</span>
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-700">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[10px] text-slate-400">
          Tip: shortcuts are disabled while you're typing in any
          input or textarea.
        </p>
      </div>
    </div>
  );
}
