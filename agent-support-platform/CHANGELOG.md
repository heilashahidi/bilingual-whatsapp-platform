# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
