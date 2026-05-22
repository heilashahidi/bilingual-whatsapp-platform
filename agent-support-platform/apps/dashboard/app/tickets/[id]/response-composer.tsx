"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createNote, sendResponse } from "@/lib/api";

type Mode = "reply" | "note";

export function ResponseComposer({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("reply");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

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
        await createNote(ticketId, text.trim());
      }
      setText("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSending(false);
    }
  }

  // Distinct visual states reduce the risk of someone typing a note thinking
  // it's a reply (or vice versa). Note mode is amber across the entire
  // composer; reply mode is slate.
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
      {/* Mode tabs */}
      <div className="mb-3 flex gap-1 border-b border-slate-200">
        <TabButton active={!isNote} onClick={() => setMode("reply")}>
          Reply to agent
        </TabButton>
        <TabButton
          active={isNote}
          accent="amber"
          onClick={() => setMode("note")}
        >
          Internal note
        </TabButton>
      </div>

      <label
        className={`block text-xs font-medium uppercase tracking-wide ${
          isNote ? "text-amber-800" : "text-slate-500"
        }`}
      >
        {isNote
          ? "Team-only note — never sent to the agent"
          : "Reply (English — will be translated for the agent)"}
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={isNote ? "Add a note for the team…" : "Type your reply in English…"}
        className={textareaClass}
        disabled={sending}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            handleSubmit();
          }
        }}
      />
      <div className="mt-3 flex items-center justify-between">
        <div className={`text-xs ${isNote ? "text-amber-800/80" : "text-slate-500"}`}>
          {sending
            ? isNote
              ? "Saving…"
              : "Sending…"
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
