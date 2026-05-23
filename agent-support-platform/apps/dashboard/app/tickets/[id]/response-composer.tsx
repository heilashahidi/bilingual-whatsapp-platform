"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createNote,
  fetchReplySuggestions,
  sendResponse,
  type ReplySuggestion,
} from "@/lib/api";
import type { InternalUser } from "@/lib/types";

type Mode = "reply" | "note";

export function ResponseComposer({
  ticketId,
  users = [],
}: {
  ticketId: string;
  users?: InternalUser[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("reply");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Mentions: maps the literal "@FullName" substring → user id. Stored as
  // a set of ids so duplicates collapse. We re-scan the text on submit to
  // only send mentions whose @FullName is still in the body.
  const [mentions, setMentions] = useState<Map<string, string>>(new Map());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerAnchor, setPickerAnchor] = useState<{ start: number; end: number } | null>(null);
  const [pickerIndex, setPickerIndex] = useState(0);

  // Filter users by name fuzzy match against the current @-token
  const pickerResults = useMemo(() => {
    if (!pickerOpen) return [];
    const q = pickerQuery.trim().toLowerCase();
    const list = q
      ? users.filter((u) => u.name.toLowerCase().includes(q))
      : users;
    return list.slice(0, 6);
  }, [pickerOpen, pickerQuery, users]);

  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setText(value);
    if (mode !== "note") return;

    // Look back from cursor for an @-token. The token starts at the most
    // recent "@" that's preceded by start-of-string or whitespace, and
    // continues until the cursor or the next whitespace.
    const pos = e.target.selectionStart ?? value.length;
    const before = value.slice(0, pos);
    const atIdx = before.lastIndexOf("@");

    if (atIdx === -1) {
      setPickerOpen(false);
      return;
    }
    const charBeforeAt = atIdx === 0 ? "" : before[atIdx - 1];
    if (charBeforeAt && !/\s/.test(charBeforeAt)) {
      // mid-word @ (e.g. "user@example.com"); ignore
      setPickerOpen(false);
      return;
    }
    const token = before.slice(atIdx + 1);
    if (/\s/.test(token)) {
      // there's whitespace between @ and cursor — popup should have closed
      setPickerOpen(false);
      return;
    }
    setPickerQuery(token);
    setPickerAnchor({ start: atIdx, end: pos });
    setPickerIndex(0);
    setPickerOpen(true);
  }

  function pickMention(user: InternalUser) {
    if (!pickerAnchor) return;
    const replacement = `@${user.name} `;
    const next =
      text.slice(0, pickerAnchor.start) +
      replacement +
      text.slice(pickerAnchor.end);
    setText(next);
    setMentions((prev) => {
      const m = new Map(prev);
      m.set(`@${user.name}`, user.id);
      return m;
    });
    setPickerOpen(false);
    // Refocus textarea and place cursor after the inserted mention
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        const cursor = pickerAnchor.start + replacement.length;
        ta.focus();
        ta.setSelectionRange(cursor, cursor);
      }
    });
  }

  // On submit, only send mention IDs that are still present in the text.
  function activeMentionIds(): string[] {
    const ids = new Set<string>();
    for (const [marker, id] of mentions) {
      if (text.includes(marker)) ids.add(id);
    }
    return Array.from(ids);
  }

  async function handleSubmit() {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    setPreview(null);
    try {
      if (mode === "reply") {
        const result = await sendResponse(ticketId, text.trim());
        setPreview(result.translatedText);
      } else {
        await createNote(ticketId, text.trim(), activeMentionIds());
      }
      setText("");
      setMentions(new Map());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSending(false);
    }
  }

  // ESC closes the picker; arrows/enter navigate it
  function onTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (pickerOpen && pickerResults.length > 0) {
      if (e.key === "Escape") {
        e.preventDefault();
        setPickerOpen(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPickerIndex((i) => Math.min(pickerResults.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPickerIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(pickerResults[pickerIndex]);
        return;
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  }

  // Close picker on mode switch
  useEffect(() => {
    setPickerOpen(false);
  }, [mode]);

  // ─── AI-suggested replies ─────────────────────────────────────────
  // Only fetched in "reply" mode. The first fetch happens automatically
  // when the composer mounts (or the ticket changes); the operator can
  // manually regenerate via the refresh button. We never auto-refetch on
  // socket events — that would re-shuffle suggestions while the operator
  // is mid-edit.
  const [suggestions, setSuggestions] = useState<ReplySuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  const loadSuggestions = useCallback(async () => {
    setSuggestionsLoading(true);
    try {
      const list = await fetchReplySuggestions(ticketId);
      setSuggestions(list);
    } catch {
      setSuggestions([]);
    } finally {
      setSuggestionsLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    if (mode !== "reply") return;
    let cancelled = false;
    setSuggestionsLoading(true);
    fetchReplySuggestions(ticketId)
      .then((list) => {
        if (!cancelled) setSuggestions(list);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      })
      .finally(() => {
        if (!cancelled) setSuggestionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId, mode]);

  function useSuggestion(s: ReplySuggestion) {
    setText(s.text);
    // Clear any stale mention markers — suggestions never carry mentions.
    setMentions(new Map());
    // Move focus to the textarea so the operator can immediately edit.
    setTimeout(() => {
      textareaRef.current?.focus();
      const len = s.text.length;
      textareaRef.current?.setSelectionRange(len, len);
    }, 0);
  }

  const isNote = mode === "note";
  const wrapperClass = isNote
    ? "rounded-lg border border-amber-300 bg-amber-50 p-4"
    : "rounded-lg border border-slate-200 bg-white p-4";
  const textareaClass = isNote
    ? "mt-2 w-full resize-y rounded-md border border-amber-300 bg-white/70 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
    : "mt-2 w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";
  const buttonClass = isNote
    ? "rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-amber-300"
    : "rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300";

  return (
    <div className={wrapperClass}>
      <div className="mb-3 flex gap-1 border-b border-slate-200">
        <TabButton active={!isNote} onClick={() => setMode("reply")}>
          Reply to agent
        </TabButton>
        <TabButton active={isNote} accent="amber" onClick={() => setMode("note")}>
          Internal note
        </TabButton>
      </div>

      {/* AI suggestions — only in reply mode; quietly hidden when none */}
      {!isNote && (suggestionsLoading || suggestions.length > 0) && (
        <div className="mb-3 rounded-md border border-violet-200 bg-violet-50/60 p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M12 2l2.4 7.4L22 12l-7.6 2.6L12 22l-2.4-7.4L2 12l7.6-2.6z" strokeLinejoin="round" />
              </svg>
              AI-suggested replies
            </div>
            <button
              type="button"
              onClick={loadSuggestions}
              disabled={suggestionsLoading}
              className="text-[11px] font-medium text-violet-700 hover:text-violet-900 disabled:opacity-50"
              title="Regenerate suggestions"
            >
              {suggestionsLoading ? "Generating…" : "↻ Regenerate"}
            </button>
          </div>
          {suggestionsLoading && suggestions.length === 0 ? (
            <div className="space-y-1.5">
              <div className="h-8 animate-pulse rounded bg-violet-100" />
              <div className="h-8 animate-pulse rounded bg-violet-100" />
              <div className="h-8 animate-pulse rounded bg-violet-100" />
            </div>
          ) : (
            <ul className="space-y-1.5">
              {suggestions.map((s, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => useSuggestion(s)}
                    className="group flex w-full items-start gap-2 rounded border border-violet-200/80 bg-white px-2.5 py-1.5 text-left text-[13px] text-slate-700 transition hover:border-violet-400 hover:bg-violet-50"
                  >
                    <span className="mt-0.5 shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-700">
                      {s.tone}
                    </span>
                    <span className="flex-1 leading-snug">{s.text}</span>
                    <span className="mt-0.5 shrink-0 text-[10px] text-violet-400 opacity-0 transition group-hover:opacity-100">
                      use →
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <label
        className={`block text-xs font-medium uppercase tracking-wide ${
          isNote ? "text-amber-800" : "text-slate-500"
        }`}
      >
        {isNote
          ? "Team-only note — type @ to mention a teammate"
          : "Reply (English — will be translated for the agent)"}
      </label>

      <div className="relative">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextareaChange}
          rows={3}
          placeholder={
            isNote
              ? "Add a note for the team… type @ to mention someone"
              : "Type your reply in English…"
          }
          className={textareaClass}
          disabled={sending}
          onKeyDown={onTextareaKeyDown}
        />

        {pickerOpen && pickerResults.length > 0 && (
          <div className="absolute left-2 right-2 top-full z-20 mt-1 max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {pickerResults.map((u, i) => (
              <button
                key={u.id}
                type="button"
                onMouseDown={(e) => {
                  // mousedown to fire BEFORE blur, so the textarea keeps focus context
                  e.preventDefault();
                  pickMention(u);
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] ${
                  i === pickerIndex
                    ? "bg-amber-100 text-amber-900"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className="font-medium">{u.name}</span>
                <span className="text-[11px] text-slate-500">{u.role}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className={`text-xs ${isNote ? "text-amber-800/80" : "text-slate-500"}`}>
          {sending
            ? isNote ? "Saving…" : "Sending…"
            : "⌘/Ctrl + Enter to submit"}
        </div>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={sending || !text.trim()}
          className={buttonClass}
        >
          {isNote ? "Add note" : "Send"}
        </button>
      </div>
      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {error}
        </div>
      )}
      {preview && (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
          <div className="font-medium">Sent. Translated as:</div>
          <div className="mt-1 text-emerald-700">{preview}</div>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  accent = "slate",
  onClick,
  children,
}: {
  active: boolean;
  accent?: "slate" | "amber";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const activeStyle =
    accent === "amber"
      ? "border-amber-600 text-amber-900"
      : "border-slate-900 text-slate-900";
  const inactiveStyle = "border-transparent text-slate-500 hover:text-slate-800";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${
        active ? activeStyle : inactiveStyle
      }`}
    >
      {children}
    </button>
  );
}
