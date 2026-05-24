-- Outbound delivery lifecycle for the queued WhatsApp send path.
-- All existing rows default to 'sent' since they were inserted by the
-- previous synchronous code path that only stored on successful send.

CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'sent', 'delivered', 'read', 'failed');

ALTER TABLE "Message"
  ADD COLUMN "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'sent',
  ADD COLUMN "deliveryError" TEXT;

-- Pending/failed lookups for retry sweeping and stale-job inspection.
CREATE INDEX "Message_deliveryStatus_createdAt_idx" ON "Message"("deliveryStatus", "createdAt");
