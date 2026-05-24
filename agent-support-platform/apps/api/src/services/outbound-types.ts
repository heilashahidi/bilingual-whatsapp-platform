// Shared contract for the outbound WhatsApp send path. Lives in its own
// file so the queue (which owns the BullMQ Queue instance) and the
// pipeline (which executes a job) can each depend on it without
// importing each other — that would form a cycle.

export interface OutboundJob {
  messageId: string; // Pre-created Message row to update with sid/status
  ticketId: string;
  agentPhone: string;
  agentCountry: string;
  englishText: string;
  targetLanguage: string;
}
