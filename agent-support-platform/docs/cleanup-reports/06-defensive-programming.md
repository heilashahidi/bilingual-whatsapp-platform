# Cleanup Report 06 — Defensive Programming

Agent: cleanup #6 of 8
Scope: try/catch, `.catch(...)`, `??`/`||` fallbacks, optional chaining used to
swallow errors.

## Headline

The codebase is unusually disciplined here. Of the 56 `try` blocks and
~20 `.catch(...)` chains audited, **only two were swallowing errors in
a way that hides upstream signal**. Everything else sits at a real
system boundary (HTTP handler, LLM call, Twilio/Redis fallback, Prisma
transient retry, JWT verify, localStorage parse, fire-and-forget side
effect) with a clear handling story.

No `process.on('uncaughtException')` or `unhandledRejection` swallowers
exist. No `error.message ?? "Unknown"`-style fallbacks. The
`?? []`/`.catch(() => [])` patterns on the dashboard pages are at the
RSC ↔ API boundary and degrade to a useful UI — not silent loss.

## Catalog

### KEEP — system boundaries with clear handling

| File:line | What it guards | Why legitimate |
|---|---|---|
| `apps/dashboard/app/tickets/page.tsx:12` | RSC → API fetch | Renders error UI |
| `apps/dashboard/app/tickets/page.tsx:17` | Users list fetch | `[]` fallback acceptable degradation |
| `apps/dashboard/app/tickets/_components/kanban-board.tsx:188` | Optimistic drag update | Rollback + error banner |
| `apps/dashboard/app/tickets/_components/new-ticket-modal.tsx:67` | Form submit | UI error display |
| `apps/dashboard/app/tickets/_components/new-ticket-modal.tsx:219` | Debounced typeahead search | Empty result is correct UX for failed search |
| `apps/dashboard/app/tickets/[id]/response-composer.tsx:134` | Form submit | UI error display |
| `apps/dashboard/app/tickets/[id]/response-composer.tsx:197` + 215 | AI reply suggestions | Optional feature, hides UI on failure |
| `apps/dashboard/app/tickets/[id]/ticket-actions.tsx:59/71/85` | Mutation handlers | UI error display |
| `apps/dashboard/app/tickets/[id]/page.tsx:19` | Metadata fallback | Falls back to generic tab title |
| `apps/dashboard/app/tickets/[id]/page.tsx:42` | 404 → notFound() | Conversion + rethrow |
| `apps/dashboard/app/knowledge/page.tsx:41` | RSC → API fetch | Renders error UI |
| `apps/dashboard/app/knowledge/_components/article-actions.tsx:16/27` | Mutation handlers | UI error display |
| `apps/dashboard/app/_components/tickets-nav-link.tsx:26` | Nav badge poll | Keeps last known count (commented WHY) |
| `apps/dashboard/app/_components/incidents-nav-link.tsx:27` | Nav badge poll | Same |
| `apps/dashboard/app/incidents/page.tsx:50` + `[id]/page.tsx:17` | RSC → API fetch | Renders error UI |
| `apps/dashboard/app/incidents/[id]/_components/incident-detail-view.tsx:73/85/97` | Form submits | UI error display |
| `apps/dashboard/lib/ui-prefs.ts:53/76` | localStorage parse + quota | Untrusted parse + quota |
| `apps/dashboard/lib/auth.ts:26/45` | API → JWT enrichment | External boundary, documented |
| `apps/dashboard/lib/auth-client.ts:12` | Token fetch | Returns undefined to caller |
| `apps/api/src/server.ts:34` | /health DB ping | Returns 503 |
| `apps/api/src/server.ts:81` | Graceful shutdown | Must continue to httpServer.close |
| `apps/api/src/middleware/auth.ts:45` | jwt.verify | Returns 401 |
| `apps/api/src/integrations/slack.ts:24` | External Slack webhook | Logged failure |
| `apps/api/src/integrations/translation.ts:176` | LLM JSON parse | Falls back to stub |
| `apps/api/src/integrations/classification.ts:86` | LLM JSON parse | Falls back to stub |
| `apps/api/src/routes/webhooks.ts:56/86` | Webhook handlers | Twilio already got 200; cannot propagate |
| `apps/api/src/routes/tickets.ts:195` | POST /messages multi-step | Returns 500 |
| `apps/api/src/routes/tickets.ts:473` | POST /outreach multi-step | Returns 500 |
| `apps/api/src/routes/tickets.ts:586` | suggest-replies | Documented graceful degradation |
| `apps/api/src/services/outbound-queue.ts:74` | BullMQ enqueue | Falls back to inline |
| `apps/api/src/services/kb-drafter.ts:76/107` | LLM call + JSON parse | Returns null; caller has mechanical fallback |
| `apps/api/src/services/outbound-worker.ts:59` | Mark-failed inside `worker.on('failed')` | Cannot propagate from event handler |
| `apps/api/src/services/database.ts:46` | Prisma transient retry | Documented Neon-suspend pattern |
| `apps/api/src/services/reply-suggester.ts:77/208` | LLM call + JSON parse | Returns [] |
| `apps/api/src/services/message-pipeline.ts:211/255/359/409` | Per-step LLM / Prisma in pipeline | All documented; pipeline continues with fallback classification or skips optional step |
| `apps/api/src/services/incident-summarizer.ts:91/137` | LLM call + JSON parse | Optional title rewrite |
| `apps/api/src/services/queue.ts:63/128` | BullMQ init / enqueue | Falls back to inline |
| Fire-and-forget `.catch(err => console.error)` chains | Background enqueue, Slack notify, KB indexer, audit log, incident clusterer | All caller has already responded to user; logging is the right disposition |

### REMOVE / FIX — genuine swallows

| File:line | Issue | Action |
|---|---|---|
| `apps/api/prisma/seed.ts:236` | `.catch(console.error)` on `main()` — seed can fail silently with exit 0 (CI green) | Replace with explicit non-zero exit on error |
| `apps/dashboard/app/_components/toast-container.tsx:66` | Empty `catch {}` with comment justifying UX silence but no log — when fetch fails, no signal anywhere | Add `console.error` so failures are diagnosable in browser devtools |

## Why so little to remove

- Almost every catch in this repo is paired with a fallback that the
  product needs (translation/classification stub, Redis → inline,
  audit "best-effort"). The patterns are documented in comments
  explaining WHY.
- HTTP handlers either let errors bubble (Express's default error
  path) or wrap multi-step writes for an explicit 500 response.
- No "catch and return null hiding upstream bug" idioms detected.
- No nullable chaining like `user?.name ?? "Unknown"` hiding bugs.

## Confidence

- seed.ts: high (the function name is `main`, the file is a CLI
  entrypoint, silent failure here is clearly wrong)
- toast-container: high (an empty `catch {}` is never the right
  disposition; even justified silence should log)
