# Unused code cleanup — report 03

Worktree: `agent-ace3e546bd51e4dc1`. Monorepo: pnpm workspace (`apps/api`,
`apps/dashboard`, `packages/shared`) orchestrated by turbo.

## Tools run

- `knip` 6.14.2 — primary
- `ts-prune` (per-tsconfig) — cross-check on declared exports
- `depcheck` — cross-check on dependency usage

All three were run via `pnpm dlx`. No `knip.json` was added — defaults gave
clean, accurate output for this codebase.

## Raw tool output summary

### knip

```
Unused files (4): scripts/*.ts
Unused dependencies (2): uuid (api), @asp/shared (dashboard)
Unused devDependencies (2): @types/express-serve-static-core, @types/uuid (api)
Unlisted dependencies (1): server-only (dashboard)
Unlisted binaries (1): prisma (root)
Unused exports (2):
  _resetTranslationCacheForTests  apps/api/src/integrations/translation.ts:64
  clearClientAuthCache            apps/dashboard/lib/auth-client.ts:26
Unused exported types (7):
  Branch, DeliveryStatus, SuggestedResolution, BotConversation,
  IncidentTicketSummary  apps/dashboard/lib/types.ts
  DensityPref, ViewPref  apps/dashboard/lib/ui-prefs.ts
```

### ts-prune

Confirmed the same two unused exports (`_resetTranslationCacheForTests`,
`clearClientAuthCache`). All other findings were "used in module" — declared
in a file and only used internally by that same file (still exported but never
imported elsewhere).

### depcheck

- api: unused `uuid`, `@types/express-serve-static-core`, `@types/uuid` (matches knip).
- dashboard: unused `@asp/shared` (matches knip); also flagged `@types/node`,
  `autoprefixer`, `postcss`, `typescript` — these are tooling devDeps required
  by Next.js / Tailwind / TS build and were ignored (false positives).

## Candidate-by-candidate verification

| Candidate | Tool agreement | Manual grep result | Decision | Confidence |
|---|---|---|---|---|
| `scripts/seed-demo-tickets.ts` | knip only | Documented in `docs/CONTRIBUTING.md` and `docs/ARCHITECTURE.md`; invoked via `tsx scripts/...` | KEEP | n/a |
| `scripts/seed-kb-articles.ts` | knip only | Documented in `CHANGELOG.md`, `docs/ARCHITECTURE.md`, `docs/CONTRIBUTING.md` | KEEP | n/a |
| `scripts/backfill-english-translations.ts` | knip only | Operational maintenance script; runnable via tsx | KEEP | n/a |
| `scripts/delete-test-tickets.ts` | knip only | Operational maintenance script | KEEP | n/a |
| `_resetTranslationCacheForTests` export | knip + ts-prune | Zero references anywhere (incl. tests) | REMOVE | high |
| `clearClientAuthCache` export | knip + ts-prune | Zero references anywhere | REMOVE | high |
| `uuid` (api dep) | knip + depcheck | No `from 'uuid'` or `require('uuid')` in `apps/api/src` | REMOVE | high |
| `@types/uuid` (api devDep) | knip + depcheck | Follows `uuid` removal | REMOVE | high |
| `@types/express-serve-static-core` (api devDep) | knip + depcheck | No direct import, but **required for declaration emit** — tsc errored TS2742 ("inferred type of 'router' cannot be named without a reference to ...") when removed because `apps/api` has `declaration: true` | KEEP | reverted |
| `@asp/shared` (dashboard dep) | knip + depcheck | Zero imports anywhere under `apps/dashboard/` | REMOVE | high |
| `Branch`, `DeliveryStatus`, `SuggestedResolution`, `BotConversation`, `IncidentTicketSummary` (types) | knip + ts-prune ("used in module") | Used inside `lib/types.ts` itself but never imported from another file | KEEP | low-confidence to remove |
| `DensityPref`, `ViewPref` (types) | knip + ts-prune ("used in module") | Used inside `lib/ui-prefs.ts` itself but never imported elsewhere | KEEP | low-confidence to remove |

## Do not remove (with reasoning)

- **`scripts/*.ts`** — invoked directly via `tsx scripts/<file>.ts` for
  operational tasks (seeding, backfills, cleanup). Knip can't trace these
  because there's no script entry in `package.json`. Documented in
  `docs/CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, and `CHANGELOG.md`.
- **Exported types still in `lib/types.ts` / `lib/ui-prefs.ts`** — these are
  declarative type definitions describing the dashboard's data model. They are
  used internally by the file's other exported types/interfaces (so removing
  `export` would require restructuring). Conservative call: leaving a few
  unimported type aliases costs ~0 bytes at runtime and risks zero regressions.
- **`server-only`** — knip flags it as *unlisted* (used in
  `apps/dashboard/lib/auth-server.ts` but not in `package.json`). It is a
  zero-runtime sentinel re-exported by Next.js itself; not a true gap.
- **`@types/node`, `autoprefixer`, `postcss`, `typescript`** (depcheck false
  positives on dashboard) — required by Next.js build, Tailwind's PostCSS
  pipeline, and the TS compiler respectively. Not in source `import`s, but
  load-bearing for the toolchain.
- **`prisma` binary** flagged as unlisted at root — it's invoked via
  `npx prisma` inside `apps/api/db:*` scripts. Listed in `apps/api`
  devDependencies, just not at root. Correct as-is.

## Implementation

Removed in one commit:

- `_resetTranslationCacheForTests` from `apps/api/src/integrations/translation.ts`
- `clearClientAuthCache` from `apps/dashboard/lib/auth-client.ts`
- `uuid` and `@types/uuid` from `apps/api/package.json`
- `@asp/shared` from `apps/dashboard/package.json` (it's still present in
  `apps/api/package.json`, where it's actually imported)

Verified after each change: `tsc --noEmit` clean for both apps, vitest passes
(16 files / 156 tests).

### Reverted candidate

`@types/express-serve-static-core` was flagged by both knip and depcheck. When
removed, `tsc --noEmit` failed with TS2742 across every route file and
`server.ts`: "The inferred type of 'router' cannot be named without a reference
to '@types+express-serve-static-core...'". This is because `apps/api/tsconfig.json`
has `declaration: true` — emitting `.d.ts` files needs the express-serve-static-core
types to be explicitly resolvable, even though no source file imports them
directly. Restored.

Lesson for future cleanup passes on this repo: when `declaration: true` is set,
type-only transitive deps may be load-bearing and need a typecheck verification
gate beyond depcheck/knip alone.
