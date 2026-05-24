# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-05-23

End-to-end latency resilience for field agents on slow third-world mobile networks. Focused on shaving server-side latency *and* on never silently losing a message when a flaky Twilio/WhatsApp leg fails.

### Changed
- **BREAKING — `POST /api/tickets/:id/messages` response shape.** Top-level `translatedText` removed; response is now `{ message }` only. Translation now happens on the outbound worker after the response returns, so the field isn't known at request time. The dashboard's `sendResponse` and any external consumers must read `translatedText` (and `deliveryStatus`) off the message that arrives via the `ticket:changed` socket event instead. See [API.md](docs/API.md#post-apiticketsidmessages).
- **Inbound pipeline reorder.** `processInboundMessage` now: find/create ticket (with placeholder category if new) → store raw message → emit `ticket:changed` → translate + classify in parallel → patch message + reconcile category/severity → emit `ticket:changed` again. Dashboard-visible latency after a webhook drops from ~500 ms to ~50–100 ms. New tickets briefly appear as `other` / `medium` before settling.
- **Composer post-send UX.** The "Sent. Translated as: …" preview is gone (the translation isn't known yet at send-time); replaced with a "Queued — status in conversation" chip. The translated text and delivery status surface on the message bubble itself in the timeline.

### Added

#### Outbound queue + delivery status
- **`apps/api/src/services/outbound-queue.ts`, `outbound-pipeline.ts`, `outbound-worker.ts`** — new BullMQ queue `outbound-whatsapp` mirroring the inbound pattern: 3 retries, exponential backoff (2 s → 4 s → 8 s), concurrency 4, inline fallback if Redis is unhealthy.
- **`POST /api/tickets/:id/messages`** and **`POST /api/tickets/outreach`** create the Message row with `deliveryStatus: 'pending'` and enqueue; the worker translates + sends + patches the row. Dashboard ack drops from ~600–800 ms to ~50 ms. The auto-intake send in `message-pipeline.ts` routes through the same queue.
- **Schema (`Message.deliveryStatus`, `Message.deliveryError`)** — new `DeliveryStatus` enum (`pending`, `sent`, `delivered`, `read`, `failed`). Existing rows default to `sent`. Composite index `(deliveryStatus, createdAt)` for retry sweeping. Migration `20260523120000_add_delivery_status`.
- **Delivery-state chips in the timeline** — `MessageBubble` renders a pulsing "sending" chip while pending, a red "✗ failed" chip on terminal failure (with the truncated `deliveryError` in the tooltip), and the existing `✓` / `✓✓` ticks once Twilio's status webhook fires.

#### Translation cache
- **In-memory LRU** in `apps/api/src/integrations/translation.ts` — 1000-entry cap, 24 h TTL, key shape `target::text`. Wraps both `translateMessage` and `translateResponse`. Cache hits skip the Claude Haiku call entirely (~300–500 ms → ~0 ms). Only confident results (`confidence >= 0.7`) are cached so stub fallbacks don't poison lookups. Per-process; survives a worker but not a deploy.

#### Twilio resilience
- **10 s timeout** on `client.messages.create` (`apps/api/src/integrations/whatsapp.ts`) using a `Promise.race` against a tracked timer. Replaces Node's default ~2-min TCP timeout, which would burn a worker slot on a stalled Twilio carrier hop.

---

## [0.3.0] - 2026-05-23

### Changed
- **Rebrand to "Nclusion Field Agent Support".** Dashboard chrome, `<title>`, signin page, and all docs now use the Nclusion brand. Folder names (`agent-support-platform/`, `@asp/*` packages) are unchanged; only user-facing labels and prose moved.

### Added

#### Incident detail page
- New `/incidents/[id]` route (`apps/dashboard/app/incidents/[id]/`) with lifecycle controls (detected → confirmed → mitigating → resolved), editable root cause and resolution notes, and a contributing-tickets timeline. Updates route through `PATCH /api/incidents/:id` (restricted to admin / operations / engineering).

#### Knowledge base pipeline
- **`apps/api/src/services/kb-drafter.ts`** — Claude Haiku auto-drafts KB articles from resolved tickets (`{ title, problemDescription, resolutionText, resolutionTextShort, tags }`).
- **`apps/api/src/services/kb-indexer.ts`** — wraps kb-drafter with a mechanical fallback so a draft always lands even when Claude is unavailable.
- **`scripts/seed-kb-articles.ts`** — idempotent demo seed (~7 articles, mix of `active` and `draft`) for populating `/knowledge` during demos.
- **Knowledge tab** (`/knowledge`) surfaces articles with status (draft / active / archived); Approve promotes a draft to active.

#### Incident clusterer
- **`apps/api/src/services/incident-clusterer.ts`** — auto-groups ≥3 tickets in the same country + category within 30 min into a single incident; subsequent matching tickets within the active window join the existing incident instead of spawning a new one. Incident summaries are rewritten by Claude Haiku as a fire-and-forget pass.

#### Dashboard
- **Nav badges:** rose badge next to "Incidents" (count of `detected`/`confirmed`); slate badge next to "Tickets" (count of `open` / `in_progress` / `waiting_on_agent`). Both refetch on `ticket:changed` plus a 90 s safety poll.
- **Page header status breakdown** on `/tickets` — `12 open · 3 in progress · 1 waiting · 7 resolved` instead of a vanity total. Closed is excluded.
- **Ticket drawer overlay:** drawer mounts in all three views (inbox / kanban / list), portaled to `document.body` with a transparent scrim and frosted-glass panel (`bg-white/85 backdrop-blur-xl`). DetailPane in the inbox view is now a placeholder.
- **Cluster-closed banner:** when `?incident=X` is set and every ticket in the cluster is closed, a banner shows a "Show closed tickets" link that adds `?closed=1`.
- **Bilingual toggle semantics:** default is English-only (off). On swaps to the original agent language (inbound originals, outbound translatedText which is the agent-language version).
- **Country labels:** flag emojis removed across the board; HT / DO / CD render as monospace chips on triage surfaces and as full country names on incident detail.
- **Deploy verification:** `<meta name="x-app-build">` tag in `layout.tsx`, bumped each deploy as a sanity check that Railway rebuilt the image.

#### Realtime + infra
- **Socket.IO `ticket:changed`** event now drives nav badges, open drawer refetch, and conversation-list `router.refresh()`. Emitted on every ticket mutation.
- **Defensive Redis:** BullMQ falls back to inline processing if Upstash Redis is unreachable; tracked via ioredis events so the worker never deadlocks during an outage.
- **`withPrismaRetry`** wrapper around Prisma calls absorbs Neon's auto-suspend cold start (single retry after 1.5 s).

#### Auth
- **NextAuth + Google OAuth** on the dashboard; the API verifies an HS256-signed JWT using the shared `NEXTAUTH_SECRET`.

---

## [0.2.0] - 2026-05-21

### Added

#### Dashboard (Next.js 14 + Tailwind)
- **Ticket queue** as a kanban board (`Open / In progress / Waiting on agent / Resolved`) with per-column counts. `closed` tickets are hidden from the board but surfaced in the page header total.
- **Drag-and-drop** between columns (`@dnd-kit/core`) with optimistic UI and automatic revert on API failure. 8 px activation distance preserves click-to-navigate.
- **Live SLA timers** on every card and in the detail sidebar — tick every second, color shifts slate → amber (<4 h) → red (<30 min) → red bold (overdue).
- **Ticket detail page** with: auto-generated header from the first agent message, short ID, severity + status pills, green "Resolved" banner with resolution-summary inline.
- **Conversation thread** with bilingual message bubbles (English primary, original language secondary), translation-confidence warning chip, and **WhatsApp-style delivery ticks** on outbound messages (`✓` sent → `✓✓` delivered → `✓✓` blue read).
- **Response composer** that translates English → agent's language and sends through Twilio, with ⌘/Ctrl+Enter shortcut and inline translated-text preview after send.
- **Internal notes panel** (amber-styled, team-only) between the conversation and the response composer.
- **Ticket actions sidebar** with dropdowns for status, severity, category, assignee, plus a resolve flow with optional resolution summary that feeds the future KB indexer.
- **Toast notifications** for new tickets, bottom-right, severity-tinted, with click-through to the detail page.
- **Suggested resolutions, bot interaction, agent profile, tags, SLA** cards in the sidebar (most read from existing fields; KB/bot panels surface when data arrives).

#### API
- **Socket.IO realtime** layer — `ticket:changed` events broadcast on every mutation (created / updated / message). Dashboard subscribes globally and via `useRouter().refresh()`.
- **Routes added**: `POST /api/tickets/:id/notes`, `GET /api/users`.
- **Routes updated**: `GET /api/tickets/:id` now includes notes and suggested resolutions; `POST /api/tickets/:id/messages` emits realtime events; `PATCH` and `/resolve` emit realtime events.
- **`POST /webhooks/whatsapp/status`** now actually writes `deliveredAt` / `readAt` to `Message` (previously a TODO).
- **Real Claude Haiku classification** path verified end-to-end (gated by `USE_REAL_CLASSIFICATION=true` + `ANTHROPIC_API_KEY`).

#### Schema
- **`Note` model** for internal team-only commentary; FK to `Ticket`, optional FK to `InternalUser` author. Migration `20260521214609_add_notes`.
- **`Message.whatsappMessageId`** is now `@unique` — prevents duplicate-message race when Twilio retries. Idempotency lookup uses `findUnique`.
- **Performance indexes** added (all were documented in `DATA_MODEL.md` but never created):
  - `Ticket(agentId, status, createdAt)` — used by the open-ticket lookup per agent
  - `Ticket(severity, slaFirstResponseDeadline)` — dashboard queue sort
  - `Ticket(category, createdAt)` — for future clustering
  - `Message(ticketId, createdAt)` — conversation thread
  - `Message(agentTimestamp)` — Haiti/DRC timeline reconstruction
  - `ConnectivityLog(country, region, windowEnd)`
- Migration `20260521220924_add_indexes_and_unique_whatsapp_id`.

#### Twilio integration (real path)
- **Country fallback** for phone numbers without HT/DR/DRC prefixes — uses `TEST_AGENT_COUNTRY` env (defaults to `HT`) so US sandbox numbers don't crash auto-registration on the `Country` enum.
- **Static imports** of `@asp/shared` and `./translation` in `whatsapp.ts` (dynamic imports failed in tsx's ESM resolver).
- **Translation stub** no longer prefixes outbound messages with `[en→ht]`; the prefix made the development mode visible to agents.

### Changed
- `WEBHOOK_BASE_URL` and `TEST_AGENT_COUNTRY` documented in `.env.example`.
- `apps/dashboard/.gitignore` excludes `tsconfig.tsbuildinfo`.
- `turbo.json` build outputs include `.next/**` (excluding `.next/cache/**`).
- Removed `prisma/migrations/` from `.gitignore` (migrations must be source-controlled).

### Not Yet Implemented
Carried from 0.1.0; the dashboard surfaces empty/disabled states for these wherever applicable:
- Incident clustering worker (model exists)
- Knowledge base similarity search + draft article indexer (model exists)
- WhatsApp self-service bot engine + decision-tree runner (models exist)
- Connectivity health monitoring worker (table exists)
- Slack / PagerDuty notification dispatcher
- Real Google Translation (code path exists, package not installed)
- Voice note speech-to-text
- Media download + S3 storage + outbound compression for HT/DRC
- Analytics endpoints (`/api/analytics/*`)
- Glossary management (`/api/glossary`)
- Authentication & RBAC

---

## [0.1.0] - 2026-05-21

### Added

- **Project scaffold** — monorepo with Turborepo, pnpm workspaces, Docker Compose.
- **Twilio WhatsApp webhook** — receives inbound messages and delivery status updates.
- **Message normalizer** — converts Twilio payload to provider-agnostic `RawMessage` envelope.
- **Translation pipeline** — Google Cloud Translation integration with development stub. Supports Haitian Creole, French, Spanish ↔ English.
- **Classification pipeline** — Claude Haiku integration with development stub. Classifies into category, severity, tags, product area. Includes Haiti/DRC `likelyNetwork` flag.
- **Ticket management** — automatic ticket creation/appending, SLA computation with extended windows for Haiti/DRC.
- **Outbound response flow** — translate English response to agent's language, enforce Haiti/DRC message length limits, send via Twilio.
- **Delivery tracking** — WhatsApp delivery receipt webhook, dual-timestamp design for connectivity monitoring.
- **Full Prisma schema** — Agent, Branch, Ticket, Message, Incident, KnowledgeArticle, BotConversation, DecisionTree, ConnectivityLog.
- **Database seed** — test branches across 3 countries, test agents, internal users.
- **Shared configuration** — SLA configs per country, bot session TTLs, connectivity thresholds, clustering windows.
- **Documentation** — README, Tech Stack, Architecture, API Reference, Data Model, Deployment, Contributing, Connectivity, Translation, Runbooks.

### Not Yet Implemented

- Dashboard frontend
- WebSocket real-time updates
- Incident clustering worker
- WhatsApp self-service bot
- Knowledge base similarity search (pgvector)
- Notification system (Slack/PagerDuty)
- Connectivity health monitoring worker
- Analytics endpoints
- Authentication and RBAC
