"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createNote } from "@/lib/api";
import type { Note } from "@/lib/types";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function NotesPanel({
  ticketId,
  notes,
}: {
  ticketId: string;
  notes: Note[];
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit() {
    if (!text.trim() || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        await createNote(ticketId, text.trim());
        setText("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save note");
      }
    });
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-amber-900">
          Internal notes
        </h2>
        <span className="rounded bg-amber-200/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-900">
          team-only · not sent to agent
        </span>
      </div>

      {notes.length === 0 ? (
        <p className="text-xs text-amber-800/70 italic">
          No notes yet. Use this for triage discussion that shouldn't be sent
          to the agent.
        </p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li
              key={n.id}
              className="rounded-md bg-amber-100/80 px-3 py-2 ring-1 ring-amber-200"
            >
              <div className="mb-1 flex items-center gap-2 text-xs text-amber-900/70">
                <span className="font-medium text-amber-900">
                  {n.author?.name || "Anonymous"}
                </span>
                <span>·</span>
                <span>{formatTime(n.createdAt)}</span>
              </div>
              <div className="whitespace-pre-wrap text-sm text-amber-950">
                {n.text}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="Add a note…"
          className="w-full resize-y rounded-md border border-amber-300 bg-white/80 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          disabled={pending}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-amber-800/70">
            ⌘/Ctrl + Enter to save
          </span>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pending || !text.trim()}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-amber-300"
          >
            {pending ? "Saving…" : "Add note"}
          </button>
        </div>
        {error && (
          <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
