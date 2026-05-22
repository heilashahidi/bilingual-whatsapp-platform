"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendResponse } from "@/lib/api";

export function ResponseComposer({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function handleSend() {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    setPreview(null);
    try {
      const result = await sendResponse(ticketId, text.trim());
      setPreview(result.translatedText);
      setText("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
        Reply (English — will be translated for the agent)
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Type your reply in English…"
        className="mt-2 w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        disabled={sending}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            handleSend();
          }
        }}
      />
      <div className="mt-3 flex items-center justify-between">
        <div className="text-xs text-slate-500">
          {sending ? "Sending…" : "⌘/Ctrl + Enter to send"}
        </div>
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !text.trim()}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Send
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
