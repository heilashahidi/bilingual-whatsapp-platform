# 02 — Type consolidation

Cleanup agent #2 of 8. Survey of every `type | interface | enum` declaration across
`apps/api`, `apps/dashboard`, and `packages/shared`, plus the decisions made.

## Monorepo layout

- `apps/api` — Express + Prisma + Socket.IO + BullMQ
- `apps/dashboard` — Next.js 14 app, imports `@asp/shared` (already declared as a workspace dep)
- `packages/shared` — single file, `src/index.ts`, exports `RawMessage`, `ClassificationResult`,
  and a few SLA/connectivity constants
- Source of truth for domain enums: `apps/api/prisma/schema.prisma`

## Duplicate / divergent type catalog

| Name | API location | Dashboard location | Verdict | Confidence |
|---|---|---|---|---|
| `ReplySuggestion` | `apps/api/src/services/reply-suggester.ts:16` | `apps/dashboard/lib/api.ts:100` | **Move to shared** — identical shape `{ tone, text }`; it IS the API contract returned by `POST /suggest-replies` | high |
| `TicketEventKind` / `TicketChangedEvent` | `apps/api/src/services/realtime.ts:22` | `apps/dashboard/lib/socket.ts:17` | **Move to shared** — wire-protocol contract for `ticket:changed` socket.io event; emitter and listener must agree | high |
| `AuditAction` | `apps/api/src/services/audit.ts:7` (12 values) | `apps/dashboard/lib/types.ts:78` (10 values) | **Unify on API superset** — dashboard's `ACTION_VERB` lookup already has a fallback for unknown actions (`ACTION_VERB[e.action] \|\| e.action.replace(/_/g, " ")`), so widening is safe | high |
| `Severity` union | dashboard `lib/types.ts:4`, plus a local copy in `apps/api/src/services/incident-clusterer.ts:21` derived from `SEVERITY_RANK` | n/a | **Keep separate** — dashboard's is a UI mirror of Prisma's `Severity` enum; API uses Prisma's directly. Unifying would force dashboard to depend on `@prisma/client` or shared to re-export it. Low value vs. risk. | low |
| `TicketStatus`, `TicketCategory`, `Country`, `DeliveryStatus`, `IncidentStatus` | Prisma enums on API; string-union mirrors in `apps/dashboard/lib/types.ts` | — | **Keep separate** (same reason as Severity). Codegen from Prisma would be the right long-term fix; see note in `dashboard/lib/types.ts:1`. | low |
| `UserRole` | `apps/api/src/middleware/auth.ts:4`; mirrored as a string union inside `InternalUser` at `dashboard/lib/types.ts:113` | — | **Keep separate** — server JWT concern; dashboard just reads the role string off `/api/me` | low |
| `Message`, `Ticket`, `Agent`, `Branch`, `Incident`, `KnowledgeArticle`, etc. | Prisma rows on API | UI view models on dashboard (`lib/types.ts`) | **Keep separate** — these are intentionally different layers. API returns JSON with ISO strings, flattened relations; Prisma rows have `Date` objects and nested includes. Comment at `dashboard/lib/types.ts:1` already says "mirrors the shape returned by GET /api/tickets" | high (don't merge) |

## Module-local types (correctly colocated, no change)

- `apps/api/src/services/message-normalizer.ts`: `TwilioWhatsAppPayload`
- `apps/api/src/services/reply-suggester.ts`: `ConversationMessageForPrompt`, `PromptInput`
- `apps/api/src/services/kb-drafter.ts`: `KbDraft`, `TicketContext`
- `apps/api/src/services/intake-prompter.ts`: `IntakePromptInput`
- `apps/api/src/services/incident-summarizer.ts`: `SummaryOutput`
- `apps/api/src/services/outbound-queue.ts`: `OutboundJob`
- `apps/api/src/integrations/slack.ts`: `SlackMessage`
- `apps/api/src/integrations/translation.ts`: `TranslationResult`, `CacheEntry`
- `apps/api/src/middleware/auth.ts`: `AuthUser`
- Dashboard UI types: `InboxKey`/`InboxDef`, `KanbanStatus`, `Mode`, `ToastEntry`, `ConnState`, `DensityPref`/`ViewPref`/`UiPrefs`, `ActiveFilters`, `TimelineItem`, `TicketPatch`, `OutreachTicketInput`

## Implementation summary

Three consolidations land in `packages/shared/src/index.ts`:

1. `ReplySuggestion` — re-exported from API and dashboard (named re-export keeps existing call sites untouched)
2. `TicketEventKind` — new shared type; API's emit signature and dashboard's listener both use it
3. `AuditAction` — unified to API's 12-value superset; dashboard re-exports it from shared

What we deliberately did **not** touch:

- Per-layer entity shapes (`Ticket`, `Message`, …). Codegen from Prisma → API DTOs → UI view models is
  the right long-term architecture but is a multi-day refactor; out of scope for cleanup.
- Domain enums as string literal unions on the dashboard. They sit cleanly behind the API JSON boundary
  and the duplication cost is low. A future PR could swap them for shared exports without changing call sites.
- Server-side `AuthUser` and JWT plumbing.
