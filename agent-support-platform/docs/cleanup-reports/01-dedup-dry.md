# Cleanup Report 01 — Deduplication / DRY

Scope: `apps/api`, `apps/dashboard`, `packages/shared` in the
`agent-support-platform` workspace. Goal: collapse duplicates that
genuinely reduce complexity; leave duplication that is intentional or
domain-bounded.

## Implemented (high confidence)

### 1. `formatRelative(iso)` — 5 near-identical copies → single util
**Files:**
- `apps/dashboard/app/tickets/[id]/activity-panel.tsx:17-26`
- `apps/dashboard/app/tickets/[id]/_components/ticket-detail.tsx:30-39`
- `apps/dashboard/app/incidents/page.tsx:22-31`
- `apps/dashboard/app/incidents/[id]/_components/incident-detail-view.tsx:34-43`
- `apps/dashboard/app/knowledge/page.tsx:15-23` (slightly off — missing
  the `mins < 1 → "just now"` branch)

All five render "Xm ago / Xh ago / Xd ago" for activity timestamps. The
knowledge-page variant lacked the "just now" guard, which is a latent
inconsistency, not an intentional difference. Centralize to
`lib/date-format.ts → formatRelative`. Knowledge now also says
"just now" for fresh edits — a strict UX improvement.

**Confidence: high.** Bit-identical logic for 4/5 callers; the 5th
becomes more correct.

### 2. `formatTime` / `formatAbsolute` — 2 identical copies → single util
**Files:**
- `apps/dashboard/app/tickets/[id]/_components/ticket-detail.tsx:41-48`
  (named `formatTime`)
- `apps/dashboard/app/incidents/[id]/_components/incident-detail-view.tsx:45-52`
  (named `formatAbsolute`)

Same `toLocaleString` call with `{ month: "short", day: "numeric",
hour: "numeric", minute: "2-digit" }`. Two different names, identical
body. Consolidate to `lib/date-format.ts → formatAbsolute`. Keeping the
`formatAbsolute` name because the "Time" name is misleading (it
returns date + time).

**Confidence: high.** Identical implementation, single rendering
intent ("readable wall-clock stamp on detail surfaces").

## Considered, intentionally left alone

### `STATUS_LABEL` in `list-view.tsx` vs `conversation-list.tsx`
Looks like a duplicate but isn't: the list-view uses the full
"Waiting on agent" label; the conversation-list uses the abbreviated
"Waiting" because rows are narrow. Different display constraints,
different labels — unifying would either bloat the dense view or
hide info from the wide view.

### `COUNTRY_*` records in `filters-bar.tsx`, `kanban-board.tsx`,
`incidents/page.tsx`, `incident-detail-view.tsx`
Three slightly different shapes:
- `filters-bar.tsx` uses `"Dom. Republic"` (cramped chip)
- `kanban-board.tsx` adds `langLabel` (Kreyòl / Español / Français)
- `incidents/*` uses full `"Dominican Republic"`

Consolidating would force every caller to pick from a single shape,
which either drops the abbreviation or carries `langLabel` everywhere.
Each currently is < 5 lines and reads clearly inline. Pass.

### Per-route `if (!res.ok) throw new Error(...)` in `lib/api.ts`
Yes, it repeats 17×. But each call has a slightly different error
prefix ("Failed to fetch tickets", "Approve failed", etc.) and a few
have non-standard behavior — `fetchReplySuggestions` swallows errors
and returns `[]`. A generic `request()` wrapper would either lose the
specific prefixes or add a `errorPrefix` parameter knob — exactly the
"config knob that isn't needed" the hard rules prohibit. Inline string
literals are easier to read than a parameterized abstraction here.

### `parsePagination` in `apps/api/src/routes/tickets.ts`
Used by exactly one route. The other route that takes pagination
(`agents.ts`) just does `parseInt(limit as string)` without validation.
Extracting `parsePagination` to a shared util would be premature —
agents.ts may want different bounds (or none). Three similar lines
beat a premature abstraction; the rule of three isn't met.

### `agent: { include: { branch: true } }` Prisma include
Repeats 5× across routes/services but each is in a different Prisma
query context with different other includes. A shared include constant
would couple unrelated queries and make Prisma's relational typing
harder to read. Pass.

## Result

Net: −2 helpers, +1 small shared `lib/date-format.ts`, all callers
import from one place. Approx. −35 lines of duplicate code; one
sub-second UX bug fixed in the knowledge page (now shows "just now").
