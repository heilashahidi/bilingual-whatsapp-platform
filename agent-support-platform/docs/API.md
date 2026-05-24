# API Reference

Base URL: `http://localhost:3001` (development) / `https://nclusion-api.up.railway.app` (production)

All endpoints return JSON. Authentication is via a NextAuth-signed Bearer JWT (HS256, shared `NEXTAUTH_SECRET`) in the `Authorization` header. Webhook endpoints use Twilio's request signature instead. Mutating routes layer `requireRole(...)` on top — see each endpoint for which roles are accepted.

## Webhooks (External)

These endpoints receive data from external services. They do not require JWT authentication but use provider-specific signature validation.

### POST /webhooks/whatsapp

Receives inbound WhatsApp messages from Twilio. Configured as the webhook URL in the Twilio WhatsApp Sandbox (or production) settings.

**Authentication:** Twilio request signature validation via `x-twilio-signature` header.

**Payload:** Twilio sends form-encoded (`application/x-www-form-urlencoded`) data:

```
MessageSid=SM1234567890abcdef&From=whatsapp%3A%2B50937001001&To=whatsapp%3A%2B14155238886&Body=App+crashed+again&NumMedia=0&ProfileName=Jean-Baptiste
```

**Key fields:**

| Field | Description |
|---|---|
| `MessageSid` | Unique Twilio message ID (used for idempotency) |
| `From` | Agent's WhatsApp number in `whatsapp:+509XXXXXXXX` format |
| `Body` | Message text content |
| `NumMedia` | Number of media attachments |
| `MediaUrl0` | URL of first media attachment (if any) |
| `MediaContentType0` | MIME type of first attachment |
| `ProfileName` | Agent's WhatsApp display name |

**Response:** Always returns `200` with `<Response></Response>` immediately. Processing is asynchronous.

**What happens next:** The message flows through the pipeline: normalize → find/create ticket → store raw message → emit `ticket:changed` (dashboard wakes up here, ~50–100 ms after webhook) → translate + classify in parallel → patch message + reconcile category → emit `ticket:changed` again. See [Architecture](ARCHITECTURE.md) for the full flow.

### POST /webhooks/whatsapp/status

Receives delivery status updates from Twilio for outbound messages. Updates the matching `Message.deliveryStatus` column (and `deliveredAt` / `readAt` timestamps) so the dashboard's delivery-state chip converges with real-world delivery.

**Payload fields:**

| Field | Description |
|---|---|
| `MessageSid` | Twilio message ID — matched against `Message.whatsappMessageId` |
| `MessageStatus` | One of: `queued`, `sent`, `delivered`, `read`, `failed`, `undelivered`. Maps to `Message.deliveryStatus` (with `undelivered` collapsing to `failed`) |
| `To` | Recipient phone number |
| `ErrorCode` | Error code if `failed` or `undelivered` — stored in `Message.deliveryError` |

**Response:** Always `200`.

## Tickets

### GET /api/tickets

List tickets with filtering, sorting, and pagination.

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `status` | string | — | Filter: `open`, `in_progress`, `waiting_on_agent`, `resolved`, `closed` |
| `severity` | string | — | Filter: `critical`, `high`, `medium`, `low` |
| `category` | string | — | Filter: `bug_report`, `operational_complaint`, `feature_request`, `question`, `other` |
| `country` | string | — | Filter by agent's country: `HT`, `DO`, `CD` |
| `assignedTo` | string | — | Filter by assigned internal user ID |
| `limit` | number | 50 | Results per page. Must be an integer in `[1, 200]` — returns 400 otherwise. |
| `offset` | number | 0 | Pagination offset. Must be a non-negative integer — returns 400 otherwise. |

**Response:**
```json
{
  "tickets": [
    {
      "id": "uuid",
      "status": "open",
      "category": "bug_report",
      "severity": "high",
      "productArea": "mobile_app",
      "tags": ["app_crash", "transaction_failure"],
      "agentReportedAt": "2026-05-21T14:30:00Z",
      "slaFirstResponseDeadline": "2026-05-21T20:30:00Z",
      "createdAt": "2026-05-21T14:32:00Z",
      "agent": {
        "id": "uuid",
        "name": "Jean-Baptiste Pierre",
        "phoneNumber": "+50937001001",
        "country": "HT",
        "connectivityStatus": "online",
        "branch": {
          "name": "Port-au-Prince Central",
          "region": "ouest"
        }
      },
      "messages": [
        {
          "translatedText": "The app keeps crashing when I try to send money",
          "deliveryStatus": "sent",
          "deliveryError": null,
          "createdAt": "2026-05-21T14:30:00Z"
        }
      ],
      "incident": null
    }
  ],
  "total": 142
}
```

Default sort: severity ascending (critical first), then SLA deadline ascending (nearest deadline first).

### GET /api/tickets/:id

Full ticket detail including all messages, suggested resolutions, and bot conversation history.

**Response:** Same as list item but with full `messages` array (all messages, not just most recent), `suggestedResolutions` array, and `botConversation` object if applicable.

### POST /api/tickets/:id/messages

Send a response from the US team to the agent. **The send is queued, not awaited** — translation + Twilio handoff happen on the outbound BullMQ worker so the dashboard returns in ~50 ms instead of ~600–800 ms. The dashboard renders the pending message immediately and converges via `ticket:changed` once the worker finishes.

**Request body:**
```json
{
  "text": "We're looking into the crash. Can you try clearing the app cache and reopening?"
}
```

`senderId` is derived from the authenticated session — values in the body are ignored.

**What happens:**
1. The Message row is persisted with `deliveryStatus: "pending"` and `translatedText` pre-filled with the English text so the timeline has something to render.
2. Ticket status flips to `waiting_on_agent`, audit event is recorded, `ticket:changed` is emitted.
3. The send is enqueued on the `outbound-whatsapp` BullMQ queue (3 retries with exponential backoff; falls back to inline send if Redis is unhealthy).
4. The outbound worker translates (cached), enforces per-country length caps (HT/DR 1,000 / 2,000 chars), calls Twilio (10 s timeout), and patches the row to `deliveryStatus: "sent"` with the Twilio SID. On terminal failure it sets `deliveryStatus: "failed"` and writes a truncated reason to `deliveryError`.

**Breaking change in 0.4.0:** The response no longer includes a top-level `translatedText` field — translation runs on the worker after the response returns.

**Response:**
```json
{
  "message": {
    "id": "uuid",
    "direction": "outbound",
    "originalText": "We're looking into the crash...",
    "translatedText": "We're looking into the crash...",
    "deliveryStatus": "pending",
    "deliveryError": null,
    "whatsappMessageId": null,
    "createdAt": "2026-05-23T12:00:00Z"
  }
}
```

### PATCH /api/tickets/:id

Update ticket metadata.

**Request body (all fields optional):**
```json
{
  "status": "in_progress",
  "severity": "critical",
  "category": "bug_report",
  "assignedTo": "internal-user-uuid",
  "tags": ["app_crash", "payments"],
  "incidentId": "incident-uuid"
}
```

### POST /api/tickets/:id/resolve

Resolve a ticket with an optional resolution summary. The summary feeds the knowledge base indexer.

**Request body:**
```json
{
  "resolutionSummary": "Agent's app cache was corrupted after the v2.3 update. Clearing cache and restarting resolved the issue. Engineering is investigating the root cause in the update installer."
}
```

### POST /api/tickets/:id/notes

Add an internal note visible only to the US team (not sent to the agent). Supports `@-mention` syntax — IDs in `mentions` are extracted from the body and stored alongside the note.

**Request body:**
```json
{
  "text": "@alice This looks similar to the cache corruption issue from last week. Checking if it's the same root cause.",
  "authorId": "internal-user-uuid",
  "mentions": ["internal-user-uuid-alice"]
}
```

### POST /api/tickets/:id/suggest-replies

Returns three Claude Haiku-drafted reply candidates (direct / empathetic / investigative) for the operator to pick from. Returns `200` with an empty list if Claude is unavailable so the dashboard hides the panel rather than breaking. See `docs/AI_USAGE.md §2.3`.

### POST /api/tickets/outreach

Operator-initiated outbound message to an agent who has no open ticket (or no prior conversation). Creates the ticket + first message row (with `deliveryStatus: "pending"`) and enqueues the WhatsApp send on the same `outbound-whatsapp` BullMQ queue as `POST /:id/messages`. The response returns the ticket immediately; the embedded first message converges to `sent` (or `failed`) once the worker drains.

### DELETE /api/tickets/:id

Soft-delete a ticket (admin only). Hides the ticket from list/board surfaces; retained for audit.

## Incidents

### GET /api/incidents

List incidents. Default: active incidents sorted by severity and ticket count.

**Query parameters:** `status`, `severity`, `country`, `limit`, `offset`

### GET /api/incidents/:id

Incident detail with linked tickets, timeline, and affected branches.

### POST /api/incidents

Manually create an incident.

**Request body:**
```json
{
  "title": "App crash on startup — Port-au-Prince region",
  "severity": "critical",
  "category": "bug_report",
  "productArea": "mobile_app",
  "ticketIds": ["uuid1", "uuid2", "uuid3"]
}
```

### PATCH /api/incidents/:id

Update incident status, link/unlink tickets, add root cause notes.

**Request body (all fields optional):**
```json
{
  "status": "mitigating",
  "rootCause": "Database migration failed on v2.3 deploy, corrupting local cache on app startup",
  "ticketIds": ["uuid1", "uuid2", "uuid3", "uuid4"],
  "isNetworkRelated": false
}
```

### POST /api/incidents/:id/broadcast · POST /api/incidents/:id/resolve · POST /api/incidents/:id/to-article

Planned but not yet implemented. Lifecycle transitions today go through `PATCH /api/incidents/:id` with `{ status: "resolved" }` (which stamps `resolvedAt`). Broadcasting to all linked agents means responding ticket-by-ticket. The post-mortem-to-KB shortcut piggybacks on the same kb-drafter pipeline that runs on ticket resolution.

## Knowledge Base

### GET /api/knowledge

List knowledge articles with search and filters.

**Query parameters:** `status` (`draft`, `active`, `archived`), `category`, `search` (text search), `limit`, `offset`

### GET /api/knowledge/drafts

Auto-generated draft articles awaiting human review.

### GET /api/knowledge/search

Similarity search. Used internally by the bot and dashboard.

**Query parameters:**

| Param | Type | Description |
|---|---|---|
| `query` | string | Text to search against (English) |
| `threshold` | number | Minimum similarity score (0–1). Default: 0.6 for dashboard, 0.85 for bot |
| `limit` | number | Max results. Default: 5 |

### POST /api/knowledge/:id/approve

Move a draft article to active status. Restricted to `admin`, `support`, `operations`. Drafts are created by the `kb-drafter` Claude pipeline (with the `kb-indexer` mechanical fallback) whenever a ticket resolves with a non-empty `resolutionSummary`.

### POST /api/knowledge/:id/archive

Archive an article. Removes it from active suggestions. Same role restrictions as approve.

## Bot

> Not yet implemented. The data model exists (`BotConversation`, `DecisionTree`) but no routes are wired up. Inbound messages flow straight to the ticket pipeline today.

### GET /api/bot/decision-trees

List all decision trees.

### POST /api/bot/decision-trees

Create a new decision tree.

**Request body:**
```json
{
  "title": "App Crash Recovery",
  "category": "bug_report",
  "productArea": "mobile_app",
  "steps": {
    "root": {
      "message": "I see you're having an app issue. Let's try to fix it.",
      "options": [
        { "label": "App crashed", "next": "clear_cache" },
        { "label": "App won't open", "next": "force_close" },
        { "label": "Something else", "next": "escalate" }
      ]
    },
    "clear_cache": {
      "message": "Try this: Go to Settings → Apps → [App Name] → Clear Cache. Then reopen the app. Did that fix it?",
      "options": [
        { "label": "Yes, fixed!", "next": "resolved" },
        { "label": "No, still broken", "next": "escalate" }
      ]
    },
    "force_close": {
      "message": "Force close the app: swipe it away from your recent apps, wait 10 seconds, then reopen. Did that work?",
      "options": [
        { "label": "Yes, fixed!", "next": "resolved" },
        { "label": "No", "next": "clear_cache" }
      ]
    },
    "resolved": { "message": "Great! Glad that worked. Let us know if it happens again.", "terminal": true },
    "escalate": { "message": "Let me connect you with the support team.", "terminal": true, "escalate": true }
  }
}
```

### GET /api/bot/stats

Bot performance metrics: resolution rate, deflection rate by issue type, escalation reasons.

## Agents

### GET /api/agents

List agents with search and filtering.

**Query parameters:** `country`, `search` (name or phone), `limit`, `offset`

### GET /api/agents/:id

Agent profile with ticket history, bot conversation history, and connectivity status.

## Users

### GET /api/users

List internal users. Used by the ticket drawer's assignee dropdown and the `@-mention` autocomplete. Lightweight `{ id, name, email, role }` shape.

## Analytics

> Not yet implemented. The endpoints below are reserved for future work; nothing under `/api/analytics/*` exists in the shipped API today.

### GET /api/analytics/volume

Ticket volume time series, sliceable by country, category, severity.

**Query parameters:** `from` (ISO date), `to` (ISO date), `groupBy` (`day`, `week`, `month`), `country`, `category`

### GET /api/analytics/resolution

Resolution time statistics by category and severity.

### GET /api/analytics/sla

SLA compliance rates, broken down by country (standard vs extended SLAs).

### GET /api/analytics/bot

Bot deflection and resolution metrics.

### GET /api/analytics/incidents

Incident frequency, detection time, resolution time.

### GET /api/analytics/connectivity

Regional connectivity health, delivery delays, outage history. Haiti/DRC specific.

### GET /api/analytics/knowledge-gaps

Ticket categories with high volume but no matching knowledge base articles.

## Admin

> Not yet implemented. Notification routes (Slack), clustering windows, bot config, and the translation glossary are configured via env vars and code constants today (see `packages/shared/src/index.ts`).

### GET/PUT /api/settings/notifications

Notification routing rules.

### GET/PUT /api/settings/clustering

Incident clustering thresholds per country.

### GET/PUT /api/settings/bot

Bot configuration (enable/disable per country, confidence thresholds, session TTL).

### GET/POST /api/glossary

Translation glossary management. Add or update domain-specific term translations.
