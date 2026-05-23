# Deployment Guide

This guide covers how to run the platform locally and how the live
deployment on Railway is set up. The production stack is intentionally
small:

| Layer | Service | Why |
|---|---|---|
| Compute (API + dashboard) | **Railway** | One config file per service (`railway.api.json`, `railway.dashboard.json`), GitHub-integrated auto-deploys, generous free tier with always-on machines that don't sleep |
| PostgreSQL | **Neon** | Managed Postgres with branching; free tier covers our load |
| Redis | **Upstash** | Serverless Redis; pay-per-request fits a low-baseline workload |
| WhatsApp | **Twilio Sandbox** | Fastest path to a real bidirectional channel without Meta business verification |
| Translation + classification + reply drafts + incident summaries + KB drafts | **Anthropic Claude Haiku 4.5** | One vendor for all five AI surfaces; latency around 700–1100 ms per call |
| Realtime | **Socket.IO** (hosted inside the API process) | No separate broker needed; the API also serves WebSocket upgrades |
| Auth | **NextAuth + Google OAuth** | Dashboard sessions; the API verifies a NextAuth-signed JWT (HS256) |
| Notifications | **Slack Incoming Webhook** | Single channel; webhook URL kept in secrets |
| CI/CD | **Railway GitHub integration** + **GitHub Actions `ci.yml`** | Railway auto-deploys both services on push to `main`; GitHub Actions runs typecheck + vitest on every PR |

---

## 1. Local development

### Prerequisites

- Node.js 20+
- pnpm 9+ (`corepack enable && corepack prepare pnpm@latest --activate`)
- Docker Desktop running (for Postgres + Redis)
- An ngrok account (free tier is fine) for exposing the local webhook to Twilio
- A Twilio account with the WhatsApp Sandbox enabled

### Bring up the data services

From `agent-support-platform/`:

```bash
docker compose up -d        # spins up Postgres (with pgvector) + Redis
```

`docker-compose.yml` runs `pgvector/pgvector:pg16` and `redis:7-alpine`, both
with named volumes so data persists across restarts. Credentials match
`.env.example`:

```
DATABASE_URL="postgresql://asp_user:asp_dev_password@localhost:5432/agent_support"
REDIS_URL="redis://localhost:6379"
```

### Install and migrate

```bash
pnpm install
pnpm --filter @asp/api exec prisma migrate deploy
pnpm --filter @asp/api exec prisma generate
```

### Configure env vars

Copy `.env.example` to `apps/api/.env` and fill in the credentials you have.
The defaults are designed so the system still boots in *stub mode*:

| Var | Default behavior | Real behavior |
|---|---|---|
| `USE_REAL_WHATSAPP=false` | Logs outbound messages | Sends via Twilio |
| `USE_REAL_TRANSLATION=false` | Returns input text unchanged | Calls Anthropic Haiku |
| `USE_REAL_CLASSIFICATION=false` | Keyword-based classifier | Calls Anthropic Haiku |
| `SLACK_WEBHOOK_URL` (unset) | Logs notifications to stdout | Posts to Slack |
| `WEBHOOK_BASE_URL` (unset) | Twilio signature check still runs — set to your ngrok URL | — |

Setting `USE_REAL_*=true` without the matching API key falls back to the
stub and prints a warning instead of crashing. That makes the dev loop
forgiving — you can flip flags on without breaking the platform.

### Run the API and dashboard

In two terminals:

```bash
# API on :3001 (Express + Socket.IO)
pnpm --filter @asp/api dev

# Dashboard on :3000 (Next.js)
pnpm --filter @asp/dashboard dev
```

### Expose the webhook for Twilio

Twilio needs a public HTTPS URL for inbound message webhooks:

```bash
ngrok http 3001
# → forwards to localhost:3001
# → copy the https://*.ngrok-free.dev URL
```

Then:

1. Set `WEBHOOK_BASE_URL` in `apps/api/.env` to the ngrok URL.
2. In the Twilio Sandbox console, set the inbound webhook to
   `https://<ngrok>.ngrok-free.dev/webhooks/whatsapp`.
3. Restart the API so it picks up the new `WEBHOOK_BASE_URL`
   (used in the Twilio signature check).

> ⚠️ Note: switching the Twilio webhook to your ngrok URL means inbound
> messages stop reaching production until you switch it back. Either use
> a separate test Twilio account for local dev, or only flip the URL
> when actively testing.

### Optional: Google sign-in locally

If you want to test the auth path locally, run:

```bash
./scripts/set-auth-secrets.sh
```

It prompts for your Google OAuth Client ID + Secret, generates a shared
`NEXTAUTH_SECRET`, writes `apps/dashboard/.env.local`, and appends the
secret to `apps/api/.env`.

---

## 2. Production deployment (Railway)

Two services in one Railway project, both backed by the same GitHub repo:

| Service | URL | Config file | Dockerfile |
|---|---|---|---|
| API + Socket.IO + webhooks | <https://nclusion-api.up.railway.app> | `railway.api.json` | `apps/api/Dockerfile` |
| Dashboard (Next.js) | <https://nclusion-inbox-production.up.railway.app> | `railway.dashboard.json` | `apps/dashboard/Dockerfile` |

### 2.1 One-time bootstrap

1. Install the Railway CLI (`npm i -g @railway/cli`) and run `railway login`.
2. From the Railway dashboard: **New Project → Deploy from GitHub repo →
   select `bilingual-whatsapp-platform`**. Skip the auto-detect prompt
   — we configure two services manually.
3. Create **two services** from the same repo:
   - **api**: Settings → Service → Root Directory `agent-support-platform`,
     Config-as-code path `railway.api.json`
   - **dashboard**: same Root Directory, Config-as-code path
     `railway.dashboard.json`
4. For each service: Settings → Networking → **Generate Domain** (pick
   port `3001` for api, `3000` for dashboard).

### 2.2 Managed data services

| Service | Where to provision | Credential format |
|---|---|---|
| Postgres | [neon.tech](https://neon.tech) — create a project, copy the **Pooled connection string** | `postgresql://user:pass@host/db?sslmode=require` |
| Redis | [upstash.com](https://upstash.com) — create a Redis database, copy the **rediss://** TLS endpoint | `rediss://default:pass@host:6379` |

After the Neon database exists, run migrations against it:

```bash
DATABASE_URL='<your-neon-url>' pnpm --filter @asp/api exec prisma migrate deploy
```

### 2.3 Set environment variables

In each service's **Variables** tab (use **Raw Editor** to paste in
bulk).

**API service:**

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Your Neon pooled connection string |
| `REDIS_URL` | Your Upstash rediss:// endpoint |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER` | Twilio creds |
| `WEBHOOK_BASE_URL` | `https://nclusion-api.up.railway.app` (must match the public Railway URL exactly — used in Twilio signature reconstruction) |
| `USE_REAL_WHATSAPP=true`, `USE_REAL_TRANSLATION=true`, `USE_REAL_CLASSIFICATION=true` | Flip on the real integrations |
| `ANTHROPIC_API_KEY` | For all five Claude surfaces (translation, classification, reply drafts, incident summaries, KB drafts) |
| `NEXTAUTH_SECRET` | Must be the EXACT same value as on the dashboard service |
| `SLACK_WEBHOOK_URL` | Optional — for critical/high ticket notifications |
| `DASHBOARD_BASE_URL` | `https://nclusion-inbox-production.up.railway.app` — used in Slack "Open ticket" buttons |
| `PORT=3001` | Explicit override of Railway's auto-injected PORT |

**Dashboard service:**

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_API_URL` | The Railway API URL — Railway exposes service variables as build args too, so this is inlined into the client bundle automatically |
| `NEXTAUTH_URL` | The Railway dashboard URL |
| `NEXTAUTH_SECRET` | Same value as the API service |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | From Google Cloud Console OAuth 2.0 |
| `PORT=3000` | Explicit override |

> The Google OAuth client must have
> `https://nclusion-inbox-production.up.railway.app/api/auth/callback/google`
> in its **Authorized redirect URIs** list. Without this, sign-in fails
> with a `redirect_uri_mismatch` error.

### 2.4 Twilio webhook configuration

In the Twilio Sandbox console:

| Field | Value |
|---|---|
| WHEN A MESSAGE COMES IN | `https://nclusion-api.up.railway.app/webhooks/whatsapp` (POST) |
| STATUS CALLBACK URL | `https://nclusion-api.up.railway.app/webhooks/whatsapp/status` (POST) |

The API verifies Twilio's signature on every webhook using
`WEBHOOK_BASE_URL` — if that env var doesn't match the URL Twilio
calls, every request returns 403.

### 2.5 Deploy

Railway auto-deploys on every push to `main` via its GitHub
integration — no extra CI configuration needed.

For manual deploys:

```bash
railway link  # one-time link of local repo to the project
railway up --service api
railway up --service dashboard
```

---

## 3. CI/CD

- **`.github/workflows/ci.yml`** runs typecheck + the full vitest
  suite on every PR. Required to pass before merge.
- **Deploys** are handled by Railway's GitHub integration directly —
  every push to `main` triggers a build + deploy for each service that
  has changed files in its watched path.
- There is no separate deploy workflow in `.github/workflows/`.

---

## 4. Database migrations

Migrations live in `apps/api/prisma/migrations/`. They're additive —
new tables, new columns, no drops — so each deploy can apply them safely
before the new code rolls out.

```bash
# Local — against Docker Compose Postgres
pnpm --filter @asp/api exec prisma migrate dev --name <description>

# Production — against Neon
DATABASE_URL='<neon-url>' pnpm --filter @asp/api exec prisma migrate deploy
```

The API Dockerfile's CMD runs `prisma migrate deploy` on boot, so each
Railway deploy automatically applies any pending migrations before the
server starts. If you need to mark a migration as already-applied:

```bash
pnpm --filter @asp/api exec prisma migrate resolve --applied <migration_name>
```

---

## 5. Rollback

In the Railway dashboard:

1. Open the service → **Deployments** tab
2. Find the previous successful deployment
3. Click **⋮** → **Rollback to this deployment**

Or via CLI:

```bash
railway redeploy --service api --deployment <deployment-id>
```

If a bad migration ships, revert the schema change in a follow-up
migration rather than rolling back the database — Prisma's migration
history is append-only, and Neon doesn't support point-in-time recovery
on the free plan.

---

## 6. Health checks and observability

The API exposes `GET /health`:

```bash
curl https://nclusion-api.up.railway.app/health
# { "status": "ok", "timestamp": "2026-05-23T01:27:43.450Z" }
```

Railway's healthcheck (configured in `railway.api.json` →
`deploy.healthcheckPath`) hits this endpoint as part of every rolling
deploy and won't promote the new container until it returns 200.

| Check | Endpoint | What to watch for |
|---|---|---|
| API health | `GET /health` | 503 → database unreachable; check Neon dashboard |
| Webhook receiving | `railway logs --service api` | "─── Incoming WhatsApp message ───" line should appear when sending a sandbox message |
| Translation pipeline | Same logs | "✓ Translated" appears for each inbound non-English message |
| Realtime fan-out | Dashboard browser console | `socket connected` on page load |

---

## 7. WhatsApp production migration (future work)

The current deployment is on the Twilio WhatsApp **Sandbox**. To go live:

**Option A — Twilio Production WhatsApp**
- Upgrade to a paid Twilio plan.
- Apply for WhatsApp Business API access via Twilio.
- Register up to three numbers (one per country).
- Twilio handles Meta's approval flow.

**Option B — Meta Cloud API direct**
- Verify the business in Meta Business Manager.
- Register phone numbers.
- Add a new normalizer in `apps/api/src/services/message-normalizer.ts`
  that maps the Meta webhook payload onto the existing `RawMessage`
  envelope — every downstream step is payload-shape-agnostic.

Both paths leave the rest of the pipeline unchanged.
