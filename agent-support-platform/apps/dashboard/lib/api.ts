import { getClientAuthToken } from "./auth-client";
import type {
  Agent,
  Incident,
  InternalUser,
  KnowledgeArticle,
  Message,
  Note,
  Severity,
  Ticket,
  TicketCategory,
  TicketDetail,
  TicketListResponse,
  TicketStatus,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// Resolves a Bearer header: prefer an explicitly-passed token (server
// components pass theirs from cookies), otherwise auto-fetch via the
// client-side endpoint when running in the browser.
async function authHeaders(token?: string): Promise<HeadersInit> {
  const t = token ?? (typeof window !== "undefined" ? await getClientAuthToken() : undefined);
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function fetchTickets(
  params?: {
    status?: string;
    severity?: string;
    country?: string;
    limit?: number;
  },
  token?: string
): Promise<TicketListResponse> {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  if (params?.severity) search.set("severity", params.severity);
  if (params?.country) search.set("country", params.country);
  if (params?.limit) search.set("limit", String(params.limit));

  const res = await fetch(
    `${API_URL}/api/tickets${search.toString() ? `?${search}` : ""}`,
    {
      headers: await authHeaders(token),
      cache: "no-store",
    }
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch tickets: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function fetchTicket(
  id: string,
  token?: string
): Promise<TicketDetail> {
  const res = await fetch(`${API_URL}/api/tickets/${id}`, {
    headers: await authHeaders(token),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ticket ${id}: ${res.status}`);
  }
  return res.json();
}

export async function sendResponse(
  ticketId: string,
  text: string
): Promise<{ message: Message; translatedText: string }> {
  const res = await fetch(`${API_URL}/api/tickets/${ticketId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Failed to send response: ${res.status}`);
  }
  return res.json();
}

export interface TicketPatch {
  status?: TicketStatus;
  severity?: Severity;
  category?: TicketCategory;
  assignedTo?: string | null;
  tags?: string[];
}

export async function updateTicket(
  ticketId: string,
  patch: TicketPatch
): Promise<Ticket> {
  const res = await fetch(`${API_URL}/api/tickets/${ticketId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Failed to update ticket: ${res.status}`);
  }
  return res.json();
}

export async function resolveTicket(
  ticketId: string,
  resolutionSummary?: string
): Promise<Ticket> {
  const res = await fetch(`${API_URL}/api/tickets/${ticketId}/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ resolutionSummary }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Failed to resolve ticket: ${res.status}`);
  }
  return res.json();
}

export async function deleteTicket(ticketId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/tickets/${ticketId}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Failed to delete ticket: ${res.status}`);
  }
}

export async function createNote(
  ticketId: string,
  text: string,
  mentions: string[] = []
): Promise<Note> {
  const res = await fetch(`${API_URL}/api/tickets/${ticketId}/notes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ text, mentions }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Failed to create note: ${res.status}`);
  }
  return res.json();
}

export async function fetchKnowledgeArticles(
  params?: { status?: "draft" | "active" | "archived" },
  token?: string
): Promise<KnowledgeArticle[]> {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  const res = await fetch(
    `${API_URL}/api/knowledge${search.toString() ? `?${search}` : ""}`,
    {
      headers: await authHeaders(token),
      cache: "no-store",
    }
  );
  if (!res.ok) throw new Error(`Failed to fetch knowledge: ${res.status}`);
  const data = (await res.json()) as { articles: KnowledgeArticle[] };
  return data.articles;
}

export async function approveKnowledgeArticle(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/knowledge/${id}/approve`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Approve failed: ${res.status}`);
  }
}

export async function archiveKnowledgeArticle(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/knowledge/${id}/archive`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Archive failed: ${res.status}`);
  }
}

export async function fetchUsers(token?: string): Promise<InternalUser[]> {
  const res = await fetch(`${API_URL}/api/users`, {
    headers: await authHeaders(token),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to fetch users: ${res.status}`);
  const data = (await res.json()) as { users: InternalUser[] };
  return data.users;
}

// ─── Agents (search) ──────────────────────────────────────────────────
// Used by the New Ticket modal's agent picker.

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

// ─── Outreach ticket ──────────────────────────────────────────────────
// Support-team-initiated thread. Backend translates the message into the
// agent's preferredLanguage and sends via Twilio before creating the ticket.

export interface OutreachTicketInput {
  agentId: string;
  message: string;
  severity: Severity;
  category: TicketCategory;
  tags?: string[];
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

// ─── Incidents ─────────────────────────────────────────────────────────

export async function fetchIncidents(
  params: { status?: string; country?: string } = {},
  token?: string
): Promise<Incident[]> {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.country) search.set("country", params.country);

  const res = await fetch(
    `${API_URL}/api/incidents${search.toString() ? `?${search}` : ""}`,
    {
      headers: await authHeaders(token),
      cache: "no-store",
    }
  );
  if (!res.ok) throw new Error(`Failed to fetch incidents: ${res.status}`);
  const data = (await res.json()) as { incidents: Incident[] };
  return data.incidents;
}

export async function updateIncident(
  id: string,
  patch: { status?: string; rootCause?: string; resolutionNotes?: string }
): Promise<Incident> {
  const res = await fetch(`${API_URL}/api/incidents/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Failed to update incident: ${res.status}`);
  }
  const data = (await res.json()) as { incident: Incident };
  return data.incident;
}
