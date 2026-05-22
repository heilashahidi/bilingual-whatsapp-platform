# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
