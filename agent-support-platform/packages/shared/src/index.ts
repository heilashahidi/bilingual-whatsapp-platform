// ─── RawMessage: The normalized envelope every inbound message
//     is converted into, regardless of source (Twilio, Meta, etc.) ───

export interface RawMessage {
  source: "whatsapp";
  externalId: string; // WhatsApp message ID (for idempotency)
  agentPhone: string; // E.164 format
  agentTimestamp: string; // ISO-8601 — when the agent actually sent
  serverReceivedAt: string; // ISO-8601 — when our webhook received it
  contentType: "text" | "image" | "audio" | "video" | "document";
  textBody: string | null;
  mediaUrl: string | null;
  metadata: {
    countryCode: string;
    profileName: string | null;
  };
}

// ─── Classification output from LLM ────────────────────────

export interface ClassificationResult {
  category:
    | "bug_report"
    | "operational_complaint"
    | "feature_request"
    | "question"
    | "other";
  severity: "critical" | "high" | "medium" | "low";
  tags: string[];
  productArea:
    | "mobile_app"
    | "payments"
    | "lottery"
    | "account"
    | "hardware"
    | "other";
  confidence: number;
  likelyNetwork: boolean; // Haiti/DRC: is this a connectivity issue vs app issue?
}

// ─── SLA configuration per country ──────────────────────────

export interface SlaConfig {
  firstResponseMinutes: number;
  resolutionMinutes: number;
}

export const SLA_DEFAULTS: Record<string, Record<string, SlaConfig>> = {
  // Standard SLAs (DR)
  standard: {
    critical: { firstResponseMinutes: 60, resolutionMinutes: 240 },
    high: { firstResponseMinutes: 240, resolutionMinutes: 1440 },
    medium: { firstResponseMinutes: 1440, resolutionMinutes: 4320 },
    low: { firstResponseMinutes: 2880, resolutionMinutes: 10080 },
  },
  // Extended SLAs (Haiti/DRC — 1.5x)
  extended: {
    critical: { firstResponseMinutes: 90, resolutionMinutes: 360 },
    high: { firstResponseMinutes: 360, resolutionMinutes: 2160 },
    medium: { firstResponseMinutes: 2160, resolutionMinutes: 5760 },
    low: { firstResponseMinutes: 4320, resolutionMinutes: 10080 },
  },
};

// Countries that use extended SLAs due to connectivity constraints
export const EXTENDED_SLA_COUNTRIES = ["HT", "CD"];

// ─── Bot session config per country ─────────────────────────

export const BOT_SESSION_TTL: Record<string, number> = {
  HT: 7200, // 2 hours (Haiti — extended for connectivity)
  CD: 7200, // 2 hours (DRC — extended for connectivity)
  DO: 1800, // 30 minutes (DR — standard)
};

// Max message length for bot responses by country
export const BOT_MAX_MESSAGE_LENGTH: Record<string, number> = {
  HT: 1000, // Haiti — keep short for 2G
  CD: 1000, // DRC — keep short for 2G
  DO: 2000, // DR — standard
};

// ─── Connectivity health thresholds ─────────────────────────

export const CONNECTIVITY_THRESHOLDS = {
  healthyMaxDelaySeconds: 30,
  degradedMaxDelaySeconds: 300, // 5 minutes
  // Anything above degraded = outage
  silenceAlertMinutes: 45, // Alert if no messages from a region for this long
  deliveryPendingAlertHours: 2, // Flag undelivered outbound messages
  deliveryLostHours: 24, // Mark agent as offline
};

// ─── Incident clustering config per country ─────────────────

export const CLUSTERING_CONFIG: Record<string, { timeWindowHours: number; minTickets: number }> = {
  HT: { timeWindowHours: 6, minTickets: 3 }, // Wider window for Haiti
  CD: { timeWindowHours: 6, minTickets: 3 }, // Wider window for DRC
  DO: { timeWindowHours: 2, minTickets: 3 }, // Standard for DR
};
