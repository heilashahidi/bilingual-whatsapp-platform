# Cleanup Report — AI Slop / Stubs / Comments

Agent 8 of 8. Scope: removing noise / in-motion / larp / dead-stub comments;
keeping or tightening genuinely useful WHY comments. No code logic touched.

## Overall feel

The codebase is unusually well-commented for an AI-assisted greenfield repo.
Most block comments explain a real WHY (Neon suspend retry, BullMQ stall
recovery, optimistic drag-drop race with realtime, direction-aware bilingual
view, etc.). The bulk of removable slop is **decorative section banners** of
the form `// ─── Routes ─────────────────` and a handful of restate-the-code
single-liners.

## Counts (rough)

| Category | Rough count |
|---|---|
| (a) NOISE — decorative banners + restate-the-code | ~85 |
| (b) IN-MOTION — "Old code did X" / scratch reasoning | ~5 |
| (c) STUB — dead placeholder code | 0 (all "stubs" are intentional dev-mode fallbacks behind env flags) |
| (d) LARP — overconfident or wrong docblocks | 0 found |
| (e) USEFUL — keep / tighten | ~150 |

Total comment lines pre-pass: ~1500.
Removable noise/in-motion: ~90 lines.
Targeted removal: ~90 (≈6% of all comment lines). The rest is real content.

## Notable examples by category

### (a) NOISE — decorative banners (REMOVE)

Pattern: `// ─── <section name> ─────────────────` immediately above a route
handler whose name already says the same thing.

- `apps/api/src/server.ts:24,31,42,57` — Middleware / Health / Routes / Start
- `apps/api/src/routes/tickets.ts:14,108,141,249,335,403,441,548,580` — one
  banner per route, restates the HTTP verb + path that's already on the line
- `apps/api/src/routes/incidents.ts:21,50,81`
- `apps/api/src/routes/users.ts:6`
- `apps/api/src/routes/agents.ts:6,40`
- `apps/api/src/integrations/translation.ts:19,107,190`
- `apps/api/src/integrations/classification.ts:21,104`
- `apps/api/src/services/incident-clusterer.ts:6,48,74,89`
- `apps/api/src/services/queue.ts` (header block intro lines)
- `apps/api/prisma/seed.ts:8,32,74,101` — `// ─── Branches ───`, etc.
- `scripts/seed-demo-tickets.ts:60,146,225,304` — language headers
- `scripts/seed-kb-articles.ts:55,137`
- `packages/shared/src/index.ts:1,19,41,68,83,94` — type-section banners
- `apps/dashboard/lib/api.ts:239,262,292`
- `apps/dashboard/app/tickets/_components/new-ticket-modal.tsx:189,202`
- `apps/dashboard/app/tickets/_components/page-header.tsx:126`

### (a) NOISE — restate-the-code single-liners (REMOVE)

- `apps/api/src/services/realtime.ts:4` — `// Module-level singleton…`
  (file is 27 lines; comment restates the variable declaration immediately
  below)
- `apps/api/src/services/message-normalizer.ts:31` — `// Extract phone number
  from Twilio's "whatsapp:+509XXXXXXXX" format` — restates the `.replace`
  call below
- `apps/api/src/services/incident-clusterer.ts:41` — `// already clustered`
  (restates the guard immediately above)
- `apps/api/src/integrations/classification.ts:117` — `// Simple keyword
  matching for dev`
- `apps/api/src/integrations/translation.ts:196` — `// Simple language
  detection heuristic for dev`
- `apps/api/src/integrations/translation.ts:212` — `// Very rough heuristic
  — just for dev` (file already says "Development stub" above)

### (b) IN-MOTION (REMOVE)

- `apps/dashboard/app/tickets/_components/kanban-board.tsx:374-379` — "Old
  code naively read translatedText, which showed FOREIGN text on tickets
  whose latest message was an operator reply — the bug the user kept
  seeing." Direction-aware logic is fine — the explanation of how it used
  to be wrong is scratch reasoning.
- `apps/dashboard/app/tickets/[id]/_components/ticket-detail.tsx:191-194` —
  `// Keep secondary defined so the JSX block below stays valid; it never
  renders because showSecondary is now always false.` Refactor leftover.
- `apps/dashboard/lib/api.ts:74-77` — `// The API now queues the Twilio
  send…` — "now" framing reads as a migration note. Tightenable.
- `apps/api/src/routes/webhooks.ts:11` — `// In production, always validate.
  Skip in dev if needed.` Restates the env-flag below.

### (c) STUBS — flagged, NOT removed

Every "stub" I found is an intentional fallback behind a runtime env flag,
not dead placeholder code. Flagging for review but **leaving in place**:

- `apps/api/src/integrations/translation.ts` — `translateStub` is the
  active default until `USE_REAL_TRANSLATION=true`. Used by tests.
- `apps/api/src/integrations/classification.ts` — `classifyStub` likewise,
  default until `USE_REAL_CLASSIFICATION=true`.
- `apps/api/src/integrations/whatsapp.ts:55-58` — emits `STUB_<timestamp>`
  SID when `USE_REAL_WHATSAPP=false`. Used by dev + tests.
- `apps/api/src/integrations/slack.ts:19-22` — logs to console when
  `SLACK_WEBHOOK_URL` is unset.
- `apps/api/src/routes/webhooks.ts:126-134` — `POST /webhooks/slack` is an
  intentional 200-and-discard endpoint (Slack requires an Interactivity
  URL even if buttons are URL-only). Could plausibly look like a stub but
  the existing comment explains it. Keeping the comment.
- `apps/api/prisma/seed.ts` — `STUB_HT_001` style whatsappMessageIds for
  seed data. Not production code.

### (d) LARP

None found that I'd call out. The "in production / in development" headers
on `translation.ts` and `classification.ts` could be read as larp ("In
production: Google Cloud Translation API v3") but the same file imports
nothing toward that path, so it's mildly aspirational — keeping it as a
forward-looking note rather than a lie.

### TODOs

Two TODOs, both with real context — keep both:

- `apps/api/src/services/message-normalizer.ts:61` — `// TODO: Use WhatsApp
  timestamp when on Meta API`
- `apps/api/src/routes/webhooks.ts:119` — `// TODO: If "delivered", update
  agent connectivity status to "online"`

## Console.log triage

Not removed. All `console.*` calls in non-test src are either:
- server-startup info lines (`✓ API server running on …`)
- intentional error logging that surfaces in Railway logs
- stub-mode dev signal lines (e.g. `[STUB] Translate: …`)

There's no `console.log("here")` style debug leftover.

## Plan

Targeted commits, each scoped to a directory, with typecheck after each:

1. Strip decorative banners + restate-the-code one-liners across all
   files listed above.
2. Strip the IN-MOTION scratch comments in dashboard kanban + ticket-detail
   + api.ts + webhooks.ts.
3. Final typecheck + git status.
