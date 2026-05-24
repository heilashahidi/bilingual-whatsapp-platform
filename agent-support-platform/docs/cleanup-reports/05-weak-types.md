# Cleanup #5 — Weak Types

Codebase: TypeScript monorepo (`agent-support-platform`). Two TS projects:
- `apps/api` (Node/Express, Prisma)
- `apps/dashboard` (Next.js)

Both `tsconfig.json` files have **`strict: true`** (implies `noImplicitAny` and
`strictNullChecks`). Baseline: `tsc --noEmit` is clean on both projects.

## Tally (before)

Total weak-type occurrences found in source (excluding `node_modules`,
`.next`, `dist`): **15 `any` / `as any` / `Function`**.

| Category               | Count | Notes                              |
| ---------------------- | ----: | ---------------------------------- |
| `: any` (variable)     |     4 | `where: any`, `data: any`, `messageParams: any` |
| `as any` (cast)        |    10 | Bridging string-literal → Prisma enum, JSON column |
| `: Function` (param)   |     1 | Express `next` middleware callback |
| `unknown`              |   ~6  | All deliberate at boundaries — KEEP |
| `as unknown as X`      |   ~5  | All in test files (mock laundering) — KEEP |
| `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` | 0 | none |
| `: Object`             |     0 | none |
| `<any>` generic args   |     0 | none |
| Dashboard weak types   |     0 | clean                              |

## Per-file findings

### High-confidence replacements (will fix)

| File | Line | Current | Correct type | Confidence |
| --- | ---: | --- | --- | --- |
| `apps/api/src/routes/webhooks.ts` | 18 | `next: Function` | `next: NextFunction` (already imported via `express`) | high |
| `apps/api/src/routes/agents.ts` | 17 | `const where: any = {}` | `Prisma.AgentWhereInput` | high |
| `apps/api/src/routes/tickets.ts` | 57 | `const where: any = { deletedAt: null }` | `Prisma.TicketWhereInput` | high |
| `apps/api/src/routes/tickets.ts` | 266 | `const data: any = {}` | `Prisma.TicketUpdateInput` | high |
| `apps/api/src/integrations/whatsapp.ts` | 63 | `const messageParams: any = {…}` | `MessageListInstanceCreateOptions` from twilio | high |
| `apps/api/src/services/message-pipeline.ts` | 61 | `defaultLanguage as any` | drop — `"ht"\|"fr"\|"es"` already matches `Prisma.Language` | high |
| `apps/api/src/services/message-pipeline.ts` | 153 | `raw.contentType as any` | drop — `RawMessage.contentType` already matches `Prisma.ContentType` | high |
| `apps/api/src/services/message-pipeline.ts` | 207 | `"en" as any` | drop — `"en"` matches `Prisma.Language` | high |
| `apps/api/src/services/message-pipeline.ts` | 228 | `translationResult.value.detectedLanguage as any` | typed string from translateMessage; needs narrowing to `Language` | medium |
| `apps/api/src/services/message-pipeline.ts` | 272 | `originalLanguage: detectedLanguage as any` | drop — `Language` enum (after narrowing above) | high |
| `apps/api/src/services/message-pipeline.ts` | 275 | `classification as any` | `classification as Prisma.InputJsonValue` (column is `Json?`) | high |
| `apps/api/src/services/message-pipeline.ts` | 294 | `classification.category as any` | drop — already `TicketCategory` literal | high |
| `apps/api/src/services/message-pipeline.ts` | 295 | `classification.severity as any` | drop — already `Severity` literal | high |
| `apps/api/src/services/message-pipeline.ts` | 324 | `classification.category as any` | drop — already `TicketCategory` literal | high |
| `apps/api/src/services/message-pipeline.ts` | 325 | `classification.severity as any` | drop — already `Severity` literal | high |

### Deliberate skips (acceptable boundary types — KEEP)

| File | Line | Type | Reason |
| --- | ---: | --- | --- |
| `apps/api/src/integrations/slack.ts` | 13 | `blocks?: unknown[]` | Slack Block Kit is a sprawling discriminated union; modeling it is out of scope for a single helper. Boundary type. |
| `apps/api/src/services/database.ts` | 28, 37 | `err: unknown` etc. | Standard catch-block typing; narrowed before use. |
| `apps/api/src/services/outbound-pipeline.ts` | 55 | `err: unknown` | Same. |
| `apps/api/src/routes/incidents.ts` | 15 | `parseStatus(v: unknown)` | Correct — input from `req.query`. |
| `apps/api/src/routes/tickets.ts` | 26-27 | `parsePagination(rawLimit: unknown, rawOffset: unknown)` | Correct — `req.query` values. |
| `apps/api/src/services/queue.test.ts` | 24, 46 | `(...args: unknown[]) => void` | Redis event handlers have varied arg shapes. |
| `apps/api/src/services/kb-search.test.ts` | 10, 38 | `ops: unknown[]` | Prisma transaction array — varied. |
| `apps/api/src/services/*.test.ts` and `webhooks.test.ts` | various | `as unknown as fetch / vi.fn` | Standard test-mock laundering. Replacing with full mock types would obscure the test intent. |

## Plan

1. Replace `next: Function` with `NextFunction`.
2. Use `Prisma.{Agent,Ticket}WhereInput` and `Prisma.TicketUpdateInput`.
3. Replace `messageParams: any` with twilio's `MessageListInstanceCreateOptions`.
4. Drop redundant `as any` casts to Prisma enums (the source values are already
   string-literal unions that match the enum exactly).
5. Replace `classification as any` with `classification as Prisma.InputJsonValue`
   (the column is `Json?`).
6. Narrow `detectedLanguage` to `Language` via a small guard before assignment.
7. Run `tsc --noEmit` after each batch; commit per batch.

## Tally (after)

| Category               | Before | After | Notes                |
| ---------------------- | -----: | ----: | -------------------- |
| `: any` (variable)     |      4 |     0 | replaced with `Prisma.{Agent,Ticket}WhereInput`, `Prisma.TicketUncheckedUpdateInput`, `MessageListInstanceCreateOptions` |
| `as any` (cast)        |     10 |     0 | nine dropped outright (the source values already matched the Prisma enum literals); one replaced with a typed `as object as Prisma.InputJsonValue` for the `Json?` column |
| `: Function`           |      1 |     0 | replaced with `NextFunction` |
| `@ts-ignore` / etc.    |      0 |     0 | none to start                  |

`tsc --noEmit` clean on `apps/api` and `apps/dashboard`. All 156 vitest tests pass.

### Bonus hardening

While replacing `where: any`, I added small validators (`parseTicketStatus`,
`parseSeverity`, `parseCategory`) to narrow query-string inputs against the
Prisma enum sets — mirroring the existing pattern in `routes/incidents.ts`.
Previously the route would forward whatever string the client sent straight
into a Prisma filter. The `country` filter (free-form string) is now
constrained to `"HT" | "DO" | "CD"`. These were not the assigned scope (they
came in because the typed `WhereInput` refused unvalidated strings), so the
behavior change is: invalid values are silently ignored instead of being
forwarded to Prisma — Prisma would also have rejected them, but at runtime.
