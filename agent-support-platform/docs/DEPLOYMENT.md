# Deployment Guide

## Environments

| Environment | Purpose | WhatsApp | Database |
|---|---|---|---|
| **Local** | Development | Twilio Sandbox + ngrok | Docker Compose (Postgres + Redis) |
| **Staging** | QA and integration testing | Twilio test numbers | Cloud-hosted Postgres + Redis |
| **Production** | Live with all agents | Meta Cloud API (or Twilio production) | Cloud-hosted with backups and failover |

## Local Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full local setup. Summary:

```bash
docker compose up -d       # Postgres + Redis
cd apps/api && pnpm dev    # API server on :3001
ngrok http 3001            # Expose for Twilio webhooks
```

## Staging Deployment

### Infrastructure

- **Compute:** AWS ECS Fargate (or GCP Cloud Run). One service for the API server, one for each worker (translate, classify, cluster, notify, bot-handler, kb-indexer, connectivity-monitor, whatsapp-egress).
- **Database:** AWS RDS PostgreSQL 16 with pgvector extension. `db.t4g.medium` is sufficient for staging.
- **Redis:** AWS ElastiCache Redis 7, `cache.t4g.micro`.
- **Object storage:** S3 bucket for media files (images, voice notes, videos).
- **Secrets:** AWS Secrets Manager or Parameter Store for API keys and credentials.

### Deployment Steps

1. Build Docker images:
```bash
docker build -t asp-api ./apps/api
```

2. Push to container registry (ECR):
```bash
aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_URL
docker tag asp-api:latest $ECR_URL/asp-api:latest
docker push $ECR_URL/asp-api:latest
```

3. Run database migrations:
```bash
# From a container with database access
npx prisma migrate deploy
```

4. Deploy to ECS (update service to pull new image):
```bash
aws ecs update-service --cluster asp-staging --service asp-api --force-new-deployment
```

### Environment Variables (Staging)

```bash
NODE_ENV=staging
DATABASE_URL=postgresql://user:pass@rds-host:5432/agent_support
REDIS_URL=redis://elasticache-host:6379

# WhatsApp — use Twilio test numbers in staging
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_NUMBER=+14155238886
WEBHOOK_BASE_URL=https://staging-api.yourdomain.com

# Translation
USE_REAL_TRANSLATION=true
GOOGLE_CLOUD_PROJECT_ID=...
GOOGLE_APPLICATION_CREDENTIALS=/secrets/google-creds.json

# Classification
USE_REAL_CLASSIFICATION=true
ANTHROPIC_API_KEY=...
```

## Production Deployment

### Infrastructure Changes from Staging

- **Database:** `db.r6g.large` (or larger) with Multi-AZ enabled, automated backups, read replica for analytics queries.
- **Redis:** `cache.r6g.large` with persistence enabled (bot sessions should survive restarts).
- **Auto-scaling:** Configure ECS service auto-scaling based on SQS queue depth (for workers) and request count (for API).
- **CDN:** CloudFront for the dashboard static assets.
- **Monitoring:** Datadog agent on all containers. Sentry for error tracking.

### WhatsApp Production Setup

For production, migrate from Twilio Sandbox to either:

**Option A: Twilio Production WhatsApp**
- Upgrade Twilio to a paid plan.
- Apply for WhatsApp Business API access through Twilio.
- Register 3 phone numbers (one per country).
- Twilio handles Meta's approval process.

**Option B: Meta Cloud API Direct**
- Apply for Meta Business verification.
- Create a WhatsApp Business Account in Meta Business Manager.
- Register phone numbers and get them verified.
- Update the webhook adapter to use Meta's payload format (write a new normalizer; the `RawMessage` envelope stays the same).

### SSL and Domain

- API: `api.yourdomain.com` with SSL via ACM (AWS) or Let's Encrypt.
- Dashboard: `app.yourdomain.com` served from S3/CloudFront with SSL.
- Webhook: Must be HTTPS. WhatsApp/Twilio will reject HTTP webhook URLs.

### Database Migrations in Production

Always run migrations during a maintenance window or use zero-downtime migration practices:

```bash
# 1. Deploy the migration (additive only — new columns, new tables)
npx prisma migrate deploy

# 2. Deploy the new code that uses the new columns
aws ecs update-service ...

# 3. In a follow-up release, remove old columns if needed
```

Never drop columns or tables in the same deploy that removes the code using them.

## CI/CD Pipeline (GitHub Actions)

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]    # staging
    tags: ['v*']        # production

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - run: pnpm turbo run build
      # - run: pnpm turbo run test  # when tests exist

  deploy-staging:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      - run: |
          aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_URL
          docker build -t asp-api ./apps/api
          docker tag asp-api:latest $ECR_URL/asp-api:staging
          docker push $ECR_URL/asp-api:staging
          aws ecs update-service --cluster asp-staging --service asp-api --force-new-deployment

  deploy-production:
    needs: test
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    steps:
      # Same as staging but targeting production cluster
      # Add manual approval step via GitHub Environments
```

## Rollback

If a deployment causes issues:

```bash
# ECS: roll back to previous task definition
aws ecs update-service --cluster asp-production --service asp-api \
  --task-definition asp-api:PREVIOUS_REVISION

# Database: if a migration caused issues, apply a reverse migration
npx prisma migrate resolve --rolled-back MIGRATION_NAME
```

## Health Checks

The API exposes `GET /health` which checks database connectivity. Configure ECS/Cloud Run health checks to hit this endpoint.

| Check | Endpoint | Expected | Alert if |
|---|---|---|---|
| API health | GET /health | `{ status: "ok" }` | 503 or timeout > 5s |
| Database | Included in /health | — | Connection refused |
| Redis | Add to /health | — | Connection refused |
| Queue depth | Monitor via CloudWatch/BullMQ | < 100 pending | > 500 pending for 5+ min |
| Webhook receiving | Monitor inbound message rate | > 0/hour during business hours | 0 messages for 30+ min |
