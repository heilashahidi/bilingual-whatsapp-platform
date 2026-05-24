# Tech Stack

Every technology choice in this project, why it was chosen, and what it would take to swap it.

## Core Runtime

### Node.js + TypeScript

**What:** Node.js 20+ with strict TypeScript across the entire codebase.

**Why:** The dashboard (React) and API share a language, which means shared types, one hiring profile, and a smaller team can own the full stack. TypeScript catches the kind of bugs that are expensive to debug across a translation/classification pipeline — malformed payloads, missing fields, wrong enum values.

**Alternative considered:** Python. Would be stronger for ML/NLP work if we were training custom models, but since classification and translation both use external APIs (Claude Haiku, Google Translate), the ML integration advantage doesn't apply.

## Backend

### Express.js

**What:** Express 4.x as the HTTP framework.

**Why:** Mature, well-understood, massive ecosystem. The API surface of this project is straightforward CRUD plus webhooks — we don't need the performance ceiling of Fastify or the opinionation of NestJS. Express gets out of the way.

**Swap path:** If request throughput becomes a bottleneck (unlikely at this scale), migrate to Fastify. The route handler signatures are nearly identical.

### Prisma ORM

**What:** Prisma as the database ORM with Prisma Migrate for schema management.

**Why:** Type-safe database queries that match the TypeScript-everywhere philosophy. Schema-as-code means the database structure lives in git and deploys deterministically. Prisma's migration system handles the complexity of evolving a schema with 10+ tables and multiple enum types.

**Tradeoff:** Prisma generates heavier queries than hand-written SQL. For the analytics dashboard queries (aggregations, time-series), we may need raw SQL via `prisma.$queryRaw`. That's fine — Prisma supports it.

### BullMQ

**What:** BullMQ for job queues backed by Redis.

**Why:** The message pipeline (translate → classify → cluster → notify) should run as independent workers that can fail and retry independently. BullMQ gives us named queues, retry policies, dead-letter queues, and a dashboard (Bull Board) for monitoring — all backed by Redis we're already running.

**Swap path:** In production on AWS, migrate to SQS for managed durability. The worker code stays the same; only the queue client changes.

## Database

### PostgreSQL 16 + pgvector

**What:** PostgreSQL as the primary database with the pgvector extension for vector similarity search.

**Why:** Postgres handles relational data (tickets, agents, messages, incidents) with strong integrity guarantees. pgvector adds vector similarity search for the knowledge base without requiring a separate vector database. At our scale (thousands of articles, not millions), pgvector performs well and keeps the infrastructure simple.

**Why not a dedicated vector DB (Pinecone, Weaviate):** Operational complexity. Adding a fourth data store (Postgres + Redis + vector DB + object storage) for a feature that processes a few hundred similarity queries per day is premature. pgvector co-locates embeddings with the relational data they reference, which simplifies queries and eliminates sync issues.

**Hosting:** AWS RDS or GCP Cloud SQL with the pgvector extension enabled.

### Redis 7

**What:** Redis for caching, real-time pub/sub, bot conversation state, and job queue backing.

**Why:** Three features need Redis:
1. **Bot conversation state** — stateful WhatsApp bot sessions with per-country TTLs (30 min for DR, 2 hours for Haiti/DRC).
2. **Real-time pub/sub** — when a new ticket is created, Redis pub/sub pushes the event to all connected dashboard WebSocket clients.
3. **Job queues** — BullMQ stores job data and state in Redis.

One Redis instance handles all three. In production, use ElastiCache or MemoryStore with persistence enabled so bot sessions survive a Redis restart.

## WhatsApp Integration

### Twilio (Development + Optional Production)

**What:** Twilio's WhatsApp Business API as the message broker.

**Why for development:** Twilio's WhatsApp Sandbox is available instantly — no Meta business verification, no approval wait. Send a code phrase from your phone and you're receiving webhooks in minutes.

**Why for production (optional):** Twilio handles Meta's approval process as a Business Solution Provider (BSP), manages message templates, and provides better delivery reporting than the raw Meta Cloud API. The tradeoff is per-message cost.

**Swap path to Meta Cloud API:** The ingress adapter (`message-normalizer.ts`) is the only code that touches the WhatsApp payload format. Write a second normalizer for Meta's webhook format, swap the adapter based on an env var, and every downstream component is unaffected. The `RawMessage` envelope is provider-agnostic by design.

**Cost consideration:** At 1,000+ agents, Twilio's per-message pricing adds up. Meta Cloud API is free for business-initiated conversations within the first 1,000/month and significantly cheaper at scale. Plan to migrate to Meta Cloud API for production.

## Translation

### Anthropic Claude Haiku 4.5

**What:** Claude Haiku (`claude-haiku-4-5-20251001`) handles every translation call. Same single Anthropic dependency as classification, reply drafts, incident summaries, and KB drafts — one vendor for all five AI surfaces.

**Why Haiku and not Google Translate:** The original plan was Google Cloud Translation v3 Advanced with custom glossaries (the only commercial provider with strong Haitian Creole support). In practice Claude Haiku produces faithful translations (median 0.92 confidence on Creole, see `docs/PERFORMANCE.md §6`), keeps product names / error strings literal via prompt instruction, and avoids a second vendor + glossary upload pipeline. Glossary-style overrides can move into the prompt if specific terms regress.

**Direction-aware behavior:** Outbound English-to-English short-circuits the LLM entirely (operator's wording is sent verbatim). Inbound likely-English messages skip the LLM via the conservative `isLikelyEnglish` heuristic (`apps/api/src/services/language-detection.ts`). See `docs/AI_USAGE.md §2.1` and `docs/PERFORMANCE.md §2` for measurements.

**Development mode:** The codebase includes a stub translator (`translateStub`) that returns text unchanged. Set `USE_REAL_TRANSLATION=true` and provide `ANTHROPIC_API_KEY` to call Claude.

**Swap path:** The `translateMessage()` interface in `apps/api/src/integrations/translation.ts` is provider-agnostic. Swapping to Google Cloud Translation or DeepL is a single-file change; the rest of the pipeline doesn't know which engine ran.

## Classification + Reply drafts + Incident summaries + KB drafts

### Claude Haiku (via Anthropic API)

**What:** Claude Haiku (`claude-haiku-4-5-20251001`) powers four operator-facing surfaces in addition to translation: classification, AI-suggested reply drafts (`reply-suggester.ts`), incident summaries (`incident-summarizer.ts`), and KB article drafts (`kb-drafter.ts` invoked by `kb-indexer.ts`). All five surfaces are documented end-to-end in `docs/AI_USAGE.md`.

**Why Haiku specifically:** This is a constrained classification task — read a short English message and output structured JSON with category, severity, tags, and product area. Haiku handles this as well as larger models at a fraction of the cost and latency. At 5,000–15,000 classifications per day (1,000+ agents × 5–15 messages each), Haiku keeps costs at single-digit dollars per day.

**Why not a larger model:** The classification prompt includes explicit category definitions, a severity rubric, and 10–15 example messages. With that scaffolding, the accuracy gap between Haiku and Opus/GPT-4 is negligible for structured classification. Larger models earn their place for summarization and cross-ticket pattern detection — tasks we can route selectively.

**Why not a fine-tuned small model:** Cold-start problem. We don't have labeled training data yet. Start with prompt-based classification on Haiku, accumulate labeled data from dashboard reclassifications, and evaluate fine-tuning a smaller model (Mistral 7B, Llama 3 8B) if API costs become a concern at scale.

**Swap path:** The classifier is behind a `classifyMessage()` interface. Swap models by changing the API call in `integrations/classification.ts`. No downstream code changes.

**Development mode:** The codebase includes a keyword-based stub classifier. Set `USE_REAL_CLASSIFICATION=true` and provide `ANTHROPIC_API_KEY` to switch to Claude.

## Embeddings (Knowledge Base)

### OpenAI text-embedding-3-small

**What:** OpenAI's lightweight embedding model for generating vector representations of ticket text, used for knowledge base similarity search.

**Why this model:** Cheapest embedding model with strong English quality. At 1,536 dimensions, it balances search quality with storage efficiency in pgvector. The knowledge base operates entirely on English translations, so multilingual embedding quality is less critical.

**Alternative:** Cohere embed-english-v3.0. Slightly better multilingual performance if we later want to embed original-language text alongside translations. Pick based on existing API relationships.

## Frontend

### React + Next.js + Tailwind CSS

**What:** Next.js as the React framework with Tailwind for styling.

**Why Next.js:** Server-side rendering for the initial dashboard load, API routes if we want to colocate lightweight BFF logic, and file-based routing that maps cleanly to our dashboard views (tickets, incidents, knowledge base, agents, analytics, settings).

**Why Tailwind:** Fast iteration on a dashboard UI without maintaining a separate CSS architecture. Utility classes are well-suited to the data-dense table/list/detail views that dominate this dashboard.

### Socket.IO

**What:** Socket.IO for real-time WebSocket communication between the API and dashboard.

**Why:** The dashboard needs live updates — new tickets appearing, SLA countdowns ticking, incident status changes, delivery receipt updates, nav badges, open drawers. A single `ticket:changed` event broadcast on every server-side ticket mutation drives the conversation list (`router.refresh()`), open `TicketDrawer` (refetch by id), and the nav-link badge counts. Socket.IO handles WebSocket connection management and automatic reconnection.

**Current scaling constraint:** runs in-process on the API, pinned to a single Railway machine. The Redis adapter migration path for multi-instance is documented in `docs/ARCHITECTURE.md §4.5`; Upstash Redis is already provisioned.

**Swap path:** If we need guaranteed message delivery or higher reliability, migrate to a managed service like Ably or Pusher. The event shapes stay the same; only the transport changes.

### NextAuth + Google OAuth

**What:** NextAuth on the dashboard with Google as the only OAuth provider. The API verifies an HS256-signed JWT (no JWE) using the shared `NEXTAUTH_SECRET`.

**Why:** Internal-tool auth without a separate identity service. Google Workspace gives us the existing operator account graph; NextAuth handles the OAuth dance and session cookies. The HS256 choice (over JWE) keeps the API verifier dependency-free — it's a single `jose` call with the shared secret. Role enforcement (`requireRole("admin", "operations", ...)`) is layered on PATCH / destructive routes.

## Infrastructure

### Docker + Docker Compose (Development)

**What:** All services (API, Postgres, Redis) containerized for local development.

**Why:** `docker compose up -d` gives every developer an identical environment regardless of their OS. No "works on my machine" issues with Postgres extensions or Redis versions.

### Railway (Production, shipped)

**What:** Two Railway services in one project — `api` (Express + Socket.IO + webhooks) and `dashboard` (Next.js) — both backed by the same GitHub repo and auto-deployed on push to `main`.

**Why Railway:** One config file per service (`railway.api.json`, `railway.dashboard.json`), generous free tier with always-on machines that don't sleep, and a GitHub integration that needs no extra CI to deploy. Postgres lives on **Neon** (free tier, pooled connection) and Redis on **Upstash** (serverless, pay-per-request). The full setup is in `docs/DEPLOYMENT.md`.

**Future scaling:** if the API needs more than one machine, Socket.IO requires the Redis adapter (see `docs/ARCHITECTURE.md §4.5`). Until then `numReplicas` in `railway.api.json` is pinned to `1`. AWS ECS Fargate / GCP Cloud Run remain valid swap targets if Railway's limits become an issue.

### GitHub Actions (CI/CD)

**What:** GitHub Actions for continuous integration and deployment.

**Why:** Tightly integrated with the GitHub monorepo. Run tests, lint, type-check, build Docker images, push to container registry, and deploy — all from the same workflow file.

## Monitoring

### Datadog + Sentry

**What:** Datadog for infrastructure and application metrics. Sentry for error tracking.

**Why Datadog:** Unified view of container metrics, database performance, queue depth, and custom application metrics (translation latency, classification accuracy, bot deflection rate, connectivity health scores). The APM traces are essential for debugging a pipeline where a single message touches 5+ services.

**Why Sentry:** Structured error tracking with context. When a classification call fails or a translation returns low confidence, Sentry captures the full request context so we can reproduce and fix.

## Development Tools

| Tool | Purpose |
|---|---|
| **pnpm** | Package manager (fast, disk-efficient, strict dependency isolation) |
| **Turborepo** | Monorepo build orchestration (caches builds, runs tasks in parallel) |
| **Prisma Studio** | Visual database browser for development (`npx prisma studio`) |
| **ngrok** | Expose local server for Twilio webhook testing |
| **Bull Board** | Visual queue monitoring dashboard (optional, add via `@bull-board/express`) |
