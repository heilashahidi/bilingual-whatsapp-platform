# Contributing Guide

## Development Setup

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | 20+ | [nodejs.org](https://nodejs.org) |
| pnpm | 9+ | `npm install -g pnpm` |
| Docker | 24+ | [docker.com](https://www.docker.com) |
| ngrok | latest | [ngrok.com](https://ngrok.com) |

### First-Time Setup

```bash
# 1. Clone the repo
git clone <repo-url>
cd bilingual-whatsapp-platform/agent-support-platform

# 2. Install dependencies
pnpm install

# 3. Start infrastructure
docker compose up -d
# Verify: docker compose ps (should show postgres and redis as "running")

# 4. Configure environment
cp .env.example apps/api/.env
# Edit apps/api/.env with your Twilio + Anthropic credentials

# 5. Initialize database
pnpm --filter @asp/api exec prisma migrate deploy
pnpm --filter @asp/api exec prisma db seed

# 6. Start the API + dashboard (two terminals)
pnpm --filter @asp/api dev          # API on :3001
pnpm --filter @asp/dashboard dev    # Dashboard on :3000

# 7. (Optional) Configure NextAuth + Google sign-in locally
./scripts/set-auth-secrets.sh

# 8. Expose for WhatsApp webhooks (separate terminal)
ngrok http 3001
# Copy the https URL and paste it into Twilio Sandbox settings
```

### Daily Development

```bash
docker compose up -d                # Start Postgres + Redis (if not running)
pnpm --filter @asp/api dev          # API with hot reload
pnpm --filter @asp/dashboard dev    # Dashboard with hot reload
```

### Useful Commands

```bash
# Database
npx prisma studio                    # Visual database browser (localhost:5555)
npx prisma migrate dev --name <name> # Create a new migration
npx prisma generate                  # Regenerate Prisma client after schema changes
npx prisma db seed                   # Re-seed test data

# Testing
curl http://localhost:3001/health     # Health check
curl http://localhost:3001/api/tickets | jq  # List tickets
curl http://localhost:3001/api/agents | jq   # List agents

# Docker
docker compose logs postgres -f      # Postgres logs
docker compose logs redis -f         # Redis logs
docker compose down                  # Stop infrastructure
docker compose down -v               # Stop and delete all data
```

## Project Structure

```
agent-support-platform/
├── apps/
│   ├── api/                          # Backend API server (Express + Socket.IO + Prisma)
│   │   ├── src/
│   │   │   ├── routes/               # Express route handlers
│   │   │   │   ├── webhooks.ts       # Twilio WhatsApp webhook (signature-verified)
│   │   │   │   ├── tickets.ts        # Ticket CRUD, notes, messages, resolve, suggest-replies
│   │   │   │   ├── incidents.ts      # Incident list / detail / PATCH lifecycle
│   │   │   │   ├── knowledge.ts      # KB list / approve / archive
│   │   │   │   ├── agents.ts         # Agent directory
│   │   │   │   └── users.ts          # Internal user list (for assignee + @-mention)
│   │   │   ├── services/             # Core business logic
│   │   │   │   ├── database.ts             # Prisma + withPrismaRetry (Neon warmup)
│   │   │   │   ├── message-normalizer.ts   # Twilio → RawMessage adapter
│   │   │   │   ├── message-pipeline.ts     # Inbound processing pipeline
│   │   │   │   ├── incident-clusterer.ts   # 30-min country+category clustering
│   │   │   │   ├── incident-summarizer.ts  # Claude rewrites incident title + root cause
│   │   │   │   ├── kb-drafter.ts           # Claude drafts KB articles from resolved tickets
│   │   │   │   ├── kb-indexer.ts           # Wraps kb-drafter with mechanical fallback
│   │   │   │   ├── kb-search.ts            # Category+tag overlap scoring (no embeddings yet)
│   │   │   │   ├── language-detection.ts   # isLikelyEnglish heuristic (skip LLM fast path)
│   │   │   │   ├── reply-suggester.ts      # Three Claude-drafted reply candidates
│   │   │   │   ├── realtime.ts             # Socket.IO server + emitTicketEvent
│   │   │   │   ├── queue.ts + queue-worker.ts # BullMQ + Upstash, inline fallback
│   │   │   │   ├── audit.ts                # Event log writer
│   │   │   │   └── notifier.ts             # Slack webhook fan-out
│   │   │   ├── integrations/         # External service clients
│   │   │   │   ├── whatsapp.ts       # Twilio send (outbound)
│   │   │   │   ├── translation.ts    # Claude Haiku translate (+ dev stub)
│   │   │   │   └── classification.ts # Claude Haiku classify (+ dev stub)
│   │   │   └── middleware/
│   │   │       └── auth.ts           # NextAuth JWT verify (HS256), requireRole
│   │   └── prisma/
│   │       ├── schema.prisma         # Database schema
│   │       ├── migrations/           # Six migrations including notes, indexes, events
│   │       └── seed.ts               # Test data
│   └── dashboard/                    # Next.js 14 App Router frontend
│       └── app/
│           ├── tickets/              # Inbox / kanban / list views + ticket drawer overlay
│           ├── incidents/            # /incidents list + /incidents/[id] detail
│           ├── knowledge/            # KB approval workflow
│           ├── signin/               # NextAuth + Google OAuth
│           └── _components/          # Nav badges, toasts, realtime indicator, keyboard shortcuts
├── packages/
│   └── shared/                       # Shared types, SLA config, constants
├── scripts/                          # set-auth-secrets.sh, set-slack-webhook.sh, seed-kb-articles.ts, seed-demo-tickets.ts
├── docs/                             # Documentation
├── railway.api.json + railway.dashboard.json   # Railway deploy configs
└── docker-compose.yml                # Local Postgres (pgvector) + Redis
```

## Coding Standards

### TypeScript

- Strict mode enabled. No `any` types unless absolutely necessary (and explain why in a comment).
- Use interfaces over type aliases for object shapes.
- Async/await over raw Promises.
- Destructure function parameters when there are 3+ fields.

### Naming

- Files: `kebab-case.ts` (e.g., `message-pipeline.ts`)
- Variables and functions: `camelCase`
- Types and interfaces: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- Database columns in Prisma: `camelCase` (Prisma maps to snake_case in SQL)

### Error Handling

- Every external API call (Twilio, Google Translate, Claude, WhatsApp) must be wrapped in try/catch.
- Failed external calls should log the error and fall back gracefully rather than crashing the pipeline.
- The webhook handler always returns 200 to Twilio regardless of processing outcome.

### Comments

- Explain *why*, not *what*. The code shows what it does; comments explain the decision.
- Every integration file should have a header comment explaining what it connects to, what the dev stub does, and how to switch to production.
- Every pipeline step should log what it did (use the `console.log("  ✓ ...")` pattern for pipeline steps).

### Haiti/DRC Awareness

When writing any code that deals with timing, message delivery, or agent communication, ask yourself: "What happens when the agent is on a 2G connection in rural Haiti?" Specifically:

- Always use `agentTimestamp` (not `serverReceivedAt`) for any user-facing time or SLA computation.
- Never assume a message was delivered. Check delivery receipts.
- Keep outbound messages short. Use `BOT_MAX_MESSAGE_LENGTH` from shared config.
- Don't send media to Haiti/DRC agents in automated flows.

## Git Workflow

### Branches

- `main` — deploys to staging automatically.
- `production` — deploys to production (tagged releases only).
- Feature branches: `feature/description` (e.g., `feature/incident-clustering`).
- Bug fixes: `fix/description`.

### Commit Messages

Use conventional commits:

```
feat: add incident clustering worker
fix: handle Twilio webhook retry deduplication
docs: add deployment runbook for WhatsApp migration
refactor: extract SLA computation to shared package
```

### Pull Request Process

1. Create a feature branch from `main`.
2. Make your changes. Ensure the code compiles (`pnpm turbo run build`).
3. Open a PR with a description of what changed and why.
4. Get one review approval.
5. Squash-merge to `main`.

### Database Schema Changes

Any change to `prisma/schema.prisma` requires:

1. Run `npx prisma migrate dev --name descriptive-name` to generate the migration.
2. Review the generated SQL in `prisma/migrations/`.
3. Include the migration file in your PR.
4. Update `docs/DATA_MODEL.md` if the change affects documented fields.

## Adding a New Integration

When adding a new external service (e.g., Slack notifications, PagerDuty):

1. Create the client in `src/integrations/your-service.ts`.
2. Include a dev stub that logs calls without making real API requests.
3. Gate real calls behind an env var (`USE_REAL_YOURSERVICE=true`).
4. Add the env var to `.env.example` with a comment.
5. Document the integration in `docs/TECH_STACK.md`.

## Adding a New Worker

When adding a new queue worker (e.g., incident clustering):

1. Create the worker in `src/workers/your-worker.ts`.
2. Define the job interface in `packages/shared/src/index.ts`.
3. Add the queue name to the BullMQ setup.
4. Test locally by publishing jobs from the pipeline.
5. Add a Dockerfile for the worker (same base as API, different entrypoint).
