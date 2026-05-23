// Mirrors the shape returned by GET /api/tickets in apps/api/src/routes/tickets.ts.
// When the API stabilizes, generate these from Prisma instead of hand-maintaining.

export type Severity = "critical" | "high" | "medium" | "low";

export type TicketStatus =
  | "open"
  | "in_progress"
  | "waiting_on_agent"
  | "resolved"
  | "closed";

export type TicketCategory =
  | "bug_report"
  | "operational_complaint"
  | "feature_request"
  | "question"
  | "other";

export type Country = "HT" | "DO" | "CD";

export interface Branch {
  id: string;
  name: string;
  country: Country;
  region: string;
}

export interface Agent {
  id: string;
  phoneNumber: string;
  name: string;
  country: Country;
  preferredLanguage: "ht" | "fr" | "es" | "en";
  connectivityStatus: "online" | "intermittent" | "offline" | "unknown";
  branch: Branch;
}

export interface Message {
  id: string;
  direction: "inbound" | "outbound";
  senderType: "agent" | "internal_user" | "system" | "bot";
  originalText: string | null;
  translatedText: string | null;
  originalLanguage: string | null;
  translationConfidence: number | null;
  contentType: "text" | "image" | "audio" | "video" | "document";
  mediaUrls: string[];
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
}

export interface KnowledgeArticle {
  id: string;
  title: string;
  problemDescription: string;
  resolutionText: string;
  category: TicketCategory | null;
  productArea: string | null;
  tags: string[];
  status: "draft" | "active" | "archived";
  usageCount: number;
  successCount: number;
  failureCount: number;
  sourceTicketIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type AuditAction =
  | "ticket_created"
  | "status_changed"
  | "severity_changed"
  | "category_changed"
  | "assigned"
  | "unassigned"
  | "tagged"
  | "message_sent"
  | "note_added"
  | "resolved"
  | "deleted";

export interface AuditEvent {
  id: string;
  action: AuditAction;
  actorId: string | null;
  actorEmail: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface Note {
  id: string;
  text: string;
  mentions: string[];
  createdAt: string;
  authorId: string | null;
  author: { id: string; name: string; role: string } | null;
}

export interface InternalUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "engineering" | "operations" | "support";
}

export interface SuggestedResolution {
  id: string;
  similarityScore: number;
  wasUsed: boolean;
  wasDismissed: boolean;
  article: {
    id: string;
    title: string;
    problemDescription: string;
    resolutionText: string;
  };
}

export interface BotConversation {
  id: string;
  outcome: "resolved" | "escalated_to_ticket" | "expired" | null;
  startedAt: string;
  endedAt: string | null;
  messages: Array<{ sender: string; text: string; timestamp: string }> | null;
}

export interface TicketDetail extends Ticket {
  suggestedResolutions: SuggestedResolution[];
  botConversation: BotConversation | null;
  notes: Note[];
  events: AuditEvent[];
}

export interface Ticket {
  id: string;
  status: TicketStatus;
  category: TicketCategory;
  severity: Severity;
  productArea: string | null;
  tags: string[];
  assignedTo: string | null;
  agentReportedAt: string | null;
  slaFirstResponseDeadline: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolutionSummary: string | null;
  agent: Agent;
  messages: Message[];
  incident: { id: string; title: string; ticketCount?: number } | null;
}

export interface TicketListResponse {
  tickets: Ticket[];
  total: number;
}

export type IncidentStatus = "detected" | "confirmed" | "mitigating" | "resolved";

export interface Incident {
  id: string;
  title: string;
  status: IncidentStatus;
  severity: Severity;
  category: TicketCategory | null;
  affectedCountries: Country[];
  affectedBranches: string[];
  isNetworkRelated: boolean;
  rootCause: string | null;
  resolutionNotes: string | null;
  firstReportedAt: string | null;
  detectedAt: string;
  resolvedAt: string | null;
  ticketCount: number;
}

export interface IncidentTicketSummary {
  id: string;
  severity: Severity;
  status: TicketStatus;
  category: TicketCategory;
  createdAt: string;
  agent: {
    name: string;
    country: Country;
    branch: { name: string; region: string };
  };
}

// Returned by GET /api/incidents/:id — same shape as Incident plus the
// contributing tickets (lightweight summary, not full TicketDetail).
// Note: the single-incident endpoint doesn't include the _count.tickets
// rollup the list endpoint does, so ticketCount is derived client-side.
export interface IncidentDetail extends Omit<Incident, "ticketCount"> {
  tickets: IncidentTicketSummary[];
}
