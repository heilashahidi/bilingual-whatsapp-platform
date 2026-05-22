/* ─── lib/api.ts additions ────────────────────────────────────────────
   Append the functions below to `apps/dashboard/lib/api.ts`. Both call
   endpoints that do NOT exist yet — they need backend support before the
   New Ticket modal works end-to-end. Frontend code shipping without the
   backend is harmless: the modal will surface the error string from the
   failed fetch.

   Backend tasks (apps/api):

   1. GET /api/agents?q=<string>&limit=<n>
        - Search agents by name, phoneNumber, or branch.name (ILIKE).
        - Returns { agents: Agent[] }.
        - Used by the agent picker in the New Ticket modal.

   2. POST /api/tickets/outreach
        - Body: { agentId, message, severity, category, tags? }
        - Behavior:
            a. Translate `message` from English into the agent's
               preferredLanguage (use the existing translation pipeline).
            b. Send via Twilio WhatsApp to the agent.
            c. Create a Ticket with status="open", agentReportedAt=now,
               with the outbound message attached as the first message
               (direction="outbound", senderType="internal_user").
            d. Compute slaFirstResponseDeadline using the existing
               country-specific SLA config.
        - Returns the created Ticket (same shape as fetchTicket).
   ─────────────────────────────────────────────────────────────────── */

// ⚠ Add `Agent` to the existing `import type { ... } from "./types";`
//   block at the top of api.ts — don't add a second import statement.

export interface OutreachTicketInput {
  agentId: string;
  message: string;
  severity: Severity;
  category: TicketCategory;
  tags?: string[];
}

export async function fetchAgents(
  params: { q?: string; limit?: number } = {},
  token?: string
): Promise<Agent[]> {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.limit) search.set("limit", String(params.limit));

  const res = await fetch(
    `${API_URL}/api/agents${search.toString() ? `?${search}` : ""}`,
    {
      headers: await authHeaders(token),
      cache: "no-store",
    }
  );
  if (!res.ok) throw new Error(`Failed to search agents: ${res.status}`);
  const data = (await res.json()) as { agents: Agent[] };
  return data.agents;
}

export async function createOutreachTicket(
  input: OutreachTicketInput
): Promise<Ticket> {
  const res = await fetch(`${API_URL}/api/tickets/outreach`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Failed to create outreach ticket: ${res.status}`);
  }
  return res.json();
}
