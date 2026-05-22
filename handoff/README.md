# Kanban UI redesign — drop-in handoff

A focused refresh of the tickets kanban: same data model, same routes, same
`@dnd-kit` interactions — just a tighter, more modern look. Theme is
**Cool · Emerald** (cool-tinted whites, emerald accents, muted severity
chips). All other dashboard surfaces are unaffected.

## What's in this folder

```
handoff/apps/dashboard/app/
├── globals.additions.css                          ← append to globals.css
└── tickets/_components/
    ├── kanban-board.tsx                           ← replace
    ├── filters-bar.tsx                            ← replace
    └── sla-timer.tsx                              ← replace
```

`bulk-actions-bar.tsx` and the rest of the app are untouched.

## Apply

Each file lives at the same path it should land at in the repo, so a
single `cp -R` plus the CSS append gets you 90% of the way:

```bash
cd /path/to/bilingual-whatsapp-platform
cp -R /path/to/handoff/apps/dashboard/app/tickets/_components/* \
      agent-support-platform/apps/dashboard/app/tickets/_components/

cat handoff/apps/dashboard/app/globals.additions.css \
    >> agent-support-platform/apps/dashboard/app/globals.css
```

Then:

```bash
cd agent-support-platform
pnpm install         # no new dependencies, but worth running
pnpm --filter dashboard typecheck   # should be clean
pnpm --filter dashboard dev
```

Open `/tickets`. Drag a card across columns to confirm the optimistic
update + realtime resync still work end-to-end.

## What changed (and why)

### Visual system
- **Cool-emerald palette.** `slate-*` for neutrals, `emerald-*` for primary
  actions/accents, severity chips on muted backgrounds with a colored dot
  (`rose` / `orange` / `amber` / `slate`) instead of saturated badges.
- **Column markers** — small colored dots (sky / violet / amber / emerald)
  instead of tinted column backgrounds. Keeps the canvas calm; the cards
  carry the visual weight.
- **Cards round to `lg`** (8px) with a 1px ring instead of a border, and
  lift a pixel on hover with a soft shadow. Drag overlay gets a stronger
  shadow + 1° rotation so it reads as picked-up.

### Cards
- **Severity chip** now leads with a colored dot + the label, on a 50-tinted
  background with a faint ring — quieter than the original solid pills.
- **Country + language** — flag emoji + ISO code (`HT`/`DO`/`CD`) + the
  language code in a small mono pill (`ht`/`fr`/`es`). Tooltip carries the
  full label.
- **Bilingual preview** — translated text is the primary line; the
  agent's original (when distinct) sits below in italic with a dimmed left
  border. Gives triage the English snippet first but keeps Kreyòl / French /
  Spanish a glance away.
- **Connectivity dot** sits to the left of the agent name — emerald (online),
  amber (intermittent), grey (offline/unknown). Important context for
  Haiti/DRC where outages drive triage decisions.
- **Assignee avatar** moves to the right of the agent row. Initials on an
  oklch-derived tint computed from the user id, so colors stay distinct
  without a hand-maintained palette. Dashed-circle placeholder for unassigned.
- **Tags** become small mono pills; first 3 only (was the previous behavior).
- **Incident pill** is now a single rose-tinted row with the alert glyph +
  title. Same data, less visual cost.

### SLA timer (`sla-timer.tsx`)
- **Compact ring + label** — a circular progress arc that fills as the
  deadline approaches, with the remaining time tucked alongside (`23m`,
  `1h 12m`, `2d`). Overdue switches to `font-semibold` rose. Ring colors
  shift emerald → amber → rose past the 4h / 30m thresholds the original
  used, so the visual cue matches what the old text was already doing.
- **Same public props.** Existing call sites (the detail page) keep working;
  there are two new optional props (`size`, `showLabel`) for places that
  want just the ring.
- Tick interval relaxed to 30s. The ring's minute-granularity makes faster
  ticks a render waste and a battery cost.

### FiltersBar
- Wrapped in a rounded card with a subtle shadow so the row visually owns
  itself instead of floating loose above the columns.
- Search becomes a chip with an inline magnifier icon and an emerald focus
  ring (matches the rest of the form-focus language).
- Severity chips get a leading colored dot so they're scannable when
  active — same as the card chips.
- Country chips lead with the flag.

### Columns
- Sticky white header (with backdrop blur) so the column always reads as a
  header even after you scroll. Drop targets switch from a hard ring to a
  soft tinted ring matching that column's accent, which feels far less
  alarming during a normal drag.

## What did *not* change

- **No new dependencies.** Same `@dnd-kit`, same Tailwind classes (no
  custom plugin), same lucide-free policy — every icon is an inline SVG.
- **Same component exports.** `KanbanBoard`, `FiltersBar`, `SlaTimer`,
  `readFiltersFromParams`, `ActiveFilters` — names and shapes intact. The
  `tickets/page.tsx` doesn't need to change.
- **Same data flow.** Optimistic local state, `updateTicket` on drop,
  revert-on-error, realtime resync via the existing
  `RealtimeRefresh` host. Bulk-actions bar (untouched) keeps working.
- **`bulk-actions-bar.tsx`** isn't in this handoff because the only thing
  that would change is hex values, and it's already on a dark surface that
  looks fine. Happy to do a follow-up pass if you want.

## Suggested PR description

> ### Kanban: cool-emerald refresh
>
> Visual refresh of the tickets kanban — no behavior or data-flow changes.
> Tighter cards, bilingual message preview (translated primary, original
> dimmed), severity chip + connectivity dot + flag + lang code in the card
> chrome, SLA shown as a circular ring + remaining time.
>
> No new deps. Same component exports. `tickets/page.tsx` unchanged.
>
> Replaces: `kanban-board.tsx`, `filters-bar.tsx`, `sla-timer.tsx`.
> Appends a body bg rule to `globals.css`.
>
> Before/after screenshots: [attach]

## Follow-up ideas (not in this PR)

These are worth doing later but felt out of scope for a no-deps visual
refresh:

1. **Density toggle** (comfortable / compact) wired to a per-user pref.
2. **List view** alongside kanban, sharing filters. Useful when triaging a
   large incident cluster.
3. **Detail drawer** on the kanban instead of a full route push — keeps
   context when scanning many tickets. The current `/tickets/[id]` page
   would still exist as the deep-link target.
4. **Theme tokens.** Lift the palette into CSS variables in `globals.css`
   so it can flex without touching components (dark mode lands in a day).

Ping me when the PR's up.
