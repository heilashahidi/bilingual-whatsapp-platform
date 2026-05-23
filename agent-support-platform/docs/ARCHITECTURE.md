# Agent Support Platform — Architecture & Implementation Outline

## 1. System Overview

The platform has three major subsystems that communicate through a central message bus, augmented by three intelligence layers: incident clustering, a self-service bot, and a knowledge base built from resolved tickets.

```
Field Agents (WhatsApp)
        ↕
  WhatsApp Self-Service Bot ← Knowledge Base (resolved tickets)
        ↕ (unresolved → escalate)
  Ingress / Egress Adapter
        ↕
    Message Bus (SQS / Pub/Sub)
        ↕
  ┌─────────────────────────────────────────┐
  │  Translation Layer                      │
  │  Classification Engine                  │
  │  Incident Clustering Engine (NEW)       │
  │  Knowledge Base Retrieval Layer (NEW)   │
  │  Notification Router                    │
  └─────────────────────────────────────────┘
        ↕
  Core API + Persistence
        ↕
  Internal Dashboard (Web App)
```

Every message flows through the pipeline: **bot intercept → ingest → translate → classify → cluster check → knowledge base match → route → store → notify**. The architecture is event-driven so each stage can scale and fail independently.

**Critical constraint — Haiti connectivity:** Haiti has some of the lowest internet penetration and slowest average speeds in the Western Hemisphere. Agents frequently operate on 2G/EDGE connections, experience multi-hour outages, and deal with rolling power cuts. The DRC faces similar challenges. Every component in this system is designed with the assumption that the agent's connection is unreliable, slow, and intermittent. This means: messages may arrive in bursts after an outage, media uploads may fail or take minutes, bot conversations may have 30-minute gaps between messages, and delivery receipts may be delayed by hours. The system must never assume real-time connectivity on the agent side.

---

## 2. High-Level Architecture

### 2.1 Component Map

| Layer | Components | Responsibility |
|---|---|---|
| **Ingress/Egress** | WhatsApp Business API adapter, Dashboard WebSocket gateway | Accept and deliver messages in both directions |
| **Self-Service Bot** | WhatsApp bot engine, decision-tree runner, knowledge base search | Intercept common issues, attempt resolution before ticket creation |
| **Message Pipeline** | Event queue, Translation service, Classification service | Process every message through translate → classify → enrich |
| **Incident Intelligence** | Clustering worker, incident manager, geo-temporal correlation engine | Detect systemic issues by grouping related tickets across agents/branches |
| **Knowledge Base** | Resolution index, similarity search, article manager | Store and retrieve past solutions; feed the bot and suggest fixes to the US team |
| **Core API** | REST/GraphQL API server | CRUD for tickets, agents, incidents, knowledge articles, responses; auth; business logic |
| **Persistence** | Primary database, vector store, media object store, search index | Store tickets, messages, translations, embeddings, media, audit logs |
| **Dashboard** | React SPA | Ticket queue, incident view, knowledge base manager, agent profiles, analytics, response composer |
| **Notifications** | Push/email/Slack dispatcher | Alert US team of new tickets, incidents, or escalations |

### 2.2 Message Lifecycle (Agent → System)

1. Agent sends a WhatsApp message (text, voice note, image, or video).
2. WhatsApp Business API webhook delivers the event to the **Ingress Adapter**.
3. Adapter normalizes the payload into an internal `RawMessage` envelope.
4. **Self-Service Bot** evaluates the message:
   - If it matches a known issue in the knowledge base with a high-confidence solution, the bot responds to the agent directly in their language with the fix and asks "Did that help?"
   - If the agent confirms resolution → log the interaction (no ticket created, counted as bot-resolved).
   - If the agent says no, or the bot has no confident match → message continues into the pipeline.
5. **Translation Worker** detects language (Haitian Creole, French, Spanish), translates to English, and attaches both the original and translation.
6. **Classification Worker** reads the English text and assigns category, severity, tags, and product area.
7. **Knowledge Base Retrieval** searches resolved tickets for similar issues and attaches the top matches as `suggested_resolutions` on the ticket — these surface on the dashboard for the US team member.
8. **Ticket Manager** either appends the message to an existing open ticket or creates a new one.
9. **Incident Clustering Worker** checks if the new ticket correlates with other recent tickets by category + geography + time window. If a cluster threshold is crossed, an Incident is created (or the ticket is linked to an existing incident).
10. **Notification Router** fires alerts based on severity, category, and incident status.
11. The ticket, incident links, and all enrichments are written to the database and search index.
12. Dashboard receives a real-time update via WebSocket.

### 2.3 Message Lifecycle (US Team → Agent)

1. US team member types a response in English on the dashboard. They can optionally select a suggested resolution from the knowledge base and edit it, or write from scratch.
2. API server validates and persists the response.
3. **Translation Worker** translates from English into the agent's preferred language.
4. The translated message is sent through the **Egress Adapter** to the WhatsApp Business API.
5. Delivery receipts are tracked and surfaced on the dashboard.
6. When the ticket is resolved, the **Knowledge Base Indexer** evaluates the resolution for inclusion in the knowledge base (see Section 3.9).

---

## 3. Component-by-Component Breakdown

### 3.1 WhatsApp Integration Layer

**Purpose:** Bidirectional bridge between WhatsApp and the internal message pipeline.

**Technology:** WhatsApp Business API (Cloud API hosted by Meta).

**Key design decisions:**

- Register a single WhatsApp Business Account with one phone number per country (3 numbers total). This keeps the experience familiar — agents message the same number they already know.
- Use webhook verification with a signed secret. All incoming webhooks land on a single `/webhooks/whatsapp` endpoint behind a load balancer.
- The adapter is a thin, stateless service. Its only job is to validate the webhook signature, normalize the payload into a `RawMessage` schema, and publish to the queue. It does not call the database.
- For outbound messages (both bot responses and US team replies), a separate egress worker reads from an `outbound_messages` queue and calls the WhatsApp Cloud API send endpoint, handling rate limits and retries.

**Payload normalization — `RawMessage` schema:**

```
{
  source: "whatsapp",
  external_id: "<whatsapp message id>",
  agent_phone: "+509...",
  agent_timestamp: ISO-8601,         // when the agent actually pressed send (from WhatsApp)
  server_received_at: ISO-8601,      // when the webhook arrived at our server
  content_type: "text" | "image" | "audio" | "video" | "document",
  text_body: "<raw text or null>",
  media_url: "<url to download media or null>",
  metadata: { country_code, profile_name }
}
```

The delta between `agent_timestamp` and `server_received_at` is a key metric. It's stored on every message and used for connectivity health scoring (see Section 4.4). All pipeline components that involve time — SLA computation, incident clustering, bot session TTL, analytics — use `agent_timestamp` as the canonical time.

**Media handling:** Images, voice notes, and videos are downloaded from the WhatsApp media URL, stored in object storage (S3/GCS), and the `media_url` in the internal envelope is rewritten to the internal storage path. Voice notes are additionally sent through a speech-to-text step before entering translation.

**Haiti/DRC media constraints:** Media uploads from agents on low-bandwidth connections frequently fail or arrive corrupted. The system handles this:
- **Retry-tolerant media download:** If the WhatsApp media URL download fails, the worker retries with exponential backoff (3 attempts over 15 minutes). If it still fails, the ticket is created with a "media unavailable" placeholder and a flag for the US team to request the agent re-send.
- **Compressed outbound media:** Any images or files sent from the US team to Haiti/DRC agents are automatically compressed before sending (images resized to 800px max width, JPEG quality 60). This is handled by the egress worker based on the agent's country.
- **Voice note preference over images:** For Haiti/DRC agents, voice notes are often more practical than typing or sending screenshots (lower data usage, works on basic smartphones). The bot and US team responses should lean toward text instructions rather than sending images or documents back.

**Resilience:**
- Webhook endpoint returns `200 OK` immediately after enqueuing; processing is async.
- Idempotency via `external_id` deduplication.
- Dead-letter queue for messages that fail normalization.

---

### 3.2 WhatsApp Self-Service Bot

**Purpose:** Resolve common, known issues instantly without involving the US team — reducing ticket volume and giving agents an immediate response in their language.

**How it works:**

The bot sits between the ingress adapter and the ticket pipeline. Every incoming message hits the bot first. The bot has two resolution strategies, tried in order:

**Strategy 1 — Decision Tree Match:**
A curated set of 15–20 decision trees covering the most common known issues (app crash recovery, connectivity troubleshooting, transaction retry steps, password reset, etc.). The bot uses keyword matching and the LLM classifier to detect if the message maps to a tree. If it does, the bot walks the agent through the steps via WhatsApp interactive messages (buttons and quick replies).

**Strategy 2 — Knowledge Base Search:**
If no decision tree matches but the knowledge base has a high-confidence match from a previously resolved ticket, the bot presents that resolution as a suggestion: "Other agents had a similar issue. Try this: [resolution]. Did that fix it?"

**If neither strategy has a confident match:** The message passes through to the full pipeline and a ticket is created normally. The agent receives an acknowledgment: "Got it — your issue has been sent to the support team. You'll hear back shortly."

**Conversation state management:**
- Bot conversations are stateful (the agent might be mid-way through a troubleshooting tree). State is stored in Redis with a TTL (e.g., 30 minutes of inactivity expires the session).
- The bot tracks where the agent is in a decision tree so they can pick up where they left off.
- If at any point the agent says something like "talk to a person" or "this isn't helping," the bot immediately escalates to the ticket pipeline with the full bot conversation attached as context.

**Latency-aware bot design (Haiti/DRC):**

Agents in Haiti and the DRC regularly deal with 2G connections, multi-second round trips, dropped packets, and power outages. The bot must be designed for this reality:

- **Single-message resolution preference:** Where possible, the bot sends the complete troubleshooting steps in one message rather than a multi-step back-and-forth. A 5-step decision tree that requires 5 round trips may take 10+ minutes on a bad connection. Instead, for simple issues, send all steps at once: "Try these steps: 1) ... 2) ... 3) ... Reply YES if fixed, NO if not." This cuts the interaction to 2 messages instead of 10.
- **Extended session TTL by country:** Redis TTL for Haiti/DRC bot sessions is 2 hours (not 30 minutes). An agent on a slow connection or dealing with a power cut should be able to resume the conversation when connectivity returns. DR sessions can use the standard 30-minute TTL.
- **Message queuing tolerance:** If multiple messages arrive in a burst after a connectivity gap (the agent typed 3 messages offline and they all deliver at once), the bot processes only the most recent message in the context of the current session state, ignoring duplicates or stale intermediate messages. Use WhatsApp message timestamps (not arrival time) to determine order.
- **No media in bot responses for Haiti/DRC:** Bot responses in Haiti and DRC are text-only and use WhatsApp quick-reply buttons (which are lightweight). No images, no PDFs, no video links. Keep each message under 1,000 characters to ensure fast rendering on low-end devices with slow connections.
- **Graceful timeout messaging:** When a bot session expires due to inactivity, the next message from the agent doesn't get a confusing error. Instead, the bot treats it as a fresh conversation and responds naturally. If the expired session had reached a meaningful state (e.g., the agent was mid-troubleshoot), the bot says: "Welcome back! Last time we were working on [issue]. Would you like to continue, or is this about something new?" — pulling the summary from the persisted session record.
- **Offline escalation guarantee:** If the bot decides to escalate to a ticket but the confirmation message to the agent fails to deliver (no delivery receipt within 5 minutes), the ticket is still created. The agent's lack of connectivity doesn't block the support pipeline. A delivery-pending flag is set and retried.

**Language handling:**
- Decision tree content is authored in English and pre-translated into Haitian Creole, French, and Spanish (stored as localized templates).
- Knowledge base suggestions are translated on-the-fly using the same translation service.
- The bot detects the agent's language from their first message and responds in that language throughout the session.

**WhatsApp interactive message types used:**
- **Quick reply buttons** for yes/no and multiple-choice steps ("Did that fix it?" → [Yes] [No, still broken]).
- **List messages** for selecting from several options ("What kind of issue are you having?" → App problem / Transaction problem / Connectivity / Other).
- **Plain text** for instructions and explanations.

**Metrics tracked:**
- Bot resolution rate (% of conversations resolved without ticket creation).
- Bot deflection rate by issue type.
- Average bot conversation length.
- Escalation rate (bot failed to resolve).
- Agent satisfaction with bot (optional thumbs up/down after resolution).

**Data model additions:**

```
BotConversation
  - id (UUID)
  - agent_id (FK → Agent)
  - started_at
  - ended_at
  - outcome (resolved | escalated_to_ticket | expired)
  - escalated_ticket_id (FK → Ticket, nullable)
  - decision_tree_id (nullable)
  - knowledge_article_id (nullable)
  - messages (JSON array of bot/agent message pairs)

DecisionTree
  - id
  - title
  - category (maps to ticket categories)
  - product_area
  - steps (JSON — tree structure of nodes)
  - translations (JSON — localized content per language)
  - is_active (boolean)
  - created_at
  - updated_at
```

---

### 3.3 Translation Service

**Purpose:** Transparent, bidirectional translation so each side reads and writes in their own language.

**Supported language pairs:**
- Haitian Creole (ht) ↔ English (en)
- French (fr) ↔ English (en)
- Spanish (es) ↔ English (en)

**Architecture:**

- Deployed as a stateless worker that subscribes to `raw_messages` and `outbound_responses` queues.
- Each message is processed through: **language detection → translation → confidence scoring**.
- Language detection is necessary because agents may code-switch (e.g., Creole mixed with French). Use a detection model first, then route to the appropriate translation pair.

**Technology options (evaluate in this order):**

1. **Google Cloud Translation API (v3 Advanced)** — best Haitian Creole support among commercial APIs. Supports custom glossaries which you will need for domain-specific terms (agent jargon, product names, lottery terminology).
2. **DeepL** — superior quality for French and Spanish, but no Haitian Creole support. Could be used as a secondary engine for FR/ES pairs.
3. **Custom fine-tuned model** — only pursue this if commercial APIs fail on domain-specific accuracy after glossary tuning. The data collection burden is high.

**Critical implementation details:**

- **Glossary/terminology management:** Build a custom glossary per language pair with fintech and product-specific terms. "Lottery" in the operational context, transaction types, error message strings, branch names. This glossary is version-controlled and deployable without a code change.
- **Store both original and translated text.** Every message in the database has `original_text`, `original_language`, `translated_text`, `translation_confidence`. The dashboard shows the English translation by default with a toggle to reveal the original.
- **Voice note pipeline:** WhatsApp voice notes → download `.ogg` file → Google Speech-to-Text (supports Haitian Creole) → text in original language → translation pipeline. The transcript is attached to the ticket alongside the audio file.
- **Confidence thresholds:** If translation confidence is below a configurable threshold (e.g., 0.7), flag the message on the dashboard with a "translation may be inaccurate" warning and surface the original text prominently.
- **Human override:** Dashboard users can edit a translation. Edited translations are logged and can feed back into glossary improvements.

---

### 3.4 Classification & Triage Engine

**Purpose:** Automatically categorize and prioritize incoming messages so the US team sees a pre-sorted, actionable queue instead of a raw stream.

**Classification dimensions:**

| Dimension | Values | Purpose |
|---|---|---|
| Category | `bug_report`, `operational_complaint`, `feature_request`, `question`, `other` | Route to the right team |
| Severity | `critical`, `high`, `medium`, `low` | Set queue priority and notification urgency |
| Tags | Free-form, e.g., `app_crash`, `transaction_failure`, `connectivity`, `lottery_results`, `slow_payout` | Enable filtering, trend analysis, and incident clustering |
| Product area | `mobile_app`, `payments`, `lottery`, `account`, `hardware`, `other` | Route to the right engineering pod |

**Implementation approach:**

- Use a lightweight LLM (Claude Haiku or GPT-4o-mini) with a carefully engineered system prompt that includes your category definitions, severity rubric, and example messages. This avoids the cold-start problem of a custom ML model and handles the multilingual, informal, code-switched nature of agent messages.
- The classifier runs on the **English translation** so the prompt and rubric only need to be maintained in one language.
- Output is structured JSON parsed from the LLM response.
- **Fallback:** If the LLM call fails or returns unparseable output, the message is classified as `other` / `medium` and flagged for manual triage.
- **Feedback loop:** Dashboard users can reclassify any ticket. Reclassifications are logged and periodically reviewed to update the system prompt examples and rubric.

**Severity rubric (encode this in the classifier prompt):**

- **Critical:** Agent cannot process any transactions; app is completely down; security incident.
- **High:** Agent can work but a significant function is broken; repeated transaction failures; data discrepancy affecting money.
- **Medium:** Intermittent issue; slow performance; non-blocking complaint.
- **Low:** Feature request; cosmetic issue; general question.

---

### 3.5 Ticket / Conversation Management

**Purpose:** Group related messages into tickets, track state, and maintain the full conversation thread.

**Data model (core entities):**

```
Agent
  - id (UUID)
  - phone_number (unique, E.164)
  - name
  - country (HT | DO | CD)
  - preferred_language (ht | fr | es)
  - branch_id
  - connectivity_status (online | intermittent | offline | unknown)  ← NEW
  - last_seen_at (timestamp, nullable)                                ← NEW
  - created_at

Branch
  - id
  - name
  - country
  - region
  - latitude
  - longitude
  - connectivity_health (healthy | degraded | outage)                 ← NEW
  - connectivity_health_updated_at                                    ← NEW

Ticket
  - id (UUID)
  - agent_id (FK → Agent)
  - incident_id (FK → Incident, nullable)        ← NEW
  - status (open | in_progress | waiting_on_agent | resolved | closed)
  - category (bug_report | operational_complaint | feature_request | question | other)
  - severity (critical | high | medium | low)
  - product_area
  - tags (array)
  - assigned_to (FK → InternalUser, nullable)
  - suggested_resolutions (array of article IDs)  ← NEW
  - resolution_summary (text, nullable)           ← NEW (written at close, feeds KB)
  - bot_attempted (boolean, default false)         ← NEW
  - bot_conversation_id (FK → BotConversation, nullable) ← NEW
  - created_at
  - updated_at
  - resolved_at
  - sla_deadline (computed from severity)

Message
  - id (UUID)
  - ticket_id (FK → Ticket)
  - direction (inbound | outbound)
  - sender_type (agent | internal_user | system | bot)  ← bot added
  - sender_id
  - original_text
  - original_language
  - translated_text
  - translation_confidence
  - content_type (text | image | audio | video)
  - media_urls (array)
  - classification (JSON, only on inbound)
  - created_at

InternalUser
  - id
  - name
  - email
  - role (admin | engineering | operations | support)
  - notification_preferences (JSON)

Incident                                          ← NEW (Section 3.7)
  - id (UUID)
  - title (auto-generated, editable)
  - status (detected | confirmed | mitigating | resolved)
  - severity (critical | high)
  - category
  - product_area
  - affected_countries (array)
  - affected_branches (array of branch IDs)
  - ticket_ids (array of linked ticket IDs)
  - ticket_count
  - first_reported_at
  - detected_at
  - resolved_at
  - root_cause (text, nullable)
  - resolution_notes (text, nullable)
  - created_by (system | internal_user)

KnowledgeArticle                                  ← NEW (Section 3.8)
  - id (UUID)
  - title
  - problem_description
  - resolution_text
  - resolution_text_translations (JSON — per language)
  - category
  - product_area
  - tags (array)
  - source_ticket_ids (array — tickets this was derived from)
  - embedding (vector — for similarity search)
  - usage_count (times suggested or used by bot)
  - success_rate (% of times the suggestion resolved the issue)
  - status (draft | active | archived)
  - created_at
  - updated_at
```

**Ticket lifecycle rules:**

- A new inbound message from an agent with no open ticket creates a new ticket (unless the bot resolved it).
- A new inbound message from an agent with an existing open/in_progress/waiting_on_agent ticket appends to that ticket.
- If the most recent ticket from that agent was resolved/closed more than 24 hours ago, or if the new message's classified category differs from the open ticket's category, create a new ticket.
- When a US team member responds, status moves to `waiting_on_agent`.
- When the agent replies after a US team response, status moves back to `in_progress`.
- Manual resolution by the US team sets status to `resolved`. The dashboard prompts the user to write a brief `resolution_summary` (used by the knowledge base indexer). Auto-close after 7 days of inactivity on resolved tickets.

**SLA computation:**

| Severity | First Response SLA (DR) | First Response SLA (Haiti/DRC) | Resolution SLA (DR) | Resolution SLA (Haiti/DRC) |
|---|---|---|---|---|
| Critical | 1 hour | 1.5 hours | 4 hours | 6 hours |
| High | 4 hours | 6 hours | 24 hours | 36 hours |
| Medium | 24 hours | 36 hours | 72 hours | 96 hours |
| Low | 48 hours | 72 hours | 1 week | 1 week |

SLA deadlines are computed at ticket creation and recalculated if severity changes. Breached SLAs trigger escalation notifications. Tickets linked to a confirmed incident may have SLA paused (the incident itself has its own resolution timeline).

**Haiti/DRC SLA adjustments:**
- **SLA clock uses message-sent time, not server-received time.** An agent in Haiti may send a critical bug report at 9:00 AM but the message doesn't reach the server until 9:45 AM due to connectivity. The SLA clock starts at 9:00 AM (the WhatsApp timestamp), not 9:45 AM. This ensures the US team sees how long the agent has actually been waiting.
- **Extended SLAs:** Haiti and DRC get 1.5x the standard SLA windows to account for the reality that delivery confirmation of the response may itself be delayed. The US team's response time is measured at the point they send, but the SLA budget includes buffer for delivery uncertainty.
- **Delivery-aware resolution:** A ticket is not considered "response delivered" until a WhatsApp delivery receipt is received. If the US team responds but the agent hasn't received it after 2 hours (no delivery receipt), the dashboard shows a "Response pending delivery" warning with an amber badge. This prevents the team from assuming an issue is handled when the agent hasn't actually seen the reply.
- **Connectivity-pause rules:** If the system detects a regional connectivity outage (see Section 3.7), SLA clocks for all tickets from that region are paused until connectivity resumes. This prevents mass SLA breaches caused by infrastructure outside anyone's control.

---

### 3.6 Internal Dashboard (Web Application)

**Purpose:** The primary interface for the US-based operations and engineering teams to manage, respond to, and analyze agent-reported issues.

**Technology:** React (Next.js or Vite), TypeScript, Tailwind CSS. Real-time updates via WebSocket (Socket.IO or native WS).

**Core views:**

**a) Ticket Queue (default view)**
- Table/list of tickets sorted by severity then SLA deadline.
- Columns: severity badge, category icon, agent name, branch, country, subject (first line of translated text), status, assigned to, time since creation, SLA countdown, incident link badge (if part of an incident).
- Filters: status, severity, category, product area, country, branch, assigned to, date range, tags, incident-linked.
- Bulk actions: assign, change severity, change category, close, link to incident.
- Real-time: new tickets appear at top with a subtle animation; SLA countdowns tick live.

**b) Ticket Detail View**
- Full conversation thread, each message showing:
  - English translation (primary).
  - Toggle to show original text.
  - Media attachments (images rendered inline, audio with playback controls, video with player).
  - Bot conversation history (if the bot attempted resolution before escalation), shown as a collapsed "Bot Interaction" section at the top of the thread.
  - Timestamp, sender.
- **Suggested Resolutions panel (NEW):** A sidebar section showing knowledge base matches ranked by relevance. Each suggestion shows the problem description and resolution. The US team member can click "Use this" to auto-populate the response composer with the resolution text (editable before sending), or "Not relevant" to dismiss and improve future matching.
- Right sidebar: ticket metadata (status, severity, category, tags, assigned to, SLA status, linked incident), agent profile card (name, phone, branch, country, recent ticket history).
- Response composer at the bottom: rich text input, type in English, preview the auto-translated version before sending, attach files.
- **Resolution summary prompt:** When marking a ticket as resolved, a modal asks the user to write a brief summary of what the problem was and how it was fixed. This is optional but encouraged — it feeds the knowledge base.
- Internal notes (visible only to US team, not sent to agent).
- Activity log: status changes, reassignments, reclassifications, SLA events, incident linkage.

**c) Incident View (NEW)**
- **Incident list:** Active incidents sorted by severity and ticket count. Each row shows title, severity, affected countries, number of linked tickets, time since detection, status.
- **Incident detail:** 
  - Map showing affected branches as pins, color-coded by ticket count.
  - Timeline of when each linked ticket was reported.
  - Combined conversation view (all linked ticket threads accessible in tabs).
  - Root cause and resolution notes fields.
  - "Broadcast" action: send a single update to all affected agents simultaneously (translated per agent's language).
  - "Resolve incident" action: resolves the incident and optionally bulk-resolves all linked tickets with a shared resolution message.
- **Incident creation:** Can be auto-created by the clustering engine (see 3.7) or manually created by a US team member who selects tickets to link.

**d) Knowledge Base Manager (NEW)**
- **Article list:** Searchable, filterable list of all knowledge articles. Columns: title, category, usage count, success rate, status, last updated.
- **Article editor:** Create/edit articles with problem description, resolution text, category, tags. Preview the auto-translated versions. Toggle active/archived status.
- **Auto-suggested articles:** A queue of system-generated draft articles (from the knowledge base indexer) waiting for human review and approval.
- **Decision tree editor:** Visual editor for the WhatsApp bot decision trees. Drag-and-drop node editor with preview of the WhatsApp conversation flow.
- **Bot performance dashboard:** Resolution rate, deflection rate by issue type, escalation reasons, most/least effective articles and trees.

**e) Agent Directory**
- Searchable list of all agents with branch, country, contact info.
- Click through to see agent's ticket history, bot interaction history, message volume, common issue types.

**f) Analytics Dashboard**
- Ticket volume over time, sliced by country/category/severity.
- **Bot deflection metrics (NEW):** % of incoming messages resolved by bot, trend over time, by issue type.
- **Incident metrics (NEW):** Incidents per week, average time to detect, average time to resolve, most affected branches.
- **Connectivity metrics (NEW):** Regional connectivity health map, average message delivery delay by region, outage timeline, agent online/offline distribution, percentage of messages with delivery delay > 5 minutes.
- **Knowledge base metrics (NEW):** Most-used articles, article success rates, coverage gaps (common ticket categories with no matching articles).
- Average resolution time by category and severity.
- SLA compliance rate.
- Top recurring issues (tag frequency).
- Agent-level metrics: tickets per agent, response satisfaction.
- Exportable to CSV.

**g) Settings & Admin**
- User management and role-based access control.
- Notification rule configuration.
- SLA threshold configuration.
- Translation glossary management.
- Category and tag taxonomy management.
- **Incident clustering thresholds** (min tickets, time window, geo radius — configurable per country).
- **Bot configuration** (enable/disable per country, confidence thresholds, fallback behavior, session TTL per country).
- **Connectivity monitoring thresholds** (healthy/degraded/outage delay thresholds, SLA auto-pause triggers, silence detection window per region).

---

### 3.7 Incident Clustering Engine

**Purpose:** Automatically detect when multiple agents are reporting the same systemic issue, so the US team can respond to the root cause instead of triaging individual tickets in isolation.

**How it works:**

A clustering worker runs on a schedule (every 5 minutes) and on every new ticket creation. It looks for correlations across three dimensions:

1. **Category + Tags:** Tickets with the same category and overlapping tags (e.g., multiple `bug_report` tickets tagged `app_crash`).
2. **Geography:** Tickets from agents in the same country, region, or branch cluster.
3. **Time window:** Tickets created within a configurable rolling window (default: 2 hours).

**Clustering algorithm:**

- When a new ticket is created, the worker queries recent tickets (within the time window) that share the same category.
- It computes a similarity score based on: tag overlap (Jaccard similarity), geographic proximity (same branch > same region > same country), and temporal density (more tickets in a shorter window = higher score).
- If the cluster size crosses a threshold (configurable, default: 3 tickets with similarity score > 0.6), the system either creates a new Incident or links the ticket to an existing active incident with matching characteristics.

**Haiti/DRC connectivity-aware clustering:**

Connectivity issues in Haiti and the DRC create two specific challenges for incident clustering that must be handled explicitly:

- **Distinguishing app issues from network issues:** When 5 agents in Port-au-Prince all report "app not loading" within an hour, it could be an app outage — or it could be an ISP outage in that area. The clustering engine tags connectivity-related tickets (`connectivity`, `app_not_loading`, `timeout`, `cannot_connect`) with a `likely_network` flag. When a cluster forms entirely from `likely_network` tickets in Haiti or DRC, the auto-generated incident is labeled as "Possible Network Issue — [Region]" rather than an app incident, and the notification routes to ops rather than engineering. The dashboard surfaces a "Network vs. App" toggle on the incident detail view so the US team can reclassify once they investigate.
- **Delayed message bursts create false temporal clusters:** After a regional connectivity outage resolves, agents whose messages were queued offline will all deliver within minutes. This looks like a sudden spike of 10+ reports in 5 minutes, but the issues may have occurred over the past 3 hours. The clustering engine uses **WhatsApp message timestamps** (when the agent actually sent), not **server receipt timestamps** (when the webhook arrived), to place tickets on the temporal axis. This prevents post-outage message bursts from creating phantom incidents. The `RawMessage` schema already carries the WhatsApp timestamp; this is the field used for all clustering time-window calculations.
- **Wider time windows for Haiti/DRC:** The default 2-hour clustering window is too narrow when agents may be offline for hours. Haiti and DRC clusters use a 6-hour rolling window. DR uses the standard 2 hours. These are configurable per country in the admin settings.
- **Connectivity outage auto-detection:** If the system notices that no messages have been received from any agent in a specific Haitian or DRC region for 30+ minutes (when it normally receives a steady trickle), it proactively creates a "Connectivity Monitoring" alert on the dashboard. This isn't an incident yet — it's a heads-up that the silence might mean an outage, not that everything is fine.

**Incident lifecycle:**

```
[detected] → system auto-creates when cluster threshold is crossed
    ↓
[confirmed] → US team member reviews and confirms it's a real incident
    ↓
[mitigating] → team is actively working on a fix
    ↓
[resolved] → root cause identified and fixed; resolution notes written
```

**Incident actions available on the dashboard:**

- **Link/unlink tickets** manually (the clustering engine may miss some, or false-positive link others).
- **Broadcast to affected agents:** Compose one message, it's translated and sent to every agent linked to the incident. Useful for "We're aware of the issue and working on it" communications.
- **Resolve with bulk update:** Resolve the incident and all linked tickets with a single resolution message.
- **Post-mortem:** After resolution, the incident's root cause and resolution can be converted into a knowledge base article with one click.

**Edge cases handled:**

- A ticket created before the cluster threshold was reached gets retroactively linked when the threshold is crossed.
- If an incident is resolved but new matching tickets come in within a grace period (1 hour), the incident is reopened.
- Overlapping incidents (same category, different regions) are kept separate but surfaced with a "related incidents" link on the dashboard.

**Notification integration:**

| Trigger | Channel | Recipients |
|---|---|---|
| New incident auto-detected | Slack `#agent-incidents` | Ops lead + on-call engineer |
| Incident ticket count crosses 10 | Slack `#agent-incidents` + PagerDuty | Engineering manager |
| Incident resolved | Slack `#agent-incidents` | All who were notified |

---

### 3.8 Resolved-Ticket Knowledge Base

**Purpose:** Turn every resolved ticket into institutional memory. Surface past solutions to the US team when they handle new tickets, and feed the WhatsApp bot's self-service capability.

**Architecture:**

The knowledge base has three layers:

**Layer 1 — Knowledge Base Indexer (automated ingestion)**

When a ticket is resolved, a worker evaluates whether the resolution is worth indexing:

- Does the ticket have a `resolution_summary`? (Required — tickets resolved without a summary are skipped, which is why the dashboard prompts for one.)
- Is the issue category `bug_report`, `operational_complaint`, or `question`? (Feature requests are excluded.)
- Is the resolution actionable (not just "issue resolved itself" or "duplicate")?

If the ticket passes these checks, the worker generates a draft `KnowledgeArticle`:
- `problem_description`: synthesized from the agent's original messages (LLM-generated summary).
- `resolution_text`: from the `resolution_summary` + the US team member's response messages (LLM-cleaned).
- `category`, `product_area`, `tags`: copied from the ticket.
- `embedding`: a vector embedding of the problem description (used for similarity search).
- `status`: `draft` (requires human approval before it goes live).

Draft articles appear in the Knowledge Base Manager on the dashboard for review. A US team member can edit, approve (→ `active`), or discard them.

**Layer 2 — Similarity Search (retrieval at ticket creation)**

When a new ticket is created, the system generates an embedding of the translated message text and queries the vector store for the nearest knowledge articles. The top 3–5 matches (above a confidence threshold) are attached to the ticket as `suggested_resolutions` and displayed on the dashboard.

**Technology:** Use pgvector (PostgreSQL extension) for the vector store. This avoids adding a separate vector database — the embeddings live alongside the relational data. For embedding generation, use OpenAI's `text-embedding-3-small` or Cohere's `embed-english-v3.0` (lightweight, cheap, fast).

**Layer 3 — Bot Integration (self-service)**

The WhatsApp bot's Strategy 2 (see Section 3.2) queries the same knowledge base. The difference is the confidence threshold: the bot only presents a solution if the similarity score is above a higher bar (e.g., 0.85) than what's shown to the US team (0.6), because the bot is responding autonomously without human oversight.

**Latency-aware KB delivery:** When the bot sends a knowledge base resolution to an agent in Haiti or DRC, the message is optimized for low-bandwidth conditions. Resolution text is condensed to under 500 characters. If the full resolution is longer, the bot sends a short version first and offers "Reply MORE for full steps." This avoids sending a 2,000-character message that times out on a 2G connection and leaves the agent with a partial, broken response. The short version is pre-generated and cached when the article is approved, not computed on the fly.

**Feedback loop:**

- When a US team member clicks "Use this" on a suggested resolution → the article's `usage_count` increments and `success_rate` is updated when the ticket is eventually resolved.
- When a US team member clicks "Not relevant" → negative signal, used to re-rank future suggestions.
- When the bot presents a solution and the agent confirms it worked → `success_rate` improves.
- When the bot presents a solution and the agent escalates → `success_rate` decreases.
- Articles with consistently low success rates are auto-flagged for review. Articles unused for 90+ days are auto-archived.

**Knowledge base coverage dashboard:**

The analytics view includes a "coverage gap" analysis: it looks at the most common ticket categories/tags and identifies which ones have no matching knowledge articles. This tells the team where to invest in writing new articles or building new bot decision trees.

---

### 3.9 Notification & Escalation System

**Purpose:** Ensure the right people know about the right issues at the right time without drowning anyone in noise.

**Channels:** Slack (primary), email (secondary), PagerDuty (critical only).

**Routing rules (configurable via dashboard):**

| Trigger | Channel | Recipients |
|---|---|---|
| New critical ticket | Slack `#agent-critical` + PagerDuty | On-call engineer + ops lead |
| New high ticket | Slack `#agent-issues` | Assigned team based on product area |
| New incident detected | Slack `#agent-incidents` | Ops lead + on-call engineer |
| Incident crosses 10 tickets | Slack `#agent-incidents` + PagerDuty | Engineering manager |
| SLA at 75% elapsed | Slack DM to assigned user | Assigned user |
| SLA breached | Slack `#agent-escalations` + email | Assigned user's manager |
| New feature request | Weekly digest email | Product team |
| Daily summary | Slack `#agent-ops-daily` | Ops team |
| Weekly KB coverage gap report | Email | Product + ops leads |

**Implementation:** A notification worker subscribes to ticket and incident events (created, updated, sla_warning, sla_breached, incident_detected, incident_escalated) and evaluates them against the rule set. Notifications are debounced per ticket (no more than one Slack message per ticket per 15 minutes unless severity changes).

---

## 4. Infrastructure & Deployment

### 4.1 Recommended Stack

| Concern | Technology | Rationale |
|---|---|---|
| Compute | AWS ECS Fargate or GCP Cloud Run | Containerized, auto-scaling, no server management |
| Message queue | Amazon SQS or Google Cloud Pub/Sub | Managed, durable, handles spiky load from 1k+ agents |
| Primary database | PostgreSQL (RDS/Cloud SQL) with pgvector extension | Relational integrity for tickets + vector search for knowledge base |
| Search | PostgreSQL full-text search (start here) → Elasticsearch if needed | Avoid premature complexity; PG full-text handles the initial scale |
| Vector embeddings | pgvector (in PostgreSQL) | No separate vector DB needed at this scale; co-located with relational data |
| Object storage | S3 / GCS | Media files (images, audio, video) |
| Real-time | WebSocket via Socket.IO on the API server, backed by Redis pub/sub for multi-instance | Dashboard live updates |
| Cache / Bot state | Redis | Session cache, bot conversation state, rate limiting, real-time pub/sub |
| CDN | CloudFront / Cloud CDN | Dashboard static assets |
| CI/CD | GitHub Actions → deploy to container registry → ECS/Cloud Run | Standard pipeline |
| Monitoring | Datadog or CloudWatch + Sentry for errors | Observability |
| Embedding model | OpenAI text-embedding-3-small or Cohere embed-english-v3.0 | Cheap, fast, good quality for similarity search |
| LLM (classification + KB summarization) | Claude Haiku or GPT-4o-mini | Lightweight, cost-effective for structured classification and short summaries |

### 4.2 Environment Strategy

- **Development:** Local Docker Compose (all services + Postgres/pgvector + Redis + queue emulator).
- **Staging:** Mirrors production, connected to WhatsApp test numbers.
- **Production:** Multi-AZ deployment, auto-scaling policies on workers.

### 4.3 Security

- All data encrypted at rest (database, object storage) and in transit (TLS everywhere).
- WhatsApp webhook signature verification on every request.
- Dashboard authentication via SSO (Google Workspace / Okta) with RBAC.
- API authentication via JWT with short-lived tokens.
- PII handling: agent phone numbers and names are PII. Access is logged. Consider field-level encryption for phone numbers at rest.
- Rate limiting on all public-facing endpoints.
- Bot conversation logs are stored with the same security as ticket data.
- Audit log for all ticket state changes, incident actions, knowledge base edits, and data access.

### 4.4 Haiti & DRC Connectivity Resilience

Haiti and the DRC present infrastructure challenges that are fundamentally different from the DR or US-side operations. These aren't edge cases — they affect the majority of your agent base and must be first-class concerns in the architecture.

**The reality on the ground:**
- Haiti averages 2–5 Mbps mobile speeds in Port-au-Prince, significantly worse in rural areas. Many agents operate on 2G/EDGE with effective speeds under 100 Kbps.
- Power outages are daily in many regions. Agents charge phones opportunistically and may be offline for hours.
- The DRC has similar constraints, with mobile coverage gaps outside major cities.
- WhatsApp is the dominant communication platform precisely because it's optimized for low-bandwidth environments — the system should respect that optimization and not fight against it.

**Architecture-level responses:**

**a) Message timestamp discipline:**
Every component in the pipeline uses the WhatsApp message timestamp (when the agent actually pressed send) as the canonical time, not the server receipt time. This single decision affects SLA computation, incident clustering time windows, bot session management, and analytics accuracy. The `RawMessage` envelope carries both `agent_timestamp` (from WhatsApp) and `server_received_at` (when the webhook arrived). The delta between these two values is itself a useful metric — it's a proxy for connectivity quality per agent and per region.

**b) Connectivity health monitoring:**
A background worker tracks the `agent_timestamp` → `server_received_at` delta per region and maintains a rolling connectivity health score. This feeds into:
- The dashboard's geographic view (regions with degraded connectivity are shown with a connectivity indicator).
- Incident clustering (distinguishing app issues from network issues).
- SLA pause triggers (if a region's connectivity score drops below a threshold, SLAs are paused).
- Proactive alerts ("No messages received from [region] in 45 minutes — possible outage").

The health score is computed as: median message delivery delay over a 30-minute rolling window, per region. A healthy region has a median delay under 30 seconds. Degraded is 30 seconds to 5 minutes. Outage is 5+ minutes or zero messages received.

**c) Outbound message optimization:**
All messages sent to Haiti/DRC agents are subject to:
- **Text compression:** Messages are kept under 1,000 characters. Longer messages are split into numbered parts ("1/3", "2/3", "3/3") so partial delivery still provides useful information.
- **No rich media unless requested:** Bot responses and system notifications are text-only with quick-reply buttons. No images, PDFs, or video links unless the agent explicitly asks.
- **Staggered sending:** Incident broadcasts to Haiti/DRC agents are sent in batches of 50 with 10-second gaps to avoid overwhelming the local mobile infrastructure.
- **Delivery receipt tracking:** Every outbound message is tracked for delivery. Messages undelivered after 4 hours are flagged on the dashboard. Messages undelivered after 24 hours trigger a "connectivity lost" status on the agent's profile.

**d) Agent connectivity status:**
Each agent has a derived `connectivity_status` field on their profile, computed from recent message delivery patterns:
- `online` — message delivered and read receipts within the last hour.
- `intermittent` — messages delivering but with delays over 5 minutes.
- `offline` — no delivery receipts in the last 4 hours.
- `unknown` — no recent outbound messages to check.

This status is visible on the dashboard and factored into incident analysis (if 20 agents in a region are all "offline," that's a connectivity event, not an app event).

**e) Graceful degradation chain:**
When connectivity to a specific region fails, the system degrades gracefully:
1. Bot sessions for that region are extended (TTL pushed to 4 hours).
2. SLA clocks for that region are paused.
3. Outbound messages are queued (not dropped) and delivered when connectivity resumes.
4. A connectivity incident is auto-created on the dashboard.
5. When messages start flowing again (the "burst" after an outage), the system processes them using agent timestamps to reconstruct the true timeline, not the delivery-burst timestamp.

### 4.5 Realtime horizontal scaling (current constraint)

Section 4.1 lists Socket.IO "backed by Redis pub/sub for multi-instance"
as the target architecture. **The Redis adapter is not yet wired up**,
which has a concrete operational consequence: the API must stay pinned
to a **single machine** until it is.

**Why it matters:** the API hosts the Socket.IO server in-process. When
`emitTicketEvent()` fires, it broadcasts to clients connected to *that
specific machine*. If you run two API machines behind a load balancer
(as Fly does during a rolling deploy), the Twilio webhook lands on
machine A while half the dashboard clients are connected to machine B
— and machine B never tells its clients about the new ticket. Users
silently stop seeing realtime updates.

We hit this during testing (see `fly.api.toml` comment) and resolved
it by destroying the second machine. The fix is documented but not
enforced; a `fly scale count 2` would re-introduce the bug.

**Migration path** when scale demands it (probably north of ~5k
concurrent dashboard sessions, or whenever we add a worker pool):

1. `pnpm --filter @asp/api add @socket.io/redis-adapter ioredis`
2. In `apps/api/src/services/realtime.ts`, replace the default
   in-memory adapter:
   ```ts
   import { createAdapter } from "@socket.io/redis-adapter";
   import { createClient } from "redis";
   const pubClient = createClient({ url: process.env.REDIS_URL });
   const subClient = pubClient.duplicate();
   await Promise.all([pubClient.connect(), subClient.connect()]);
   io.adapter(createAdapter(pubClient, subClient));
   ```
3. Update `fly.api.toml` to drop the single-machine comment and let
   `min_machines_running` / `auto_start_machines` scale freely.
4. Upstash Redis (`REDIS_URL`) is already provisioned and currently
   unused at runtime — perfect target for the adapter without
   additional infrastructure work.

No code change is needed in any other component — `emitTicketEvent`
keeps its current signature. The change is entirely internal to the
realtime service.

---

## 5. Implementation Phases

### Phase 1 — Foundation (Weeks 1–4)

**Goal:** Messages flow from WhatsApp to a basic dashboard with translation. US team can read and respond.

- Set up WhatsApp Business API account and webhook receiver.
- Build the ingress adapter and message normalization.
- Integrate Google Cloud Translation with a starter glossary.
- Build the core API: agents, tickets, messages CRUD.
- Build a minimal dashboard: ticket list, ticket detail with conversation thread, response composer.
- Implement the outbound message flow (dashboard → translate → WhatsApp).
- Deploy to staging, test with 5–10 agents.

**Deliverable:** A working end-to-end loop. An agent messages WhatsApp, a US team member sees it in English on the dashboard, types a reply, and the agent receives it in their language.

### Phase 2 — Intelligence (Weeks 5–7)

**Goal:** Automated classification, prioritized queue, SLA tracking.

- Build the classification worker with LLM-based categorization.
- Implement ticket auto-routing based on category and product area.
- Add SLA computation and countdown to the dashboard.
- Build the notification system (Slack integration first).
- Add severity and category filters, bulk actions to the dashboard.
- Refine the translation glossary based on Phase 1 data.

**Deliverable:** The US team works from a prioritized, auto-categorized queue with SLA visibility and Slack alerts.

### Phase 3 — Knowledge Base + Suggested Resolutions (Weeks 8–10)

**Goal:** Past solutions surface automatically; resolution quality improves over time.

- Set up pgvector and the embedding pipeline.
- Build the Knowledge Base Indexer worker (ticket resolution → draft article).
- Build the similarity search service (new ticket → suggested resolutions).
- Add the Suggested Resolutions panel to the ticket detail view on the dashboard.
- Build the Knowledge Base Manager view (article list, editor, draft approval queue).
- Add the resolution summary prompt to the ticket close flow.
- Seed the knowledge base with 20–30 manually written articles for the most common issues.

**Deliverable:** When a US team member opens a ticket, they see relevant past resolutions. Resolved tickets automatically generate draft knowledge articles.

### Phase 4 — Incident Clustering (Weeks 11–13)

**Goal:** Systemic issues are automatically detected and managed as incidents.

- Build the clustering worker (geo-temporal correlation logic).
- Add the Incident data model and API endpoints.
- Build the Incident list and detail views on the dashboard (map, timeline, broadcast, bulk resolve).
- Integrate incident detection with the notification system.
- Add incident-to-knowledge-article conversion (post-mortem → KB).
- Test with synthetic incident scenarios.

**Deliverable:** When 3+ agents in the same region report the same issue within 2 hours, the system auto-creates an incident. The US team manages it from a dedicated view and can broadcast updates to all affected agents.

### Phase 5 — WhatsApp Self-Service Bot (Weeks 14–16)

**Goal:** Common issues resolved instantly without human intervention.

- Build the bot engine (conversation state machine, decision tree runner).
- Author the initial 15–20 decision trees for the most common issues (based on Phase 1–4 ticket data).
- Integrate the bot with the knowledge base for dynamic resolution suggestions.
- Build the decision tree editor on the dashboard.
- Build the bot performance dashboard (resolution rate, escalation rate).
- Implement bot → ticket escalation with full context handoff.
- Gradual rollout: enable bot for one country first, measure deflection rate, tune confidence thresholds, then expand.

**Deliverable:** Agents get instant responses for known issues. The US team's ticket volume drops measurably. Bot performance is visible on the analytics dashboard.

### Phase 6 — Media, Analytics & Production Hardening (Weeks 17–19)

**Goal:** Full media support, comprehensive analytics, and production readiness.

- Implement media download and storage pipeline.
- Integrate speech-to-text for voice notes.
- Build media rendering in the dashboard (inline images, audio player, video player).
- Build the full analytics dashboard (ticket metrics, bot metrics, incident metrics, KB coverage gaps).
- Build the agent directory with ticket and bot interaction history.
- Load testing, security audit, monitoring setup.
- Gradual rollout: 50 agents → 200 → all.

**Deliverable:** Full platform in production with all 1,000+ agents, complete with self-service bot, incident detection, and knowledge base.

---

## 6. Key Technical Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Haitian Creole translation quality | Agents' issues are misunderstood, wrong triage | Custom glossary; confidence scoring with warnings; human edit capability; log corrections to improve over time |
| WhatsApp Business API rate limits | Outbound messages to 1,000+ agents throttled (especially incident broadcasts) | Queue-based sending with exponential backoff; batch non-urgent messages; apply for higher throughput tier; stagger broadcast sends |
| Agent message ambiguity | Short, informal messages are hard to classify | Classification prompt includes examples of ambiguous messages; default to `medium`/`other` and flag for manual review; improve prompt with reclassification data |
| Voice note transcription accuracy | Creole speech-to-text is imperfect | Show audio playback alongside transcript; flag low-confidence transcriptions; allow US team to request agent re-send as text |
| Scale of media storage | 1,000 agents sending images/videos daily | Lifecycle policies on object storage (archive after 90 days, delete after 1 year); compress media on ingest; set max file size limits |
| Translation API single point of failure | All communication stops if Google Translate goes down | Circuit breaker pattern; queue messages for retry; fallback to showing original text with a "translation unavailable" flag |
| Bot gives wrong advice | Agent follows incorrect self-service steps, worsening the issue | High confidence threshold (0.85) for bot suggestions; always offer "Talk to support" escape; track success rate per article and auto-disable low performers; human approval required before articles go live |
| Incident false positives | Clustering links unrelated tickets, creating noise | Require manual confirmation step (detected → confirmed); allow easy unlink; tune thresholds per country/category; start conservative and loosen |
| Knowledge base goes stale | Old resolutions are suggested for issues that have changed | Auto-archive articles unused for 90 days; flag articles when their success rate drops; prompt periodic review in weekly digest |
| Bot conversation state lost | Redis failure mid-conversation leaves agent in limbo | TTL-based expiry with graceful fallback ("Sorry, let me start over"); persist critical state to database if conversation reaches escalation |
| Haiti/DRC connectivity outages cause message bursts | Post-outage bursts create false incident clusters and flood the pipeline | Use agent-sent timestamps (not server-received) for all temporal logic; connectivity health monitoring auto-pauses SLA clocks; clustering uses wider time windows for Haiti/DRC |
| Haiti/DRC agents can't complete bot conversations | Multi-step bot flows time out on slow connections; agents give up | Single-message resolution preference for Haiti/DRC; extended session TTL (2 hours); graceful session resumption after timeout; text-only responses under 1,000 characters |
| Delivery receipts delayed or missing for Haiti/DRC | US team thinks a response was delivered when agent hasn't received it | Track delivery status per message; show "pending delivery" badge on dashboard; don't auto-advance ticket status until delivery confirmed; alert after 2+ hours undelivered |
| Power outages take agents offline for hours | Tickets go unresolved, SLAs breach, bot sessions expire | Extended SLAs for Haiti/DRC (1.5x); connectivity-based SLA pausing; outbound message queuing survives agent offline periods; agent connectivity status on dashboard |
| Low bandwidth prevents media-heavy responses | Images and documents fail to deliver or take minutes to load | Auto-compress outbound media for Haiti/DRC; bot responses are text-only; offer "Reply MORE" for long KB articles instead of sending full content; prefer text instructions over screenshots |

---

## 7. API Design (Key Endpoints)

```
# Tickets
GET    /api/tickets                        # List with filters, pagination, sort
GET    /api/tickets/:id                    # Detail with messages, suggested resolutions, incident link
POST   /api/tickets/:id/messages           # Send a response (triggers translate + WhatsApp send)
PATCH  /api/tickets/:id                    # Update status, severity, category, assignment, tags, incident link
POST   /api/tickets/:id/notes              # Add internal note
POST   /api/tickets/:id/resolve            # Resolve with resolution_summary (triggers KB indexer)

# Incidents
GET    /api/incidents                      # List active/recent incidents
GET    /api/incidents/:id                  # Detail with linked tickets, timeline, map data
POST   /api/incidents                      # Manually create an incident
PATCH  /api/incidents/:id                  # Update status, link/unlink tickets, add root cause
POST   /api/incidents/:id/broadcast        # Send message to all affected agents
POST   /api/incidents/:id/resolve          # Resolve incident + optionally bulk-resolve tickets
POST   /api/incidents/:id/to-article       # Convert post-mortem to knowledge base draft article

# Knowledge Base
GET    /api/knowledge                      # List articles with search, filters
GET    /api/knowledge/:id                  # Article detail
POST   /api/knowledge                      # Create article manually
PATCH  /api/knowledge/:id                  # Edit article
GET    /api/knowledge/drafts               # Auto-generated drafts awaiting review
POST   /api/knowledge/:id/approve          # Approve draft → active
POST   /api/knowledge/:id/archive          # Archive article
GET    /api/knowledge/search               # Similarity search (used internally by bot and dashboard)

# Bot
GET    /api/bot/decision-trees             # List decision trees
GET    /api/bot/decision-trees/:id         # Tree detail
POST   /api/bot/decision-trees             # Create tree
PATCH  /api/bot/decision-trees/:id         # Edit tree
GET    /api/bot/conversations              # Bot conversation history (for analytics)
GET    /api/bot/stats                      # Bot performance metrics

# Agents
GET    /api/agents                         # List with search, country filter
GET    /api/agents/:id                     # Profile with ticket + bot interaction history

# Analytics
GET    /api/analytics/volume               # Ticket volume time series
GET    /api/analytics/resolution           # Resolution time stats
GET    /api/analytics/sla                  # SLA compliance rates
GET    /api/analytics/top-issues           # Tag/category frequency
GET    /api/analytics/bot                  # Bot deflection and resolution metrics
GET    /api/analytics/incidents            # Incident frequency, detection time, resolution time
GET    /api/analytics/knowledge-gaps       # Categories with high ticket volume but no KB articles
GET    /api/analytics/connectivity         # Regional connectivity health, delivery delays, outage history

# Webhooks (external)
POST   /webhooks/whatsapp                  # Incoming WhatsApp events

# WebSocket
WS     /ws                                 # Real-time dashboard updates (tickets, incidents, bot events)

# Admin
GET    /api/glossary                       # Translation glossary entries
POST   /api/glossary                       # Add/update glossary term
GET    /api/settings/notifications         # Notification rules
PUT    /api/settings/notifications         # Update notification rules
GET    /api/settings/clustering            # Incident clustering thresholds
PUT    /api/settings/clustering            # Update clustering thresholds
GET    /api/settings/bot                   # Bot configuration
PUT    /api/settings/bot                   # Update bot configuration
```

---

## 8. Folder Structure (Monorepo)

```
/
├── apps/
│   ├── dashboard/                  # React frontend (Next.js or Vite)
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── tickets/        # Ticket queue, detail, resolution panel
│   │   │   │   ├── incidents/      # Incident list, detail, map, broadcast
│   │   │   │   ├── knowledge/      # KB manager, article editor, draft queue
│   │   │   │   ├── bot/            # Decision tree editor, bot stats
│   │   │   │   ├── agents/         # Agent directory, profiles
│   │   │   │   ├── analytics/      # Charts, metrics, coverage gaps
│   │   │   │   └── shared/         # Common UI components
│   │   │   ├── pages/              # Route-level views
│   │   │   ├── hooks/              # Custom React hooks
│   │   │   ├── services/           # API client functions
│   │   │   ├── stores/             # State management
│   │   │   └── types/              # TypeScript interfaces
│   │   └── package.json
│   │
│   └── api/                        # Backend API server (Node.js/Express or Fastify)
│       ├── src/
│       │   ├── routes/
│       │   │   ├── tickets.ts
│       │   │   ├── incidents.ts
│       │   │   ├── knowledge.ts
│       │   │   ├── bot.ts
│       │   │   ├── agents.ts
│       │   │   ├── analytics.ts
│       │   │   └── admin.ts
│       │   ├── services/
│       │   │   ├── ticket.ts
│       │   │   ├── incident.ts         # Clustering logic, incident lifecycle
│       │   │   ├── knowledge.ts        # KB indexer, similarity search, article management
│       │   │   ├── bot.ts              # Bot engine, decision tree runner, state machine
│       │   │   ├── translation.ts
│       │   │   ├── classification.ts
│       │   │   ├── embedding.ts        # Vector embedding generation
│       │   │   └── notification.ts
│       │   ├── workers/
│       │   │   ├── translate.ts
│       │   │   ├── classify.ts
│       │   │   ├── cluster.ts          # Incident clustering worker
│       │   │   ├── connectivity.ts     # Regional connectivity health monitoring
│       │   │   ├── kb-indexer.ts       # Resolved ticket → draft article
│       │   │   ├── kb-search.ts        # Similarity search on new tickets
│       │   │   ├── bot-handler.ts      # Inbound message → bot evaluation
│       │   │   ├── notify.ts
│       │   │   └── whatsapp-egress.ts
│       │   ├── models/                 # Database models / Prisma schema
│       │   ├── integrations/
│       │   │   ├── whatsapp.ts         # WhatsApp API client
│       │   │   ├── google-translate.ts
│       │   │   ├── llm.ts             # LLM client (classification + summarization)
│       │   │   ├── embedding.ts       # Embedding API client
│       │   │   └── slack.ts
│       │   ├── middleware/
│       │   └── types/
│       └── package.json
│
├── packages/
│   └── shared/                     # Shared types, constants, validation schemas
│
├── infra/                          # Terraform / Pulumi IaC
├── docker-compose.yml              # Local dev (includes pgvector, Redis)
└── package.json                    # Monorepo root (pnpm workspaces or turborepo)
```

---

## 9. Decision Log (Decisions to Make Before Starting)

These are forks where the team needs to commit before writing code:

1. **WhatsApp provider:** Meta Cloud API (free, self-managed) vs. a BSP like Twilio or MessageBird (costs per message, but simpler SDK and better support). Recommendation: start with Meta Cloud API to control costs at 1,000+ agents.
2. **Monorepo vs. polyrepo:** Monorepo with Turborepo is recommended for a small team shipping fast. Split later if team grows.
3. **Node.js vs. Python backend:** Node is recommended if the dashboard team and backend team overlap (one language). Python is better if the team has stronger Python skills or wants tighter ML/NLP integration later.
4. **LLM for classification + KB summarization:** Claude Haiku or GPT-4o-mini for cost-effective structured tasks. Model-agnostic interface so you can swap without code changes.
5. **Embedding model:** OpenAI text-embedding-3-small (cheap, good quality) vs. Cohere embed-english-v3.0 (slightly better multilingual). Either works; pick based on existing API relationships.
6. **Vector store:** pgvector (recommended — no new infrastructure) vs. Pinecone/Weaviate (more features but adds operational complexity). Start with pgvector; migrate only if search quality or performance demands it.
7. **Real-time strategy:** WebSocket from the API server (simpler) vs. a managed service like Ably or Pusher (more reliable at scale). Start with Socket.IO + Redis pub/sub; migrate if reliability becomes an issue.
8. **Bot rollout strategy:** All countries at once vs. phased by country. Recommendation: start with one country (likely DR — Spanish has the best translation and STT quality, and connectivity is more reliable), measure, tune, then expand.
9. **Connectivity monitoring granularity:** Per-branch vs. per-region health tracking. Per-branch gives more precision but requires enough message volume per branch to be statistically meaningful. Recommendation: start per-region (you have ~3–5 regions per country); drop to per-branch once you have 3+ months of baseline data.
10. **SLA auto-pause policy:** Automatic (system pauses SLAs when a region drops to "outage" status) vs. manual (ops team must approve the pause). Recommendation: automatic with a notification to the ops team, since connectivity outages in Haiti can happen at 2 AM US time and shouldn't breach SLAs while the team is asleep.
