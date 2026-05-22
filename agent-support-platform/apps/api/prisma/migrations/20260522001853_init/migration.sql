-- CreateEnum
CREATE TYPE "Country" AS ENUM ('HT', 'DO', 'CD');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('ht', 'fr', 'es', 'en');

-- CreateEnum
CREATE TYPE "ConnectivityStatus" AS ENUM ('online', 'intermittent', 'offline', 'unknown');

-- CreateEnum
CREATE TYPE "ConnectivityHealth" AS ENUM ('healthy', 'degraded', 'outage');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('open', 'in_progress', 'waiting_on_agent', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('bug_report', 'operational_complaint', 'feature_request', 'question', 'other');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('critical', 'high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "SenderType" AS ENUM ('agent', 'internal_user', 'system', 'bot');

-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('text', 'image', 'audio', 'video', 'document');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'engineering', 'operations', 'support');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('detected', 'confirmed', 'mitigating', 'resolved');

-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "BotOutcome" AS ENUM ('resolved', 'escalated_to_ticket', 'expired');

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" "Country" NOT NULL,
    "region" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "connectivityHealth" "ConnectivityHealth" NOT NULL DEFAULT 'healthy',
    "connectivityHealthUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" "Country" NOT NULL,
    "preferredLanguage" "Language" NOT NULL DEFAULT 'ht',
    "branchId" TEXT NOT NULL,
    "connectivityStatus" "ConnectivityStatus" NOT NULL DEFAULT 'unknown',
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "incidentId" TEXT,
    "status" "TicketStatus" NOT NULL DEFAULT 'open',
    "category" "TicketCategory" NOT NULL DEFAULT 'other',
    "severity" "Severity" NOT NULL DEFAULT 'medium',
    "productArea" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assignedTo" TEXT,
    "resolutionSummary" TEXT,
    "botAttempted" BOOLEAN NOT NULL DEFAULT false,
    "botConversationId" TEXT,
    "slaFirstResponseDeadline" TIMESTAMP(3),
    "slaResolutionDeadline" TIMESTAMP(3),
    "slaFirstResponseMet" BOOLEAN,
    "slaResolutionMet" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "agentReportedAt" TIMESTAMP(3),

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "senderType" "SenderType" NOT NULL,
    "senderId" TEXT,
    "originalText" TEXT,
    "originalLanguage" "Language",
    "translatedText" TEXT,
    "translationConfidence" DOUBLE PRECISION,
    "contentType" "ContentType" NOT NULL DEFAULT 'text',
    "mediaUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "classification" JSONB,
    "agentTimestamp" TIMESTAMP(3),
    "serverReceivedAt" TIMESTAMP(3),
    "deliveryDelay" INTEGER,
    "whatsappMessageId" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalUser" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'support',
    "notificationPreferences" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'detected',
    "severity" "Severity" NOT NULL DEFAULT 'high',
    "category" "TicketCategory",
    "productArea" TEXT,
    "affectedCountries" "Country"[] DEFAULT ARRAY[]::"Country"[],
    "affectedBranches" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isNetworkRelated" BOOLEAN NOT NULL DEFAULT false,
    "rootCause" TEXT,
    "resolutionNotes" TEXT,
    "firstReportedAt" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeArticle" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "problemDescription" TEXT NOT NULL,
    "resolutionText" TEXT NOT NULL,
    "resolutionTextShort" TEXT,
    "resolutionTextTranslations" JSONB,
    "category" "TicketCategory",
    "productArea" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceTicketIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "embedding" vector(1536),
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "status" "ArticleStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketSuggestedResolution" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "similarityScore" DOUBLE PRECISION NOT NULL,
    "wasUsed" BOOLEAN NOT NULL DEFAULT false,
    "wasDismissed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketSuggestedResolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotConversation" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "outcome" "BotOutcome",
    "escalatedTicketId" TEXT,
    "decisionTreeId" TEXT,
    "knowledgeArticleId" TEXT,
    "messages" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "BotConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionTree" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "TicketCategory",
    "productArea" TEXT,
    "steps" JSONB NOT NULL,
    "translations" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecisionTree_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectivityLog" (
    "id" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "country" "Country" NOT NULL,
    "medianDelay" INTEGER NOT NULL,
    "messageCount" INTEGER NOT NULL,
    "health" "ConnectivityHealth" NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_phoneNumber_key" ON "Agent"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "InternalUser_email_key" ON "InternalUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "TicketSuggestedResolution_ticketId_articleId_key" ON "TicketSuggestedResolution"("ticketId", "articleId");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assignedTo_fkey" FOREIGN KEY ("assignedTo") REFERENCES "InternalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_botConversationId_fkey" FOREIGN KEY ("botConversationId") REFERENCES "BotConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketSuggestedResolution" ADD CONSTRAINT "TicketSuggestedResolution_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketSuggestedResolution" ADD CONSTRAINT "TicketSuggestedResolution_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotConversation" ADD CONSTRAINT "BotConversation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotConversation" ADD CONSTRAINT "BotConversation_decisionTreeId_fkey" FOREIGN KEY ("decisionTreeId") REFERENCES "DecisionTree"("id") ON DELETE SET NULL ON UPDATE CASCADE;
