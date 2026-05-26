import Link from "next/link";
import { fetchAgents } from "@/lib/api";
import type { AgentVerificationFilter } from "@/lib/api";
import { getServerApiToken } from "@/lib/auth-server";
import { formatRelative } from "@/lib/date-format";
import type { Agent } from "@/lib/types";
import { AgentActions } from "./_components/agent-actions";

export const dynamic = "force-dynamic";

// Verification view for the inbound sender-verification control
// (SECURITY.md §5.1). Default view is the *pending* queue — that's
// the work item an admin actually needs to act on. The Verified and
// Rejected tabs are reference views.

type VerificationView = AgentVerificationFilter;

function parseView(raw: string | undefined): VerificationView {
  if (raw === "verified" || raw === "rejected" || raw === "all") return raw;
  return "pending";
}

const VIEW_LABEL: Record<VerificationView, string> = {
  pending: "Pending review",
  verified: "Verified",
  rejected: "Rejected",
  all: "All",
};

const VIEW_HELP: Record<VerificationView, string> = {
  pending:
    "Numbers that messaged us but aren't yet promoted. Their tickets are quarantined — no Slack ping, no auto-intake reply, no clustering — until you verify.",
  verified:
    "Trusted field agents. Their inbound messages flow through the normal pipeline.",
  rejected:
    "Numbers an admin marked as confirmed scammers or spammers. Their messages stay quarantined permanently.",
  all: "All known numbers, regardless of verification state.",
};

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: { verification?: string; highlight?: string };
}) {
  const view = parseView(searchParams?.verification);
  const highlightId = searchParams?.highlight;
  const token = await getServerApiToken();

  // Fetch the requested view + the pending count for the badge in
  // parallel — the badge stays accurate regardless of which tab the
  // user is on.
  let agents: Agent[] = [];
  let pendingCount = 0;
  let error: string | null = null;
  try {
    const [viewResult, pendingResult] = await Promise.all([
      fetchAgents({ verification: view, limit: 200 }, token),
      view === "pending"
        ? Promise.resolve(null) // we'll count from viewResult below
        : fetchAgents({ verification: "pending", limit: 200 }, token),
    ]);
    agents = viewResult;
    pendingCount = pendingResult ? pendingResult.length : viewResult.length;
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Agents</h1>
        <span className="text-sm text-slate-500">
          {agents.length} {VIEW_LABEL[view].toLowerCase()}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <FilterTab href="/agents?verification=pending" active={view === "pending"}>
          Pending review
          {pendingCount > 0 && (
            <span className="ml-1 rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
              {pendingCount}
            </span>
          )}
        </FilterTab>
        <FilterTab href="/agents?verification=verified" active={view === "verified"}>
          Verified
        </FilterTab>
        <FilterTab href="/agents?verification=rejected" active={view === "rejected"}>
          Rejected
        </FilterTab>
        <FilterTab href="/agents?verification=all" active={view === "all"}>
          All
        </FilterTab>
      </div>

      <p className="text-sm text-slate-600">{VIEW_HELP[view]}</p>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-medium">Failed to load agents</div>
          <div className="mt-1">{error}</div>
        </div>
      )}

      {!error && agents.length === 0 && (
        <div className="rounded-md border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {view === "pending"
            ? "No numbers waiting for review. New unknown senders will appear here."
            : view === "rejected"
              ? "No rejected numbers."
              : view === "verified"
                ? "No verified agents yet."
                : "No agents."}
        </div>
      )}

      {agents.length > 0 && (
        <ul className="space-y-3">
          {agents.map((a) => (
            <AgentRow key={a.id} agent={a} highlighted={highlightId === a.id} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AgentRow({
  agent,
  highlighted,
}: {
  agent: Agent;
  highlighted: boolean;
}) {
  const status = verificationStatus(agent);
  return (
    <li
      className={`rounded-lg border bg-white p-4 ${
        highlighted ? "border-amber-400 ring-2 ring-amber-200" : "border-slate-200"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">{agent.name}</h3>
            <StatusBadge status={status} />
            <span className="text-xs text-slate-500">{agent.country}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            <span className="font-mono">{agent.phoneNumber}</span>
            {agent.branch && (
              <>
                {" · "}
                {agent.branch.name} ({agent.branch.region})
              </>
            )}
            {agent.verifiedAt && (
              <>
                {" · "}verified {formatRelative(agent.verifiedAt)}
              </>
            )}
            {agent.rejectedAt && (
              <>
                {" · "}rejected {formatRelative(agent.rejectedAt)}
              </>
            )}
          </div>
        </div>
        <AgentActions agent={agent} />
      </div>
    </li>
  );
}

type AgentStatus = "verified" | "pending" | "rejected";

function verificationStatus(agent: Agent): AgentStatus {
  if (agent.rejectedAt) return "rejected";
  if (agent.verifiedAt) return "verified";
  return "pending";
}

const STATUS_STYLE: Record<AgentStatus, string> = {
  verified: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  pending: "bg-amber-100 text-amber-800 ring-amber-200",
  rejected: "bg-rose-100 text-rose-800 ring-rose-200",
};

function StatusBadge({ status }: { status: AgentStatus }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[status]}`}
    >
      {status}
    </span>
  );
}

function FilterTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition ${
        active
          ? "bg-slate-900 text-white ring-slate-900"
          : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
      }`}
    >
      {children}
    </Link>
  );
}
