# Data Model

The database is PostgreSQL 16 with the pgvector extension. Schema is managed via Prisma (`apps/api/prisma/schema.prisma`).

## Entity Relationship Overview

```
Branch (1) ──── (N) Agent (1) ──── (N) Ticket (N) ──── (1) Incident
                      │                   │
                      │                   ├──── (N) Message
                      │                   ├──── (N) TicketSuggestedResolution ──── KnowledgeArticle
                      │                   └──── (0-1) BotConversation
                      │
                      └──── (N) BotConversation ──── (0-1) DecisionTree

InternalUser (1) ──── (N) Ticket (assigned)
ConnectivityLog (standalone, time-series)
```

## Tables

### Branch

Physical branch locations where agents operate.

| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| name | String | Branch name (e.g., "Port-au-Prince Central") |
| country | Enum: HT, DO, CD | Country code |
| region | String | Sub-national region for geographic clustering |
| latitude | Float? | GPS coordinates for map view |
| longitude | Float? | GPS coordinates for map view |
| connectivityHealth | Enum | `healthy`, `degraded`, `outage` — computed by connectivity monitor |
| connectivityHealthUpdatedAt | DateTime? | When health status last changed |

### Agent

Field agents who communicate via WhatsApp.

| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| phoneNumber | String (unique) | E.164 format (e.g., +50937001001). Used to match inbound WhatsApp messages |
| name | String | Display name (from WhatsApp profile or manually set) |
| country | Enum: HT, DO, CD | Determines SLA profile, bot TTL, clustering window |
| preferredLanguage | Enum: ht, fr, es, en | Language for outbound messages |
| branchId | FK → Branch | Which branch this agent operates |
| connectivityStatus | Enum | `online`, `intermittent`, `offline`, `unknown` — derived from delivery receipts |
| lastSeenAt | DateTime? | Last time a message was received from this agent |

**Key behaviors:**
- Auto-created on first inbound message if not already registered.
- Country is derived from phone number prefix (+509 = HT, +243 = CD, +1-809/829/849 = DO).
- `connectivityStatus` is updated when messages arrive (→ online) and when delivery receipts are delayed or missing (→ intermittent/offline).

### Ticket

A conversation thread around a single issue.

| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| agentId | FK → Agent | The reporting agent |
| incidentId | FK → Incident? | Linked incident (if part of a systemic issue) |
| status | Enum | `open` → `in_progress` → `waiting_on_agent` → `resolved` → `closed` |
| category | Enum | `bug_report`, `operational_complaint`, `feature_request`, `question`, `other` |
| severity | Enum | `critical`, `high`, `medium`, `low` |
| productArea | String? | `mobile_app`, `payments`, `lottery`, `account`, `hardware`, `other` |
| tags | String[] | Free-form tags for filtering and trend analysis |
| assignedTo | FK → InternalUser? | US team member assigned to this ticket |
| resolutionSummary | Text? | Written at close time; feeds the knowledge base indexer |
| botAttempted | Boolean | Whether the self-service bot tried to resolve this before escalation |
| botConversationId | FK → BotConversation? | Link to the bot interaction that preceded this ticket |
| slaFirstResponseDeadline | DateTime? | Computed at creation from severity + country SLA profile |
| slaResolutionDeadline | DateTime? | Computed at creation; recalculated if severity changes |
| slaFirstResponseMet | Boolean? | Set when first outbound message is sent |
| slaResolutionMet | Boolean? | Set when ticket is resolved |
| agentReportedAt | DateTime? | WhatsApp timestamp of the first message (agent-sent time, not server receipt) |
| resolvedAt | DateTime? | When status changed to resolved |

**Lifecycle rules:**
- New inbound message + no open ticket → create new ticket.
- New inbound message + open ticket with same category → append to existing.
- New inbound message + open ticket with different category → create new ticket.
- US team responds → status becomes `waiting_on_agent`.
- Agent replies after response → status becomes `in_progress`.
- Auto-close after 7 days of inactivity on `resolved` tickets.

### Message

Individual messages within a ticket conversation.

| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| ticketId | FK → Ticket | Parent ticket |
| direction | Enum | `inbound` (agent → system) or `outbound` (system → agent) |
| senderType | Enum | `agent`, `internal_user`, `system`, `bot` |
| senderId | String? | UUID of the sender (agent ID, internal user ID, or null for system) |
| originalText | Text? | Message in the original language |
| originalLanguage | Enum? | Detected language of the original text |
| translatedText | Text? | Translated version (English for inbound, agent language for outbound) |
| translationConfidence | Float? | 0–1 confidence score from the translation API |
| contentType | Enum | `text`, `image`, `audio`, `video`, `document` |
| mediaUrls | String[] | URLs in object storage for attached media |
| classification | JSON? | LLM classification output (inbound only): category, severity, tags, etc. |
| agentTimestamp | DateTime? | When the agent actually sent (from WhatsApp). Canonical time for SLAs |
| serverReceivedAt | DateTime? | When the webhook arrived. Used to compute delivery delay |
| deliveryDelay | Int? | Delta in seconds between agent send and server receipt |
| whatsappMessageId | String? | Twilio/WhatsApp message ID for delivery tracking |
| deliveredAt | DateTime? | When delivery receipt was received |
| readAt | DateTime? | When read receipt was received |

**The dual-timestamp design** is critical for Haiti/DRC. The `deliveryDelay` field is the connectivity health signal — a rolling median of this value per region powers the connectivity monitor.

### Incident

A systemic issue affecting multiple agents, auto-detected by clustering or manually created.

| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| title | String | Auto-generated (editable), e.g., "App crash — Port-au-Prince region" |
| status | Enum | `detected` → `confirmed` → `mitigating` → `resolved` |
| severity | Enum | `critical`, `high` |
| category | Enum? | Shared category of linked tickets |
| productArea | String? | Shared product area |
| affectedCountries | Country[] | Which countries are impacted |
| affectedBranches | String[] | Branch IDs in the cluster |
| isNetworkRelated | Boolean | Haiti/DRC distinction: network issue vs app issue |
| rootCause | Text? | Written during or after resolution |
| resolutionNotes | Text? | How it was fixed |
| firstReportedAt | DateTime? | Earliest agentReportedAt among linked tickets |
| detectedAt | DateTime | When the clustering engine created the incident |
| resolvedAt | DateTime? | When status changed to resolved |

### KnowledgeArticle

Reusable solutions derived from resolved tickets.

| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| title | String | Descriptive title |
| problemDescription | Text | What the issue is (LLM-summarized from original ticket messages) |
| resolutionText | Text | How to fix it (from resolution summary + response messages) |
| resolutionTextShort | Text? | Under 500 chars, for Haiti/DRC bot delivery on low bandwidth |
| resolutionTextTranslations | JSON? | Pre-translated versions: `{ ht: "...", fr: "...", es: "..." }` |
| category | Enum? | Issue category |
| productArea | String? | Product area |
| tags | String[] | Searchable tags |
| sourceTicketIds | String[] | Tickets this article was derived from |
| embedding | vector(1536) | pgvector embedding for similarity search |
| usageCount | Int | Times this article was suggested or used by the bot |
| successCount | Int | Times the suggestion resolved the issue |
| failureCount | Int | Times the suggestion was dismissed or didn't help |
| status | Enum | `draft` (needs review), `active` (live), `archived` (retired) |

**Lifecycle:** Resolved ticket → KB indexer generates draft → human reviews and approves → article goes active → bot and dashboard use it → feedback loop updates success/failure counts → auto-archive if unused for 90 days or success rate drops.

### BotConversation

A self-service bot interaction with an agent.

| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| agentId | FK → Agent | The agent who interacted with the bot |
| outcome | Enum? | `resolved` (bot fixed it), `escalated_to_ticket`, `expired` (session timed out) |
| escalatedTicketId | String? | If escalated, which ticket was created |
| decisionTreeId | FK → DecisionTree? | Which tree was used (if any) |
| knowledgeArticleId | String? | Which KB article was suggested (if any) |
| messages | JSON | Array of `{ sender: "bot"|"agent", text, timestamp }` |
| startedAt | DateTime | Session start |
| endedAt | DateTime? | Session end |

### DecisionTree

Curated troubleshooting flows for the WhatsApp bot.

| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| title | String | E.g., "App Crash Recovery" |
| category | Enum? | Maps to ticket categories |
| productArea | String? | Product area this tree covers |
| steps | JSON | Tree structure of nodes with messages and options |
| translations | JSON? | Localized content: `{ ht: {...}, fr: {...}, es: {...} }` |
| isActive | Boolean | Whether the bot uses this tree |

### ConnectivityLog

Time-series data for regional connectivity health monitoring.

| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| region | String | Region identifier |
| country | Enum | HT, DO, CD |
| medianDelay | Int | Median delivery delay in seconds over the time window |
| messageCount | Int | Number of messages in the window |
| health | Enum | Computed: `healthy`, `degraded`, `outage` |
| windowStart | DateTime | Start of the measurement window |
| windowEnd | DateTime | End of the measurement window |

### Note

Internal team-only commentary on a ticket. Not sent to the agent. Added in migration `20260522001854_add_notes`; `@-mention` support added in `20260522192935_add_note_mentions`.

| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| ticketId | FK → Ticket | Parent ticket |
| authorId | FK → InternalUser? | Who wrote it |
| body | Text | Markdown / plain text |
| mentions | String[] | InternalUser IDs `@-mentioned` in the body |
| createdAt | DateTime | When the note was posted |

### Event

Append-only audit log for ticket state changes (status, severity, assignee, category transitions) plus incident lifecycle events. Added in migration `20260522164558_add_event`. Used by the activity log in the ticket drawer / detail page.

## Indexes

Shipped in migration `20260522001855_add_indexes_and_unique_whatsapp_id`:

```prisma
@@index([agentId, status, createdAt])     // on Ticket: find open tickets by agent
@@index([severity, slaFirstResponseDeadline]) // on Ticket: dashboard queue sort
@@index([category, createdAt])            // on Ticket: clustering queries
@@index([ticketId, createdAt])            // on Message: conversation thread
@@index([agentTimestamp])                 // on Message: timeline reconstruction
@@index([country, region, windowEnd])     // on ConnectivityLog: health queries

@@unique([whatsappMessageId])             // on Message: idempotency on Twilio retries
```

## pgvector Setup

The `KnowledgeArticle.embedding` column uses pgvector's `vector(1536)` type. To enable:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Similarity search query:
```sql
SELECT id, title, problem_description, resolution_text,
       1 - (embedding <=> $1::vector) AS similarity
FROM knowledge_articles
WHERE status = 'active'
  AND 1 - (embedding <=> $1::vector) > 0.6
ORDER BY embedding <=> $1::vector
LIMIT 5;
```
