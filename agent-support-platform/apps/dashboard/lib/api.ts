import type {
  InternalUser,
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

export async function fetchTickets(params?: {
  status?: string;
  severity?: string;
  country?: string;
  limit?: number;
}): Promise<TicketListResponse> {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  if (params?.severity) search.set("severity", params.severity);
  if (params?.country) search.set("country", params.country);
  if (params?.limit) search.set("limit", String(params.limit));

  const res = await fetch(
    `${API_URL}/api/tickets${search.toString() ? `?${search}` : ""}`,
    { cache: "no-store" }
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch tickets: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function fetchTicket(id: string): Promise<TicketDetail> {
  const res = await fetch(`${API_URL}/api/tickets/${id}`, { cache: "no-store" });
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
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resolutionSummary }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Failed to resolve ticket: ${res.status}`);
  }
  return res.json();
}

export async function createNote(
  ticketId: string,
  text: string
): Promise<Note> {
  const res = await fetch(`${API_URL}/api/tickets/${ticketId}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Failed to create note: ${res.status}`);
  }
  return res.json();
}

export async function fetchUsers(): Promise<InternalUser[]> {
  const res = await fetch(`${API_URL}/api/users`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch users: ${res.status}`);
  const data = (await res.json()) as { users: InternalUser[] };
  return data.users;
}
