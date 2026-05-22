# Deployment Guide

This guide covers how to run the platform locally and how the live deployment
on Fly.io is set up. The production stack is intentionally small:

| Layer | Service | Why |
|---|---|---|
| Compute (API + dashboard) | **Fly.io** | One config per app, Docker-native, regional placement, single CLI for deploys + secrets |
| PostgreSQL | **Neon** | Managed Postgres with branching; free tier covers our load |
| Redis | **Upstash** | Serverless Redis; pay-per-request fits a low-baseline workload |
| WhatsApp | **Twilio Sandbox** | Fastest path to a real bidirectional channel without Meta business verification |
| Translation + classification | **Anthropic Claude Haiku** | One vendor for both jobs; latency around 700–1100 ms |
| Realtime | **Socket.IO** (hosted inside the API) | No separate broker needed; the API also serves WebSocket upgrades |
| Auth | **NextAuth + Google OAuth** | Dashboard sessions; the API verifies a NextAuth-signed JWT (HS256) |
| Notifications | **Slack Incoming Webhook** | Single channel; webhook URL kept in secrets |
| CI/CD | **GitHub Actions** | `.github/workflows/deploy.yml` deploys both Fly apps on push to `main` |

> **Note on Railway.** The PRD lists Railway as the deployment target under
> §4.1. We deploy on Fly.io instead, which the PRD also permits under
> "Cloud Platforms: Any." The reasoning: Fly's `min_machines_running = 1`
> model on the free/hobby tier keeps the API process warm so inbound
> Twilio webhooks don't hit a cold start, and the `flyctl` CLI gives a
> tight loop for setting secrets and watching logs. Everything below
> would translate to Railway by replacing `flyctl deploy` with
> `railway up` and `fly secrets set` with `railway variables set`.

---

## 1. Local development

### Prerequisites

- Node.js 20+
- pnpm 9+ (`corepack enable && corepack prepare pnpm@latest --activate`)
- Docker Desktop running (for Postgres + Redis)
- An ngrok account (free tier is fine) for exposing the local webhook to Twilio
- A Twilio account with the WhatsApp Sandbox enabled

### Bring up the data services

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

### Optional: Google sign-in locally

If you want to test the auth path locally, run:

```bash
./scripts/set-auth-secrets.sh
```

It prompts for your Google OAuth Client ID + Secret, generates a shared
`NEXTAUTH_SECRET`, writes `apps/dashboard/.env.local`, and appends the
secret to `apps/api/.env`. The same script stages the secrets on both
Fly apps (see §3 below), so you only run it once per credential rotation.

---

## 2. Production deployment (Fly.io)

There are two Fly apps:

| App | Domain | Config file | Memory |
|---|---|---|---|
| API + Socket.IO + webhooks | `heilashahidi.fly.dev` | `fly.api.toml` | 512 MB, 1 shared CPU, `min_machines_running = 1` |
| Dashboard (Next.js) | `asp-dashboard-heila.fly.dev` | `fly.dashboard.toml` | 1 GB, 1 shared CPU, auto-stop |

The API has `min_machines_running = 1` because Twilio retries webhooks only
once on timeout — a cold start risks dropping inbound messages. The
dashboard auto-stops when idle; the cold start there only affects an
already-signed-in operator opening a stale tab.

### One-time bootstrap

```bash
# Install flyctl
brew install flyctl   # or:  curl -L https://fly.io/install.sh | sh

fly auth login

# Create the apps (one-time)
fly launch --config fly.api.toml --copy-config --no-deploy
fly launch --config fly.dashboard.toml --copy-config --no-deploy
```

### Managed data services

| Service | Where to provision | Credential format |
|---|---|---|
| Postgres | [neon.tech](https://neon.tech) — create a project, copy the **Pooled connection string** | `postgresql://user:pass@host/db?sslmode=require` |
| Redis | [upstash.com](https://upstash.com) — create a Redis database, copy the **Endpoint** with `rediss://` TLS | `rediss://default:pass@host:6379` |

After the Neon database exists, run migrations against it:

```bash
DATABASE_URL='<your-neon-url>' pnpm --filter @asp/api exec prisma migrate deploy
```

### Set Fly secrets

Three scripts in `scripts/` cover all the secrets the apps need. They
prompt for sensitive values interactively (`read -s`) so nothing lands in
shell history.

```bash
# Twilio + Anthropic + Neon + Upstash + WEBHOOK_BASE_URL
./scripts/set-fly-api-secrets.sh

# NextAuth + Google OAuth (sets secrets on BOTH Fly apps + local .env files)
./scripts/set-auth-secrets.sh

# Slack incoming webhook (optional, sets DASHBOARD_BASE_URL too)
./scripts/set-slack-webhook.sh
```

The full secret set the API needs in production:

| Secret | Where it's used |
|---|---|
| `DATABASE_URL` | Prisma client |
| `REDIS_URL` | (currently unused at runtime, reserved for future workers) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER` | Inbound signature check, outbound send |
| `WEBHOOK_BASE_URL` | Reconstructing the URL Twilio signs against |
| `USE_REAL_WHATSAPP`, `USE_REAL_TRANSLATION`, `USE_REAL_CLASSIFICATION` | All `true` in prod |
| `ANTHROPIC_API_KEY` | Claude Haiku for translation + classification |
| `NEXTAUTH_SECRET` | Verifies the dashboard's Bearer JWT |
| `SLACK_WEBHOOK_URL` | Posts critical/high tickets + mentions |
| `DASHBOARD_BASE_URL` | "Open ticket" links in Slack messages |

The dashboard needs:

| Secret | Where it's used |
|---|---|
| `NEXTAUTH_URL` | OAuth callback URL (e.g. `https://asp-dashboard-heila.fly.dev`) |
| `NEXTAUTH_SECRET` | Same value as the API |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `NEXT_PUBLIC_API_URL` (build arg) | API origin; baked in at build via `fly.dashboard.toml > [build.args]` |

### Deploy

The CI workflow deploys on every push to `main`, but you can deploy
manually any time:

```bash
fly deploy --config fly.api.toml
fly deploy --config fly.dashboard.toml
```

Fly builds the Docker image remotely (`--remote-only` in CI), pushes it
to its registry, and rolls the machines one by one. Deploys typically
take ~90 seconds end to end.

### Twilio webhook for production

Once the API is live at `heilashahidi.fly.dev`:

1. In the Twilio Sandbox, set the inbound webhook to
   `https://heilashahidi.fly.dev/webhooks/whatsapp` (HTTP method: POST).
2. Confirm `WEBHOOK_BASE_URL=https://heilashahidi.fly.dev` is set on the API
   app (`fly secrets list --config fly.api.toml`). The signature check
   reconstructs the request URL from this value; if it's wrong, every
   webhook returns 403.

---

## 3. CI/CD

`.github/workflows/deploy.yml` deploys both apps on push to `main`:

```yaml
jobs:
  deploy-api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --config fly.api.toml --remote-only
        working-directory: agent-support-platform
        env: { FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }} }

  deploy-dashboard:
    needs: deploy-api    # API first so NEXT_PUBLIC_API_URL is reachable
    runs-on: ubuntu-latest
    steps: …
```

To enable it:

1. Generate a token: `fly auth token`.
2. In the GitHub repo, **Settings → Secrets and variables → Actions →
   New repository secret**: name `FLY_API_TOKEN`, value the token.

`.github/workflows/ci.yml` runs typecheck + vitest on every PR — see that
file for the full matrix.

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

If you need to mark a migration as already-applied (because the schema
was created out-of-band, which happens after a `DROP SCHEMA public CASCADE`
on Neon during a rebuild):

```bash
pnpm --filter @asp/api exec prisma migrate resolve --applied <migration_name>
```

---

## 5. Rollback

```bash
# List recent releases
fly releases --config fly.api.toml

# Roll back to a specific image version
fly deploy --config fly.api.toml --image registry.fly.io/heilashahidi:deployment-<id>
```

If the issue is a bad migration, revert the schema change in a follow-up
migration rather than rolling back the database — Prisma's migration
history is append-only, and Neon doesn't support point-in-time recovery
on the free plan.

---

## 6. Health checks and observability

The API exposes `GET /health`:

```bash
curl https://heilashahidi.fly.dev/health
# { "status": "ok", "timestamp": "2026-05-22T19:35:00.000Z" }
```

Fly checks this endpoint as part of every rolling deploy and won't promote
the new machine until it returns 200.

| Check | Endpoint | What to watch for |
|---|---|---|
| API health | `GET /health` | 503 → database unreachable; check Neon dashboard |
| Webhook receiving | API logs (`fly logs --config fly.api.toml`) | "─── Inbound WhatsApp ───" line should appear when sending a sandbox message |
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
