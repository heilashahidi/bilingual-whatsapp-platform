# Nclusion Field Agent Support

A real-time support bridge from Nclusion connecting 1,000+ field agents across Haiti, Dominican Republic, and the Democratic Republic of Congo with a US-based operations and engineering team. Agents report issues through WhatsApp in their native language; the US team manages everything from an English-language web dashboard. Translation, classification, and routing happen transparently in between.

**Live deploys** on Railway:

| Service | URL |
|---|---|
| API | <https://nclusion-api.up.railway.app> |
| Dashboard | <https://nclusion-inbox-production.up.railway.app> |

## The Problem

Field agents encounter technical issues (app crashes, transaction failures, connectivity problems), have operational complaints, and surface feature requests — but there is no structured channel for these to reach the US team. Issues go unreported for days or weeks. When they do surface, it's through fragmented informal channels that make triage impossible.

## The Solution

Meet agents where they already are (WhatsApp) and give the US team a purpose-built dashboard. The platform automatically translates between Haitian Creole / French / Spanish and English, classifies and prioritizes every message, detects systemic incidents across regions, and builds a knowledge base from every resolved ticket.

## Key Features

- **WhatsApp ↔ Dashboard bridge** with transparent real-time translation
- **Five Claude Haiku surfaces:** translation, classification, AI-suggested reply drafts, incident summaries, and KB article drafts — see [AI_USAGE.md](agent-support-platform/docs/AI_USAGE.md)
- **Three-pane Inbox** (sidebar · conversation list · ticket drawer overlay) with @-mentions on internal notes. The drawer is a portaled modal with a frosted-glass panel and works from the inbox, kanban, and list views alike.
- **Automatic incident clustering** — detects when 3+ tickets in the same country and category arrive within 30 minutes; each cluster has a dedicated `/incidents/[id]` page with lifecycle controls (detected → confirmed → mitigating → resolved), editable root cause + resolution notes, and a contributing-tickets timeline
- **Nav badges** — rose badge next to "Incidents" counts active incidents; slate badge next to "Tickets" counts unresolved tickets. Both refresh on the `ticket:changed` Socket.IO event.
- **Knowledge base** that learns from every resolved ticket (kb-drafter → kb-indexer pipeline with mechanical fallback) and suggests fixes on new ones; `/knowledge` exposes draft / active / archived states with an Approve action that promotes drafts. A `scripts/seed-kb-articles.ts` seed exists for demos.
- **Bilingual toggle** in the page header — default off shows English only; on swaps to the original agent language (direction-aware: inbound originals, outbound translations).
- **Real-time updates** via Socket.IO — `ticket:changed` event on every mutation drives nav badges, open drawers, and conversation lists without refresh
- **Haiti / DRC connectivity awareness** — extended SLAs, delivery tracking, per-country message length caps for 2G networks. Country labels render as `HT` / `DO` / `CD` monospace chips (no flag emojis).
- **SLA tracking** with country-specific thresholds and per-ticket SLA rings

## Quick Start

### Prerequisites

- Node.js 20+, pnpm, Docker & Docker Compose
- [Twilio account](https://www.twilio.com/try-twilio) (free trial)
- [ngrok](https://ngrok.com/) for exposing the local webhook

### Setup (15 minutes)

All commands run from `agent-support-platform/` (the monorepo root).

```bash
cd agent-support-platform

# Install dependencies (pnpm workspaces)
pnpm install

# Start Postgres (pgvector) + Redis
docker compose up -d

# Configure environment
cp .env.example apps/api/.env
# Edit apps/api/.env with your Twilio + Anthropic credentials

# Initialize database
pnpm --filter @asp/api exec prisma migrate deploy
pnpm --filter @asp/api exec prisma db seed

# Start the API server (terminal 1)
pnpm --filter @asp/api dev

# Start the dashboard (terminal 2)
pnpm --filter @asp/dashboard dev

# Expose the API webhook (terminal 3)
ngrok http 3001
```

Paste the ngrok HTTPS URL into your [Twilio WhatsApp Sandbox config](https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn) as the webhook URL (with `/webhooks/whatsapp` appended), send a message from your phone, and watch the pipeline process it.

See [docs/CONTRIBUTING.md](agent-support-platform/docs/CONTRIBUTING.md) for the full development guide, [docs/DEPLOYMENT.md](agent-support-platform/docs/DEPLOYMENT.md) for production setup.

## Documentation

| Document | Description |
|---|---|
| [PRD](agent-support-platform/docs/PRD.md) | The original product requirements |
| [Tech Stack](agent-support-platform/docs/TECH_STACK.md) | Every technology choice and why |
| [Architecture](agent-support-platform/docs/ARCHITECTURE.md) | System diagram, message flow, component breakdown |
| [API Reference](agent-support-platform/docs/API.md) | All endpoints with request/response examples |
| [Data Model](agent-support-platform/docs/DATA_MODEL.md) | Database schema, relationships, field descriptions |
| [Deployment](agent-support-platform/docs/DEPLOYMENT.md) | Fly + Railway setup, secrets, CI/CD |
| [Performance](agent-support-platform/docs/PERFORMANCE.md) | Measured benchmarks against the six PRD metrics |
| [AI Usage](agent-support-platform/docs/AI_USAGE.md) | All five Claude integrations with prompts + data flow |
| [Translation](agent-support-platform/docs/TRANSLATION.md) | Translation pipeline, glossary management, language support |
| [Connectivity](agent-support-platform/docs/CONNECTIVITY.md) | Haiti/DRC latency handling and resilience design |
| [Runbooks](agent-support-platform/docs/RUNBOOKS.md) | Operational playbooks for incidents and common issues |
| [Contributing](agent-support-platform/docs/CONTRIBUTING.md) | Dev setup, coding standards, PR process |
| [Changelog](agent-support-platform/CHANGELOG.md) | Version history |

## Project Structure

```
agent-support-platform/
├── apps/
│   ├── api/                    # Express + Prisma + Socket.IO API
│   │   ├── src/
│   │   │   ├── routes/         # HTTP endpoints (webhooks, tickets, incidents, knowledge, agents)
│   │   │   ├── services/       # Business logic (pipeline, clusterer, summarizer, drafter, audit)
│   │   │   ├── integrations/   # External services (Twilio, Claude translation/classification)
│   │   │   └── middleware/     # auth (NextAuth JWT verify, requireRole)
│   │   └── prisma/             # Schema and migrations
│   └── dashboard/              # Next.js 14 App Router frontend
│       └── app/
│           ├── tickets/        # Inbox + kanban + list views; ticket drawer (?ticket=id) overlays on all
│           ├── incidents/      # /incidents list + /incidents/[id] detail (lifecycle + timeline)
│           ├── knowledge/      # KB article approval workflow (draft / active / archived)
│           └── signin/         # NextAuth + Google OAuth
├── packages/
│   └── shared/                 # Shared TS types, constants, SLA configs
├── docs/                       # 12 docs files covering PRD compliance
├── scripts/                    # Auth + Slack setup, KB + demo ticket seed scripts
└── railway.api.json + railway.dashboard.json   # Railway deploy configs
```

## Testing

```bash
cd agent-support-platform/apps/api
npx vitest run --config vitest.config.ts
```

124 tests across 13 files covering: the inbound message pipeline, all five
Claude integrations, incident clustering, KB scoring, webhook signature
validation, role guards, HTTP-level route contracts, and the Prisma
retry helper (Neon auto-suspend recovery).

## License

Proprietary. All rights reserved.
