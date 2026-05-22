import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchTicket } from "@/lib/api";
import type { Message, Severity, TicketStatus } from "@/lib/types";
import { ResponseComposer } from "./response-composer";

export const dynamic = "force-dynamic";

const severityStyles: Record<Severity, string> = {
  critical: "bg-red-100 text-red-800 ring-red-200",
  high: "bg-orange-100 text-orange-800 ring-orange-200",
  medium: "bg-amber-100 text-amber-800 ring-amber-200",
  low: "bg-slate-100 text-slate-700 ring-slate-200",
};

const statusStyles: Record<TicketStatus, string> = {
  open: "bg-blue-100 text-blue-800",
  in_progress: "bg-violet-100 text-violet-800",
  waiting_on_agent: "bg-yellow-100 text-yellow-800",
  resolved: "bg-emerald-100 text-emerald-800",
  closed: "bg-slate-100 text-slate-600",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function senderLabel(m: Message): string {
  if (m.senderType === "agent") return "Agent";
  if (m.senderType === "bot") return "Bot";
  if (m.senderType === "system") return "System";
  return "You";
}

function MessageBubble({ message }: { message: Message }) {
  const isInbound = message.direction === "inbound";

  // Always show English as primary (this dashboard is for US team).
  // For inbound: translatedText is English, originalText is agent's language.
  // For outbound: originalText is English, translatedText is agent's language.
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

export default async function TicketDetailPage({
  params,
}: {
  params: { id: string };
}) {
  let ticket;
  try {
    ticket = await fetchTicket(params.id);
  } catch (e) {
    if (e instanceof Error && e.message.includes("404")) {
      notFound();
    }
    throw e;
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/tickets"
          className="text-sm text-slate-500 hover:text-slate-900"
        >
          ← All tickets
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
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
        <span className="text-sm text-slate-500">{ticket.category}</span>
        {ticket.productArea && (
          <span className="text-sm text-slate-500">· {ticket.productArea}</span>
        )}
        {ticket.incident && (
          <span className="rounded bg-rose-100 px-2 py-0.5 text-xs text-rose-800">
            incident: {ticket.incident.title}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h2 className="mb-3 text-sm font-medium text-slate-700">
              Conversation
            </h2>
            <div className="space-y-3">
              {ticket.messages.length === 0 ? (
                <div className="text-sm text-slate-500">No messages yet.</div>
              ) : (
                ticket.messages.map((m) => (
                  <MessageBubble key={m.id} message={m} />
                ))
              )}
            </div>
          </div>

          <ResponseComposer ticketId={ticket.id} />
        </div>

        <aside className="space-y-4">
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
