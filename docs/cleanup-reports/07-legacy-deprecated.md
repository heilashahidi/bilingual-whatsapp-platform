# Cleanup Report 07 — Legacy / Deprecated / Fallback Code Paths

Agent 7 of 8. Scope: find deprecated, legacy, and fallback code paths and
remove them so every behavior has one canonical implementation.

Worktree base: `agent-support-platform/`

## Method

Searched for the standard markers across `apps/`, `packages/`, `scripts/`:

- Explicit markers: `@deprecated`, `// DEPRECATED`, `// LEGACY`, `// OLD`,
  `// TODO: remove`, `legacy*`, `_v1`, `_v2`, `*.bak`, `*.old`
- Side-by-side file pairs (`foo.ts` + `foo-v2.ts`, `Component` +
  `ComponentNew`)
- Feature flags that always evaluate one way
- Dual code paths gated by a long-defaulted toggle
- Migration helpers / backfill / one-off scripts
- Backwards-compat shims and re-exports under old names
- Cross-referenced `git log` for `migrate to X` / `replace Y` patterns

## Findings

### Catalog

| # | Location | Kind | Replacement adopted? | Safe to remove? |
|---|----------|------|----------------------|-----------------|
| 1 | `scripts/backfill-english-translations.ts` | One-off backfill script (commit `705a134`). Idempotent. Patches rows persisted before pipeline change `ed8969e`. | Yes — pipeline now skips Claude on English input and sets `translatedText = originalText` directly. | YES — remove |
| 2 | `scripts/delete-test-tickets.ts` | One-off cleanup script (commit `86b49a5`). Hard-codes the test agent name "Heila Shahidi" from the Twilio sandbox demo. | N/A — purpose served. | YES — remove |
| 3 | `apps/dashboard/lib/types.ts:54-57` `deliveryStatus?: DeliveryStatus` marked "Optional for forwards-compat with any cached old data." | Forwards-compat shim | API always returns it now (post-`20260523120000_add_delivery_status` migration); however the optional + null-safe consumer (`ticket-detail.tsx`) is harmless and removing it would force a `Required<>` change with no behavior benefit. | NO — leave (zero-risk, zero-cost) |
| 4 | `apps/api/src/integrations/translation.ts` header `To switch to production: 1. npm install @google-cloud/translate` etc. | Stale comment (real impl is Claude Haiku, not Google Translate) | n/a — comment-only | LEAVE (comment-only; not legacy code) |
| 5 | `apps/api/src/integrations/{translation,classification,whatsapp}.ts` `USE_REAL_*` env flags switching stub ↔ real | Dev/test stub vs prod path | Both paths are live: stub is the dev experience, real is prod. Tests rely on the flag. | LEAVE — active dev affordance |
| 6 | `apps/api/src/middleware/auth.ts` `DISABLE_AUTH` env flag | Test-only auth bypass | Used by `tickets.test.ts`, `incidents.test.ts`. | LEAVE — active test affordance |
| 7 | `apps/api/src/services/queue.ts` + `outbound-queue.ts` Redis → inline fallback | Graceful-degradation fallback | Inline path is the dev experience (no Redis container) AND the prod outage degrade path. Comments and tests confirm both are live. | LEAVE — graceful degradation, not legacy |
| 8 | `apps/api/src/services/kb-indexer.ts` Stage-2 mechanical fallback when Claude returns null | Graceful-degradation fallback | Both paths live. | LEAVE |
| 9 | `packages/shared/src/index.ts` `BOT_SESSION_TTL`, `CONNECTIVITY_THRESHOLDS`, `CLUSTERING_CONFIG` | Forward-looking config consts with zero call sites today | Docs (`ARCHITECTURE.md:672`, `CONNECTIVITY.md:71,130,136,145`) explicitly document these as "reserved for the future per-country tunables" / "queued for the next pass". | LEAVE — documented future-use config, not legacy |
| 10 | `apps/api/src/routes/webhooks.ts:119` `// TODO: If "delivered", update agent connectivity status to "online"` | TODO marker | Not legacy code — open work item. | LEAVE |
| 11 | `apps/api/src/services/message-normalizer.ts:61` `// TODO: Use WhatsApp timestamp when on Meta API` | TODO marker | Tied to a future platform migration (Twilio → Meta). | LEAVE |

### Things explicitly NOT found

- No `@deprecated` JSDoc tags anywhere
- No `*.bak`, `*.old`, `*-v1`, `*-v2`, `*Old.tsx` files
- No side-by-side `Foo` + `FooNew` component pairs
- No backwards-compat re-exports
- No dead feature-flag branches
- No `// was:`, `// used to`, `// no longer` archaeology comments

The codebase is unusually clean for legacy patterns — most "fallback"
paths are live graceful-degradation, not dead branches.

## Removals applied

1. `scripts/backfill-english-translations.ts` — deleted. Already ran in
   prod (per `705a134`), idempotent, condition is no longer reachable
   in the current pipeline.
2. `scripts/delete-test-tickets.ts` — deleted. One-off demo cleanup
   targeting a single hard-coded agent name; served its purpose.

## Items flagged but left

See rows 3–11 above. Two themes:
- "Fallback" in this codebase is overwhelmingly **live** graceful
  degradation (no-Redis dev, Claude-unavailable, etc.), not deprecated
  legacy.
- Forward-looking config (`CLUSTERING_CONFIG` and friends) is
  documented as intentional, not orphaned.
