-- Make whatsappMessageId unique for idempotent dedup
CREATE UNIQUE INDEX "Message_whatsappMessageId_key" ON "Message"("whatsappMessageId");

-- Performance indexes documented in DATA_MODEL.md but never created
CREATE INDEX "Ticket_agentId_status_createdAt_idx" ON "Ticket"("agentId", "status", "createdAt");
CREATE INDEX "Ticket_severity_slaFirstResponseDeadline_idx" ON "Ticket"("severity", "slaFirstResponseDeadline");
CREATE INDEX "Ticket_category_createdAt_idx" ON "Ticket"("category", "createdAt");
CREATE INDEX "Message_ticketId_createdAt_idx" ON "Message"("ticketId", "createdAt");
CREATE INDEX "Message_agentTimestamp_idx" ON "Message"("agentTimestamp");
CREATE INDEX "ConnectivityLog_country_region_windowEnd_idx" ON "ConnectivityLog"("country", "region", "windowEnd");
