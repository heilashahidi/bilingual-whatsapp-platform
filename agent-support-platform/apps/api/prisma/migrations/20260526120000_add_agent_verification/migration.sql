-- Sender verification for the inbound WhatsApp pipeline (SECURITY.md §5.1).
-- Adds two nullable timestamps to Agent:
--   verifiedAt — set when an admin/operations user confirms this number
--                belongs to a real field agent. Required for the agent's
--                tickets to enter the normal flow (Slack notify, auto-intake,
--                KB suggestions, incident clustering).
--   rejectedAt — set when an admin marks the number as a confirmed scammer
--                or spammer. Keeps the agent quarantined and surfaces in
--                the rejected view; future messages remain isolated.
--
-- Backfill policy: every existing Agent predates this control and was
-- effectively trusted by the auto-register-on-first-message behavior,
-- so we mark all of them as verified-at-creation. New agents created
-- after this migration start with verifiedAt = NULL and must be
-- explicitly promoted.

ALTER TABLE "Agent"
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "rejectedAt" TIMESTAMP(3);

UPDATE "Agent" SET "verifiedAt" = "createdAt" WHERE "verifiedAt" IS NULL;

CREATE INDEX "Agent_verifiedAt_idx" ON "Agent" ("verifiedAt");
CREATE INDEX "Agent_rejectedAt_idx" ON "Agent" ("rejectedAt");
