# Agent Support Platform

A real-time support bridge connecting 1,000+ field agents across Haiti, Dominican Republic, and the Democratic Republic of Congo with a US-based operations and engineering team. Agents report issues through WhatsApp in their native language; the US team manages everything from an English-language web dashboard. Translation, classification, and routing happen transparently in between.

## The Problem

Field agents encounter technical issues (app crashes, transaction failures, connectivity problems), have operational complaints, and surface feature requests — but there is no structured channel for these to reach the US team. Issues go unreported for days or weeks. When they do surface, it's through fragmented informal channels that make triage impossible.

## The Solution

Meet agents where they already are (WhatsApp) and give the US team a purpose-built dashboard. The platform automatically translates between Haitian Creole/French/Spanish and English, classifies and prioritizes every message, detects systemic incidents across regions, resolves common issues instantly via a self-service bot, and builds a knowledge base from every resolved ticket.

## Key Features

- **WhatsApp ↔ Dashboard bridge** with transparent real-time translation
- **Automated classification** (category, severity, tags) via lightweight LLM
- **Incident clustering** — detects when multiple agents report the same systemic issue
- **Self-service WhatsApp bot** — resolves known issues instantly without human intervention
- **Knowledge base** — learns from every resolved ticket, feeds the bot and suggests solutions
- **Haiti/DRC connectivity awareness** — extended SLAs, delivery tracking, outage detection, message optimization for 2G networks
- **SLA tracking** with country-specific thresholds

## Quick Start

### Prerequisites

- Node.js 20+, pnpm, Docker & Docker Compose
- [Twilio account](https://www.twilio.com/try-twilio) (free trial)
- [ngrok](https://ngrok.com/)

### Setup (15 minutes)

```bash
# Install dependencies
pnpm install

# Start Postgres (pgvector) + Redis
docker compose up -d

# Configure environment
cp .env.example apps/api/.env
# Edit apps/api/.env with your Twilio credentials

# Initialize database
cd apps/api
npx prisma migrate dev --name init
npx prisma db seed
cd ../..

# Start the API server
cd apps/api && pnpm dev

# In a new terminal — expose for Twilio
ngrok http 3001
```

Paste the ngrok HTTPS URL into your [Twilio WhatsApp Sandbox config](https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn) as the webhook URL, send a message from your phone, and watch the pipeline process it.

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for the full development guide.

## Documentation

| Document | Description |
|---|---|
| [Tech Stack](docs/TECH_STACK.md) | Every technology choice and why |
| [Architecture](docs/ARCHITECTURE.md) | System design, message flow, component breakdown |
| [API Reference](docs/API.md) | All endpoints with request/response examples |
| [Data Model](docs/DATA_MODEL.md) | Database schema, relationships, and field descriptions |
| [Deployment](docs/DEPLOYMENT.md) | Environments, infrastructure, CI/CD |
| [Contributing](docs/CONTRIBUTING.md) | Dev setup, coding standards, PR process |
| [Connectivity](docs/CONNECTIVITY.md) | Haiti/DRC latency handling and resilience design |
| [Translation](docs/TRANSLATION.md) | Translation pipeline, glossary management, language support |
| [Runbooks](docs/RUNBOOKS.md) | Operational playbooks for incidents and common issues |
| [Changelog](CHANGELOG.md) | Version history |

## Project Structure

```
agent-support-platform/
├── apps/
│   ├── api/                    # Express API server
│   │   ├── src/
│   │   │   ├── routes/         # HTTP endpoints (webhooks, tickets, agents)
│   │   │   ├── services/       # Business logic (pipeline, normalizer, database)
│   │   │   ├── integrations/   # External services (Twilio, translation, LLM)
│   │   │   └── workers/        # Queue consumers (translate, classify, cluster)
│   │   └── prisma/             # Schema and migrations
│   └── dashboard/              # React frontend (Next.js)
├── packages/
│   └── shared/                 # Shared types, constants, SLA configs
├── docs/                       # Project documentation
└── infra/                      # Infrastructure as code
```

## License

Proprietary. All rights reserved.
