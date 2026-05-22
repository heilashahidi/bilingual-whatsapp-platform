# Kanban UI redesign — handoff v2

A focused refresh of the tickets kanban with three new feature surfaces:

1. **Cool · Emerald visual refresh** (kanban card, columns, filters, SLA timer)
2. **UI prefs** — view (kanban/list), density (comfortable/compact), bilingual toggle. Persisted to localStorage.
3. **New outreach ticket modal** — support-team-initiated thread with auto-translation. (Requires two new backend endpoints — flagged below.)

Same dnd-kit, same Tailwind, no new npm dependencies. Drop-in replacement.

---

## What's in this folder

```
handoff/apps/dashboard/
├── app/
│   ├── globals.additions.css                       ← APPEND to globals.css
│   └── tickets/
│       ├── page.tsx                                ← REPLACE (now renders TicketsShell)
│       └── _components/
│           ├── tickets-shell.tsx                   ← NEW (client shell, owns prefs+modal state)
│           ├── page-header.tsx                     ← NEW (title + view/density/bilingual + New Ticket)
│           ├── kanban-board.tsx                    ← REPLACE (now accepts density+bilingual props)
│           ├── list-view.tsx                       ← NEW (tabular alternative to kanban)
│           ├── filters-bar.tsx                     ← REPLACE
│           ├── sla-timer.tsx                       ← REPLACE (now a ring + label)
│           └── new-ticket-modal.tsx                ← NEW (outreach ticket flow)
└── lib/
    ├── ui-prefs.ts                                 ← NEW (localStorage prefs hook)
    └── api.additions.ts                            ← APPEND to lib/api.ts
```

`bulk-actions-bar.tsx`, `realtime-refresh.tsx`, `auth.ts`, and everything else are unchanged.

---

## Apply (frontend only — works immediately)

```bash
cd /path/to/bilingual-whatsapp-platform/agent-support-platform/apps/dashboard

# Replace + add components
cp -R /path/to/handoff/apps/dashboard/app/tickets/_components/* \
      app/tickets/_components/
cp    /path/to/handoff/apps/dashboard/app/tickets/page.tsx \
      app/tickets/page.tsx

# New hooks/utilities
cp    /path/to/handoff/apps/dashboard/lib/ui-prefs.ts \
      lib/ui-prefs.ts

# Append the body bg rule and the new api.ts functions
cat   /path/to/handoff/apps/dashboard/app/globals.additions.css \
      >> app/globals.css
cat   /path/to/handoff/apps/dashboard/lib/api.additions.ts \
      >> lib/api.ts

pnpm typecheck
pnpm dev
```

Open `/tickets`. The kanban renders with the new visual system; the header has view/density/bilingual toggles + a "New ticket" button. Toggle to list view, change density to compact — both prefs survive a refresh.

---

## What changed (and why)

### Visual system — `kanban-board.tsx`, `filters-bar.tsx`, `sla-timer.tsx`
- **Cool-emerald palette.** `slate-*` for neutrals, `emerald-*` for primary actions, severity chips on muted backgrounds with a colored dot (`rose` / `orange` / `amber` / `slate`).
- **Column markers** — small colored dots (sky / violet / amber / emerald) instead of tinted column backgrounds.
- **Cards round to `lg`**, ring instead of border, lift on hover, soft shadow. Drag overlay has a stronger shadow.
- **Severity chip** — colored dot + label on tinted-50 bg with a faint ring.
- **Country + language** — flag emoji + ISO code (`HT`/`DO`/`CD`) + the language code in a small mono pill.
- **Bilingual message preview** — translated primary, agent's original in italic below with a dimmed left border.
- **Connectivity dot** — emerald (online, with a pulsing `animate-ping` halo), amber (intermittent), grey (offline/unknown).
- **Assignee avatar** — initials on an oklch hue derived from the user id. Dashed-circle placeholder when unassigned.
- **Incident pill** — single rose-tinted row.
- **Resolution-summary pill** — on resolved cards. (Requires `resolutionSummary` to be included in the list-endpoint response — see Backend dependencies below.)
- **SLA timer** — compact circular ring + label. Fills as deadline approaches. Emerald → amber → rose. Same public props as the old timer.

### UI prefs — `ui-prefs.ts`, `tickets-shell.tsx`, `page-header.tsx`
- **`useUiPrefs()`** hook stores `{ density, bilingual, view }` in `localStorage` under `tickets.uiPrefs.v1`. Defaults applied on first paint to avoid SSR mismatches. Swap to a server-side preferences endpoint later without changing the hook shape.
- **`PageHeader`** renders the title + total count + three controls + the New Ticket button. View and density use icon segmented controls; bilingual is a single pill toggle.
- **`TicketsShell`** is the new client component that holds the prefs state and the modal-open state. It renders `KanbanBoard` or `ListView` based on `prefs.view`, passing `density` and `bilingual` to both.

### List view — `list-view.tsx`
- Tabular layout with the same 7 columns as Linear/Asana-style ticket tables: Ticket, Agent, Status, Severity, Country, Assignee, SLA.
- Honors `bilingual` (shows original under the translated snippet) and `density` (`py-2` vs `py-2.5`).
- Shares the FiltersBar URL params with the kanban — switch views and your filters carry over.
- Selection isn't supported here yet; the `BulkActionsBar` is still kanban-only. Easy follow-up: lift `selected: Set<string>` into the shell and pass it to both views.

### New outreach ticket — `new-ticket-modal.tsx`
- Three-step compact form in a centered modal: pick agent → write English message → set severity/category → send.
- **Agent picker** is a search-as-you-type combobox against `GET /api/agents?q=…`. Shows flag + name + branch + phone in each result.
- On submit, posts to `POST /api/tickets/outreach` with `{ agentId, message, severity, category }`. On success, refreshes the route and navigates to the new ticket so the support person can keep replying.
- Esc closes. Body scroll locked while open. Errors shown inline.

---

## Backend dependencies (required for full functionality)

These are flagged inline in `lib/api.additions.ts`. The frontend ships safely without them — failures just surface as inline errors.

### 1. `GET /api/agents?q=<string>&limit=<n>`
Returns `{ agents: Agent[] }`. Search agents by `name`, `phoneNumber`, or `branch.name` (ILIKE). Powers the agent picker.

### 2. `POST /api/tickets/outreach`
Body: `{ agentId, message, severity, category, tags? }`. Steps:
1. Translate `message` from English → agent's `preferredLanguage` via the existing translation pipeline.
2. Send the translated text via Twilio WhatsApp.
3. Create the `Ticket` with `status="open"`, attach the outbound message (`direction="outbound"`, `senderType="internal_user"`).
4. Compute `slaFirstResponseDeadline` using the country-specific SLA config.

Returns the created `Ticket` (same shape as `fetchTicket`).

### 3. List-response field — `resolutionSummary`
The resolution-summary pill on resolved kanban cards reads `ticket.resolutionSummary`. Today that field only exists on `TicketDetail` (single-ticket fetch). Two edits:

**`lib/types.ts`**
```ts
export interface Ticket {
  // ...
  resolvedAt: string | null;
  resolutionSummary: string | null;   // ← add
  // ...
}
```

**`apps/api/src/routes/tickets.ts`** — add `resolutionSummary: true` next to `resolvedAt: true` in the Prisma `select` block for the list query.

---

## What did *not* change

- **No new npm deps.** Same `@dnd-kit`, Tailwind, lucide-free policy. Every icon is an inline SVG.
- **Same component names + exports.** `KanbanBoard`, `FiltersBar`, `SlaTimer`, `BulkActionsBar`. (New: `TicketsShell`, `PageHeader`, `ListView`, `NewTicketModal`, `useUiPrefs`.)
- **Same data flow.** Optimistic local state on kanban drop, `updateTicket` PATCH, revert-on-error, realtime resync via the existing `RealtimeRefresh` host.
- **Same auth.** All new endpoints use the existing `authHeaders()` helper.
- **`bulk-actions-bar.tsx`** is unchanged — it lives over both views fine.

---

## Suggested PR description

> ### Kanban: cool-emerald + list view + outreach tickets
>
> Three things, one PR:
>
> 1. Visual refresh of the kanban (cool-emerald palette, ring SLA, bilingual preview, pulsing connectivity).
> 2. View toggle (kanban / list), density toggle, bilingual toggle. Persisted per-user in localStorage. New tabular list view shares filters with the kanban.
> 3. "New ticket" modal — support-initiated outreach to an agent. Auto-translates the first message to the agent's language and creates the ticket as if the agent had opened it.
>
> Frontend ships without backend changes. To light up the outreach modal, add two API endpoints (see `handoff/README.md` § Backend dependencies). To light up the resolution-summary pill on resolved cards, include `resolutionSummary` in the list-tickets response.
>
> No new npm deps. Same component exports — `tickets/page.tsx` is the only existing file beyond `_components/` that changed.

---

## Files in this handoff that don't have a "Replace" target

These are pure additions — no existing file to merge with:

- `app/tickets/_components/tickets-shell.tsx`
- `app/tickets/_components/page-header.tsx`
- `app/tickets/_components/list-view.tsx`
- `app/tickets/_components/new-ticket-modal.tsx`
- `lib/ui-prefs.ts`

Just `cp` them into place.

Ping when the PR's up.
