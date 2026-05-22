import { prisma } from "./database";
import { recordEvent } from "./audit";
import { emitTicketEvent } from "./realtime";

// ─── Tunables ───────────────────────────────────────────────────────────
// A window of 30 minutes with a 3-ticket threshold lights up the same kind
// of pattern an oncall would notice manually: a handful of branches in the
// same country reporting the same category back-to-back. Easy to tweak
// from one place if we ever want to A/B these.
const CLUSTER_WINDOW_MINUTES = 30;
const CLUSTER_THRESHOLD = 3;

// Once an incident is detected, every subsequent ticket in the same
// (country, category) within INCIDENT_ACTIVE_HOURS joins it instead of
// triggering a fresh one — otherwise we'd spawn a new incident every
// 30 minutes during a long outage.
const INCIDENT_ACTIVE_HOURS = 2;

const SEVERITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 } as const;
type Severity = keyof typeof SEVERITY_RANK;

/**
 * Decide whether the just-created ticket belongs to an incident.
 *
 *   - If there's an open incident matching (country, category) and it's
 *     still active, attach the ticket to it.
 *   - Otherwise, count recent un-clustered tickets matching (country,
 *     category). If we cross the threshold, form a new incident and
 *     attach all contributing tickets.
 *   - Otherwise, do nothing.
 *
 * Returns the incident id the ticket ended up attached to (or null).
 */
export async function clusterTicket(ticketId: string): Promise<string | null> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { agent: { include: { branch: true } } },
  });
  if (!ticket) return null;
  if (ticket.incidentId) return ticket.incidentId; // already clustered
  if (ticket.deletedAt) return null;

  const country = ticket.agent.country;
  const category = ticket.category;
  const now = new Date();

  // ─── Path 1: attach to an already-open incident ─────────────────────
  const activeCutoff = new Date(now.getTime() - INCIDENT_ACTIVE_HOURS * 3600_000);
  const openIncident = await prisma.incident.findFirst({
    where: {
      status: { in: ["detected", "confirmed", "mitigating"] },
      category,
      affectedCountries: { has: country },
      updatedAt: { gte: activeCutoff },
    },
    orderBy: { detectedAt: "desc" },
  });

  if (openIncident) {
    await attachTicketToIncident(
      {
        id: ticket.id,
        severity: ticket.severity as Severity,
        branchId: ticket.agent.branchId,
      },
      openIncident.id,
      openIncident.severity as Severity,
      openIncident.affectedBranches
    );
    return openIncident.id;
  }

  // ─── Path 2: threshold check on recent un-clustered tickets ─────────
  const windowStart = new Date(now.getTime() - CLUSTER_WINDOW_MINUTES * 60_000);
  const candidates = await prisma.ticket.findMany({
    where: {
      incidentId: null,
      category,
      createdAt: { gte: windowStart },
      deletedAt: null,
      agent: { country },
    },
    include: { agent: true },
  });

  if (candidates.length < CLUSTER_THRESHOLD) return null;

  // ─── Form a new incident ────────────────────────────────────────────
  const maxSeverity = candidates.reduce<Severity>((acc, t) => {
    const s = t.severity as Severity;
    return SEVERITY_RANK[s] > SEVERITY_RANK[acc] ? s : acc;
  }, "medium");

  const branchIds = Array.from(new Set(candidates.map((t) => t.agent.branchId)));
  const firstReportedAt = candidates.reduce(
    (min, t) => (t.createdAt < min ? t.createdAt : min),
    candidates[0].createdAt
  );

  // No "connectivity" category in the current taxonomy — defer to the
  // classifier's "network" tag (which it applies for HT/DRC connectivity
  // patterns).
  const isNetworkRelated = candidates.some((t) =>
    (t.tags || []).includes("network")
  );

  const title = `${formatCategoryTitle(category)} surge — ${countryLabel(country)}`;

  const incident = await prisma.incident.create({
    data: {
      title,
      status: "detected",
      severity: maxSeverity,
      category,
      affectedCountries: [country],
      affectedBranches: branchIds,
      isNetworkRelated,
      firstReportedAt,
    },
  });

  console.log(
    `  ✓ Formed incident ${incident.id} "${title}" with ${candidates.length} tickets`
  );

  // Attach every contributing ticket and notify the dashboard about each.
  for (const t of candidates) {
    await prisma.ticket.update({
      where: { id: t.id },
      data: { incidentId: incident.id },
    });
    recordEvent({
      ticketId: t.id,
      action: t.id === ticket.id ? "incident_formed" : "clustered",
      actor: null,
      payload: { incidentId: incident.id, title },
    });
    emitTicketEvent("updated", t.id);
  }

  return incident.id;
}

/**
 * Attach a ticket to an existing incident and keep the incident's
 * severity / affected branch list current.
 */
async function attachTicketToIncident(
  ticket: { id: string; severity: Severity; branchId: string },
  incidentId: string,
  incidentSeverity: Severity,
  incidentBranches: string[]
): Promise<void> {
  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { incidentId },
  });

  // Bump severity if this ticket is more serious than what the incident
  // already tracks, and ensure the branch is recorded.
  const nextSeverity: Severity =
    SEVERITY_RANK[ticket.severity] > SEVERITY_RANK[incidentSeverity]
      ? ticket.severity
      : incidentSeverity;

  const branchSet = new Set(incidentBranches);
  branchSet.add(ticket.branchId);

  if (nextSeverity !== incidentSeverity || branchSet.size !== incidentBranches.length) {
    await prisma.incident.update({
      where: { id: incidentId },
      data: {
        severity: nextSeverity,
        affectedBranches: Array.from(branchSet),
      },
    });
  }

  recordEvent({
    ticketId: ticket.id,
    action: "clustered",
    actor: null,
    payload: { incidentId },
  });
  emitTicketEvent("updated", ticket.id);
}

function countryLabel(country: string): string {
  if (country === "HT") return "Haiti";
  if (country === "DO") return "Dominican Republic";
  if (country === "CD") return "DRC";
  return country;
}

function formatCategoryTitle(category: string): string {
  return category
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
