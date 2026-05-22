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

export interface Note {
  id: string;
  text: string;
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
  resolutionSummary: string | null;
  assignedTo: string | null;
  notes: Note[];
}

export interface Ticket {
  id: string;
  status: TicketStatus;
  category: TicketCategory;
  severity: Severity;
  productArea: string | null;
  tags: string[];
  agentReportedAt: string | null;
  slaFirstResponseDeadline: string | null;
  createdAt: string;
  resolvedAt: string | null;
  agent: Agent;
  messages: Message[];
  incident: { id: string; title: string } | null;
}

export interface TicketListResponse {
  tickets: Ticket[];
  total: number;
}
