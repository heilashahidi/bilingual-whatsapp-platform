"use client";

import { useEffect, useRef } from "react";
import type {
  InternalUser,
  Message,
  Note,
  Severity,
  TicketDetail,
  TicketStatus,
} from "@/lib/types";
import { ActivityPanel } from "../activity-panel";
import { ResponseComposer } from "../response-composer";
import { TicketActions } from "../ticket-actions";
import { SlaTimer } from "../../_components/sla-timer";

// Renderable detail view, used in BOTH the full /tickets/[id] route AND
// the drawer that opens from the kanban. Everything client-side — the
// data is passed in as props by whichever surface is hosting it.

const severityStyles: Record<Severity, string> = {
  critical: "bg-rose-100 text-rose-800 ring-rose-200",
  high: "bg-orange-100 text-orange-800 ring-orange-200",
  medium: "bg-amber-100 text-amber-800 ring-amber-200",
  low: "bg-slate-100 text-slate-700 ring-slate-200",
};

const statusStyles: Record<TicketStatus, string> = {
  open: "bg-sky-100 text-sky-800",
  in_progress: "bg-violet-100 text-violet-800",
  waiting_on_agent: "bg-amber-100 text-amber-800",
  resolved: "bg-emerald-100 text-emerald-800",
  closed: "bg-slate-100 text-slate-600",
};

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type TimelineItem =
  | { kind: "message"; data: Message; createdAt: string }
  | { kind: "note"; data: Note; createdAt: string };

function interleave(messages: Message[], notes: Note[]): TimelineItem[] {
  const items: TimelineItem[] = [
    ...messages.map((m) => ({ kind: "message" as const, data: m, createdAt: m.createdAt })),
    ...notes.map((n) => ({ kind: "note" as const, data: n, createdAt: n.createdAt })),
  ];
  return items.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

function senderLabel(m: Message): string {
  if (m.senderType === "agent") return "Agent";
  if (m.senderType === "bot") return "Bot";
  if (m.senderType === "system") return "System";
  return "You";
}

function DeliveryStatus({ message }: { message: Message }) {
  if (message.direction !== "outbound") return null;
  if (message.readAt)
    return (
      <span className="text-blue-300" title={`Read · ${new Date(message.readAt).toLocaleString()}`}>
        ✓✓
      </span>
    );
  if (message.deliveredAt)
    return (
      <span className="text-slate-400" title={`Delivered · ${new Date(message.deliveredAt).toLocaleString()}`}>
        ✓✓
      </span>
    );
  return (
    <span className="text-slate-500" title="Sent — awaiting delivery receipt">
      ✓
    </span>
  );
}

// Tokenize a note body so that @FullName segments render as bold pills.
// Matches "@" followed by capitalized words separated by single spaces,
// up to 3 words deep (covers "@Jean", "@Jean-Baptiste Pierre", "@Maria
// Carmen Diaz"). Conservative on purpose — false matches are minor.
function renderWithMentions(text: string): React.ReactNode[] {
  const pattern = /@[A-Z][\w'-]*(?:\s+[A-Z][\w'-]*){0,2}/g;
  const out: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIdx) out.push(text.slice(lastIdx, match.index));
    out.push(
      <span
        key={`m-${key++}`}
        className="rounded bg-amber-200/70 px-1 font-semibold text-amber-900"
      >
        {match[0]}
      </span>
    );
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) out.push(text.slice(lastIdx));
  return out;
}

function NoteBubble({ note }: { note: Note }) {
  return (
    <div className="flex justify-center">
      <div className="w-full max-w-[85%] rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="mb-1 flex items-center gap-2 text-xs text-amber-800/80">
          <span className="rounded bg-amber-200/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
            internal note
          </span>
          <span className="font-medium text-amber-900">
            {note.author?.name || "Anonymous"}
          </span>
          <span>·</span>
          <span>{formatTime(note.createdAt)}</span>
          <span className="ml-auto text-[10px] italic text-amber-700">
            not sent to field agent
          </span>
        </div>
        <div className="whitespace-pre-wrap text-sm text-amber-950">
          {renderWithMentions(note.text)}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isInbound = message.direction === "inbound";
  const primary = isInbound ? message.translatedText : message.originalText;
  const secondary = isInbound ? message.originalText : message.translatedText;
  const showSecondary = secondary && secondary !== primary;
  const lowConfidence =
    isInbound &&
    typeof message.translationConfidence === "number" &&
    message.translationConfidence < 0.7;

  return (
    <div className={`flex ${isInbound ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[75%] rounded-lg px-4 py-3 ${
          isInbound
            ? "bg-white ring-1 ring-slate-200"
            : "bg-slate-900 text-white"
        }`}
      >
        <div
          className={`mb-1 flex items-center gap-2 text-xs ${
            isInbound ? "text-slate-500" : "text-slate-300"
          }`}
        >
          <span className="font-medium">{senderLabel(message)}</span>
          <span>·</span>
          <span>{formatTime(message.createdAt)}</span>
          {lowConfidence && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
              translation may be inaccurate
            </span>
          )}
          {!isInbound && (
            <span className="ml-auto">
              <DeliveryStatus message={message} />
            </span>
          )}
        </div>
        <div className="whitespace-pre-wrap text-sm">{primary || "—"}</div>
        {showSecondary && (
          <div
            className={`mt-2 border-t pt-2 text-xs ${
              isInbound
                ? "border-slate-200 text-slate-500"
                : "border-white/20 text-slate-300"
            }`}
          >
            <span className="font-medium">
              {isInbound ? message.originalLanguage : "translated"}:
            </span>{" "}
            {secondary}
          </div>
        )}
        {message.contentType !== "text" && (
          <div
            className={`mt-2 text-xs italic ${
              isInbound ? "text-slate-500" : "text-slate-300"
            }`}
          >
            [{message.contentType} attachment]
          </div>
        )}
      </div>
    </div>
  );
}

export function TicketDetailView({
  ticket,
  users,
}: {
  ticket: TicketDetail;
  users: InternalUser[];
}) {
  const firstInbound = ticket.messages.find((m) => m.direction === "inbound");
  const summary =
    (firstInbound?.translatedText || firstInbound?.originalText || ticket.category)
      .replace(/\s+/g, " ")
      .trim();
  const shortId = ticket.id.slice(0, 8);
  const isResolved =
    ticket.status === "resolved" || ticket.status === "closed";
  const resolvedAgo = ticket.resolvedAt
    ? formatRelative(ticket.resolvedAt)
    : null;

  // ─── Conversation auto-scroll ──────────────────────────────────────
  // The conversation block is scrollable on its own (max-h + overflow).
  // On mount, jump straight to the latest message. On subsequent
  // updates (new inbound message via realtime, operator sends a reply),
  // only auto-scroll if the user was already near the bottom — otherwise
  // we'd yank them away from older history they're reading.
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const wasAtBottomRef = useRef(true);
  const itemCount = ticket.messages.length + ticket.notes.length;

  useEffect(() => {
    const el = conversationRef.current;
    if (!el) return;
    if (wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [itemCount]);

  function handleConversationScroll() {
    const el = conversationRef.current;
    if (!el) return;
    // Within 64px of the bottom counts as "near bottom" for the
    // auto-scroll decision on the NEXT update.
    wasAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 64;
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-slate-900 line-clamp-2">
              {summary.length > 110 ? summary.slice(0, 110) + "…" : summary}
            </h1>
            <div className="mt-1 text-xs text-slate-500 font-mono">
              #{shortId}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${severityStyles[ticket.severity]}`}
            >
              {ticket.severity}
            </span>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs ${statusStyles[ticket.status]}`}
            >
              {ticket.status.replace(/_/g, " ")}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
          <span>{ticket.category.replace(/_/g, " ")}</span>
          {ticket.productArea && <span>· {ticket.productArea}</span>}
          {ticket.incident && (
            <span className="rounded bg-rose-100 px-2 py-0.5 text-xs text-rose-800">
              incident: {ticket.incident.title}
            </span>
          )}
        </div>
      </div>

      {isResolved && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-white">
            ✓
          </div>
          <div className="flex-1 text-sm">
            <span className="font-medium text-emerald-900">
              {ticket.status === "closed" ? "Closed" : "Resolved"}
            </span>
            {resolvedAgo && (
              <span className="text-emerald-700"> · {resolvedAgo}</span>
            )}
            {ticket.resolutionSummary && (
              <div className="mt-1 text-xs text-emerald-800">
                {ticket.resolutionSummary}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            <div className="flex items-center justify-between border-b border-slate-200 bg-white/60 px-4 py-2.5">
              <h2 className="text-sm font-medium text-slate-700">
                Conversation
              </h2>
              <span className="text-[11px] text-slate-500">
                {ticket.messages.length} message
                {ticket.messages.length === 1 ? "" : "s"}
                {ticket.notes.length > 0 &&
                  ` · ${ticket.notes.length} note${ticket.notes.length === 1 ? "" : "s"}`}
              </span>
            </div>
            {/* Scrollable bubble region. max-h scales with viewport so the
                composer below stays in view on tall threads. */}
            <div
              ref={conversationRef}
              onScroll={handleConversationScroll}
              className="max-h-[55vh] space-y-3 overflow-y-auto p-4"
            >
              {ticket.messages.length === 0 && ticket.notes.length === 0 ? (
                <div className="text-sm text-slate-500">No activity yet.</div>
              ) : (
                interleave(ticket.messages, ticket.notes).map((item) =>
                  item.kind === "message" ? (
                    <MessageBubble key={`m-${item.data.id}`} message={item.data} />
                  ) : (
                    <NoteBubble key={`n-${item.data.id}`} note={item.data} />
                  )
                )
              )}
            </div>
          </div>

          <ResponseComposer ticketId={ticket.id} users={users} />
        </div>

        <aside className="space-y-4">
          <TicketActions ticket={ticket} users={users} />

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Agent
            </h3>
            <div className="font-medium text-slate-900">{ticket.agent.name}</div>
            <div className="mt-1 text-xs text-slate-500">
              {ticket.agent.phoneNumber}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-slate-500">Branch</div>
                <div className="text-slate-900">{ticket.agent.branch.name}</div>
              </div>
              <div>
                <div className="text-slate-500">Country</div>
                <div className="text-slate-900">{ticket.agent.country}</div>
              </div>
              <div>
                <div className="text-slate-500">Language</div>
                <div className="text-slate-900">
                  {ticket.agent.preferredLanguage}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Connectivity</div>
                <div className="text-slate-900">
                  {ticket.agent.connectivityStatus}
                </div>
              </div>
            </div>
          </div>

          {ticket.tags.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Tags
              </h3>
              <div className="flex flex-wrap gap-1">
                {ticket.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              SLA
            </h3>
            <div className="space-y-1 text-xs">
              <div className="text-slate-500">First response deadline</div>
              <div className="text-slate-900">
                {ticket.slaFirstResponseDeadline
                  ? formatTime(ticket.slaFirstResponseDeadline)
                  : "—"}
              </div>
              <div className="pt-1">
                <SlaTimer deadline={ticket.slaFirstResponseDeadline} />
              </div>
            </div>
          </div>

          {ticket.suggestedResolutions.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Suggested resolutions
              </h3>
              <div className="space-y-3">
                {ticket.suggestedResolutions.map((s) => (
                  <div key={s.id} className="border-l-2 border-slate-200 pl-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-900">
                        {s.article.title}
                      </span>
                      <span className="text-slate-500">
                        {(s.similarityScore * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-600">
                      {s.article.resolutionText.length > 140
                        ? s.article.resolutionText.slice(0, 140) + "…"
                        : s.article.resolutionText}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <ActivityPanel events={ticket.events} />

          {ticket.botConversation && (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Bot interaction
              </h3>
              <div className="text-xs text-slate-600">
                Outcome:{" "}
                <span className="font-medium text-slate-900">
                  {ticket.botConversation.outcome || "in progress"}
                </span>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
