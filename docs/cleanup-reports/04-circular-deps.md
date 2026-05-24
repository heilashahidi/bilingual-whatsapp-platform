# Cleanup Report 04 — Circular Dependencies

Agent #4 of 8. Worktree: `agent-a269b9736935ea8bd`.

## Phase 1 — Research

### Tooling

Ran `npx madge --circular --extensions ts,tsx --ts-config tsconfig.json` against
each TypeScript root in the monorepo:

| Root                              | Files scanned | Cycles |
| --------------------------------- | ------------- | ------ |
| `apps/api/src/`                   | 47            | 2      |
| `apps/dashboard/`                 | 48            | 0      |
| `packages/shared/src/`            | 1             | 0      |

`tsc --noEmit` produced no `Circular dependency` warnings — TypeScript only flags
cycles that affect emit ordering, not import-graph cycles in general.

All cycles live in `apps/api/src/services/`. The dashboard and shared package
are clean.

### Cycles found (raw madge output)

```
1) services/outbound-queue.ts > services/outbound-pipeline.ts
2) services/outbound-queue.ts > services/queue.ts > services/message-pipeline.ts
```

### Per-cycle analysis

#### Cycle 1: outbound-queue ↔ outbound-pipeline

Chain:

- `outbound-queue.ts` imports the **runtime** function `processOutboundMessage`
  from `outbound-pipeline.ts` (used in the inline/fallback path when Redis is
  unavailable, and in the catch branch of `q.add`).
- `outbound-pipeline.ts` imports the **type** `OutboundJob` from
  `outbound-queue.ts` (function parameter shape only).

Category: (b) one direction is types-only. The pipeline file already uses
`import type { OutboundJob }`, so TypeScript erases it at runtime. Madge still
flags it because the *source* import graph contains the edge — it isn't
configured here to drop type-only imports, and even when it is, it's good
hygiene to put a shared contract in its own file rather than re-exporting it
from a side that depends on the other.

Recommended fix: **extract the `OutboundJob` interface into its own file**
(`outbound-types.ts`) that both `outbound-queue.ts` and `outbound-pipeline.ts`
import. This breaks the cycle structurally and survives any future change that
turns the type into a value (zod schema, runtime guard, etc.).

Confidence: high.

#### Cycle 2: outbound-queue → queue → message-pipeline → outbound-queue

Chain:

- `outbound-queue.ts` imports `getQueueConnection` from `./queue` (to share the
  Redis connection singleton).
- `queue.ts` imports `processInboundMessage` from `./message-pipeline` (used in
  the inline-fallback path inside `enqueueInbound`).
- `message-pipeline.ts` imports `enqueueOutbound` from `./outbound-queue` (the
  auto-intake step queues an outbound reply at the tail of the inbound
  pipeline).

Category: (d) shared state held in a module that should be lifted out.

The Redis connection singleton (`connection`, `connectionHealthy`,
`initQueueIfNeeded`, `getQueueConnection`) is what makes `outbound-queue` need
to import `queue.ts` in the first place. That singleton is *infrastructure* —
it has no business logic. The pipelines and per-queue modules should all
depend on it, not on each other.

Recommended fix: **extract the Redis connection helpers into a new
`redis-connection.ts` module.** Then:

- `outbound-queue.ts` imports `getQueueConnection` from `./redis-connection`
  (instead of `./queue`) — the offending edge disappears.
- `queue.ts` keeps importing `processInboundMessage` (inbound fallback).
- `message-pipeline.ts` keeps importing `enqueueOutbound` (auto-intake).
- `queue-worker.ts` and `outbound-worker.ts` also move their
  `getQueueConnection` import to `./redis-connection`.
- `server.ts` keeps `closeQueue` from `./queue` — but `closeQueue` now needs to
  also close the connection, so it calls into `redis-connection`. (One-way
  edge, no cycle.)

This is the inversion the codebase already gestures at — `queue.ts`'s comment
calls it "Inspection helpers — used by the worker module and tests," i.e. it
admits the connection isn't really part of the inbound-queue's responsibility.

Confidence: high. No new framework patterns, no DI container, no event
emitters — just a low-level utility file that both queue modules and both
workers import.

## Phase 2 — Plan summary

| Cycle | Fix technique                         | Files added | Files modified                                                                       |
| ----- | ------------------------------------- | ----------- | ------------------------------------------------------------------------------------ |
| 1     | Extract shared type (`OutboundJob`)   | `outbound-types.ts` | `outbound-queue.ts`, `outbound-pipeline.ts`, `outbound-worker.ts` |
| 2     | Extract Redis connection singleton    | `redis-connection.ts` | `queue.ts`, `outbound-queue.ts`, `queue-worker.ts`, `outbound-worker.ts` |

No cycles intentionally left.

## Phase 3 — Implementation

Done in two atomic commits (one per cycle). After each, ran
`npx madge --circular --extensions ts,tsx --ts-config tsconfig.json src/` and
`npx tsc --noEmit` to confirm the cycle was gone and no new tsc errors
appeared in the touched files. (The 41-line pre-existing tsc baseline is
unrelated `any`/`prisma generate` noise tracked by other cleanup agents.)
