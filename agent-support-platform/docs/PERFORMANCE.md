# Performance Benchmarks

This document covers the six benchmarks called out in the PRD §3.2.
Each section names what we measured, how, and the result — and is
honest about which numbers are *measured* against the live deployment
versus *projected* from a single component's behavior.

> **Test environment**
> - API: `nclusion-api.up.railway.app` — Railway, 1 vCPU shared, 512 MB
> - (Earlier measurements in this doc were taken against the parallel Fly.io deploy at `heilashahidi.fly.dev` — same code, same Neon DB, comparable VM size — and are within ~50ms of the Railway numbers.)
> - DB: Neon Postgres (free tier, pooled connection, region `us-east-2`)
> - Redis: Upstash (free tier, region `us-east-1`)
> - LLM: Anthropic Claude Haiku 4.5 (`claude-haiku-4-5-20251001`)
> - Test client: macOS, residential connection in the eastern US
> - All numbers below were taken on 2026-05-22.

---

## 1. Message ingestion latency

**Definition (PRD).** Time from agent sending a WhatsApp message to it
appearing in the system (visible on the dashboard).

**Pipeline.** A single inbound message walks through `apps/api/src/services/message-pipeline.ts` in this order (reordered in 0.4.0 to emit a socket event before the LLM work — see "Early socket emit" below):

1. Dedup lookup (`Message.findUnique` by `whatsappMessageId`)
2. Agent lookup / auto-register + `lastSeenAt` update
3. **Find or create ticket** (with placeholder `category: 'other'` / `severity: 'medium'` if new)
4. **Persist raw message** (translated text = original, classification = null)
5. **First Socket.IO `ticket:changed` broadcast — dashboard renders here**
6. Translate via Claude Haiku → English **and** classify in parallel via `Promise.allSettled`
7. Patch the message row with translation + classification; reconcile ticket category/severity (and split into a new ticket if the new message's category differs from an appended-to existing one)
8. KB lookup + Slack notify + auto-intake enqueue (all fire-and-forget) on new tickets
9. **Second Socket.IO `ticket:changed` broadcast** — dashboard refetches with enriched data
10. Incident clustering (fire-and-forget)

Step 6 still dominates wall clock (two LLM calls in parallel). Steps 1–5 are the *visible* path now — DB writes against Neon plus an in-process emit, finishing in tens of ms.

**Measured.**

| Step | Median | Source |
|---|---|---|
| Twilio → API edge | ~90 ms (warm) | `curl /health` × 5, see appendix |
| `prisma.findUnique` dedup | < 5 ms | Prisma logs |
| `isLikelyEnglish` heuristic | < 1 ms | In-process regex check |
| Translation (Claude Haiku) | **~750 ms** uncached / **~0 ms** on LRU cache hit / skipped if source is English | Per-call timing in `translation.ts`; cache shipped in 0.4.0 |
| Classification (Claude Haiku) | **~700 ms** | Per-call timing in `classification.ts` |
| Ticket + Message inserts | < 20 ms total | Two indexed writes |
| Socket.IO broadcast | < 5 ms | In-process emit |
| Twilio send (outbound) | ~300 ms p50, 10 s ceiling | `Promise.race` timer added in 0.4.0 — replaces Node's ~2 min default |

**English-message fast path.** The pipeline runs the
`isLikelyEnglish` heuristic before calling Claude for translation
(`services/language-detection.ts`). When it returns true,
`translatedText = originalText` and the LLM call is skipped — saving
~750 ms and one Anthropic API call per English inbound message.
Non-English inbound messages still pay the full translation cost.

**Neon free-tier auto-suspend.** Neon's free tier puts the compute to
sleep after ~5 minutes of inactivity. The first DB call after suspension
fails with `SqlState(E57P01)` and Neon wakes the database in
~100–500 ms. To absorb this, the Prisma client is wrapped with a
single-retry helper (`apps/api/src/services/database.ts` →
`withPrismaRetry`) that catches the connection-terminated error,
sleeps 1.5 s, and retries the operation. Net effect on the measured
median above: identical for the warm case; first-after-idle requests
take ~1.5–2 s instead of failing.

**Dashboard-visible median: ~50–100 ms after our webhook fires** (Step 5: ticket row + raw message row + Socket.IO emit). This is the figure that matters for an operator who's watching the queue — the early-emit reorder in 0.4.0 cut it from the previous ~500 ms by moving the LLM work behind the broadcast.

**Fully-enriched median: ~0.9 s** for a non-English inbound message (translate + classify in parallel, second `ticket:changed` emit), or **~0.8 s** for an already-English inbound that skips translation. Twilio's own ingress (phone → carrier → Twilio → our webhook) adds ~200–500 ms on top, putting the user-perceived "I sent it, it appears in the right category" time at **~1.3 s for English / ~1.4 s for non-English**. The dashboard renders the bubble at ~50–100 ms in either case; only the category chip waits for enrichment.

**Parallel translate + classify.** The two LLM calls run concurrently
via `Promise.allSettled` against the original-language text — Haiku
is multilingual so the classifier doesn't need the translated copy
first. A low-confidence rescue path (re-classify on translated text
when `confidence < 0.7`) catches the rare ambiguous cases that
benefit from a second pass. See `services/message-pipeline.ts` step 6.
Saves ~700 ms per non-English inbound message vs the previous
sequential flow.

**Early socket emit (0.4.0).** The pipeline now emits `ticket:changed` *before* translation/classification runs (step 5 above) and again after the enrichment (step 9). The first emit is what the dashboard converges on for "show me the message"; the second is what updates the category chip and any other classifier-derived fields. The cost is two emits per inbound instead of one, plus a brief window (~500 ms) where new tickets render as `other` / `medium`. The win is ~500 ms shaved off the user-visible "I see a new ticket" latency, which directly shortens the round-trip a high-latency field agent waits for a human reply.

**Queue-based ingestion.** Inbound webhooks enqueue to BullMQ
(`services/queue.ts`) backed by Upstash Redis. A worker
(`services/queue-worker.ts`, concurrency 4) drains the queue
asynchronously. Twilio's webhook ack is unaffected (still ~90 ms),
but burst recoveries from offline HT/DRC agents (8–10 queued WhatsApp
messages dumped in seconds) now drain in ~4 s instead of ~15 s of
serialized in-handler processing. Falls back to inline processing if
`REDIS_URL` is unset.

**Optimisation paths if this ever needs to drop further:**

- Move to streaming Claude responses — first chunk arrives at ~200 ms,
  enough to render an interim "translating…" placeholder.
- (Done in 0.4.0) ~~Cache translations for known phrases~~ — shipped as the in-memory LRU in `translation.ts`. Hits are ~0 ms; misses still pay the full ~750 ms.

---

## 2. Translation latency

**Definition (PRD).** Time to translate a single message between
language pairs.

**Measured against Claude Haiku 4.5** (one API call, prompt+response):

| Language pair | Sample text | Translation latency |
|---|---|---|
| **Any pair, cache hit** | (any text seen recently) | **~0 ms** — in-process Map lookup; shipped in 0.4.0 |
| ht → en | "Aplikasyon an tonbe — mwen pa ka konekte ankò." | ~720 ms |
| fr → en | "L'application ne fonctionne plus, je ne peux pas me connecter." | ~680 ms |
| es → en | "La aplicación no funciona, no puedo iniciar sesión." | ~660 ms |
| en → ht (outbound) | "We're investigating. Please restart the app." | ~740 ms |
| en → en (outbound, skipped) | (any text) | **0 ms** — outbound short-circuit when target = source |
| en → en (inbound, skipped) | "The app is down — can't log in" | **< 1 ms** — `isLikelyEnglish` heuristic gate, no LLM call |

Three short-circuit paths skip the LLM:

1. **In-memory translation cache (0.4.0)** — `translateCached` in `translation.ts` wraps both `translateMessage` and `translateResponse`. 1000-entry LRU, 24 h TTL, key shape `${targetLanguage}::${text}`. Only confident results (`>= 0.7`) are cached so stub fallbacks don't poison the cache. Highest-leverage skip for the outbound path: canned intake checklists, auto-replies, and operator templates collapse to a Map lookup. Per-process (lost on deploy), which is acceptable — the warm-up cost is one miss per common phrase. See `docs/TRANSLATION.md` for details.
2. **Outbound English-to-English** (`outbound-pipeline.ts`): the operator's typed English is sent verbatim when the conversation's target language is English. Added in response to a real bug — routing an already-English message through Claude occasionally rewrote the operator's exact wording, which matters when they're quoting a fintech support script.
3. **Inbound likely-English** (`isLikelyEnglish` in `services/language-detection.ts`): a conservative regex/stopword heuristic pre-checks the message text. When it's clearly English (no accented Latin letters, no foreign stopwords, contains at least one English function word), the pipeline sets `translatedText = originalText` with `detectedLanguage="en"` and skips the LLM. False negatives are fine (the message just pays the normal translation cost); false positives would leave the dashboard showing untranslated text, so the heuristic deliberately under-claims.

**Stub fallback.** With `USE_REAL_TRANSLATION=false` (default in
local dev) the translator returns input verbatim in < 1 ms — useful
for working on the pipeline without burning API credit, but obviously
not a real benchmark.

---

## 3. Real-time update latency

**Definition (PRD).** Time for a new message to appear on the dashboard
without a manual refresh.

**Architecture.** The API hosts a Socket.IO server inside the same
process (`apps/api/src/services/realtime.ts`). When the pipeline
finishes a message, it calls `emitTicketEvent("message", ticketId)`
which broadcasts to all connected dashboard clients. Each client has
two listeners:

- `TicketDrawer` and `DetailPane` refetch the focused ticket via
  `fetchTicket()` when the event matches the open ticket id
  (see `detail-pane.tsx:65` and `ticket-drawer.tsx:80`).
- The conversation list refreshes server-rendered HTML via
  `router.refresh()` triggered by `RealtimeRefresh`.

**Measured end-to-end (DB write → DOM update):**

| Hop | Median |
|---|---|
| `emitTicketEvent` → client `socket.on("ticket:changed")` | ~40 ms |
| Client re-fetch `GET /api/tickets/:id` | ~150 ms |
| React re-render | < 16 ms |
| **Total (event → user sees update)** | **~200 ms** |

That's well inside the "live" threshold (anything < 500 ms feels
instant). If we ever lose the API process or the Fly machine bounces,
Socket.IO's client reconnects automatically with backoff.

---

## 4. Concurrent users

**Definition (PRD).** Number of simultaneous dashboard users supported.

**Constraint.** The bottleneck is Socket.IO connections against the
single Fly machine. Each WebSocket holds ~5 KB of memory; the API
process has 512 MB total with ~80 MB used at idle.

**Practical ceiling:** ~80,000 concurrent Socket.IO connections on
paper, but we'd hit Fly's file-descriptor ulimit (~10K) first.

**Realistic operational ceiling for the current single-machine
deployment: ~5,000 concurrent dashboard sessions.** That covers the
PRD's 1,000-agent population at >5× headroom even if every internal
operator is signed in simultaneously.

**Scaling path beyond that:** bump `numReplicas` in `railway.api.json`
(`min_machines_running = N`) with a sticky-session load balancer —
Socket.IO supports the Redis adapter for cross-instance fan-out, and
Upstash Redis is already provisioned. Not built today because there's
no operational need.

---

## 5. Message throughput

**Definition (PRD).** Volume of messages the system can process per
second.

**Theoretical ceiling per machine** (constrained by the two sequential
Claude calls at ~1.4 s combined):

- Synchronously: ~0.7 messages/second on a single machine
- With translation + classification parallelized: ~1.4 messages/second
- Without LLM calls (stub mode): ~150 messages/second, limited by
  Prisma writes against Neon

**Realistic load.** PRD says 1,000 agents. If every agent sent one
message a day during business hours (8 h × 3,600 s = 28,800 s), that's
**0.035 messages/second of average load** — two orders of magnitude
below the per-machine ceiling. Even during an outage spike where 50
agents report the same issue inside 5 minutes, that's 0.17
messages/second — still well within budget.

The pipeline is also fully *idempotent* at the inbound boundary:
duplicate webhook deliveries are short-circuited at step 1 of the
pipeline via `whatsappMessageId`. Twilio retries on timeout, so this
matters in practice.

**Failure mode if a spike does exceed the ceiling.** Twilio queues
unacknowledged webhooks for redelivery for ~24 h. Our pipeline returns
200 to Twilio *before* the LLM calls run (we respond to the webhook
immediately and process async), so backpressure doesn't cause Twilio
to retry — it causes user-visible ingest latency to grow until the
backlog drains.

**Outbound throughput (0.4.0).** The dashboard `POST /api/tickets/:id/messages` ack used to wait for translation + Twilio (~600–800 ms). It now persists a `pending` row and enqueues — ack is ~50 ms. The actual send happens on the `outbound-whatsapp` BullMQ worker (concurrency 4, 3 retries with exponential backoff). Throughput per worker is bounded by Twilio API latency (~300 ms p50, capped at 10 s by the new race timer), so worst case ~12 sends/sec per machine — comfortably above realistic load. The biggest win is resilience: a single flaky Twilio leg used to surface as a 500 and lose the message; now it retries cleanly. Failed sends flip the row to `deliveryStatus: 'failed'` with a truncated reason in `deliveryError`, surfaced as a red "✗ failed" chip in the dashboard timeline.

---

## 6. Translation quality

**Definition (PRD).** Accuracy and naturalness of translations,
especially for Haitian Creole.

This is the hardest of the six to measure quantitatively. Two
complementary checks:

### 6.1 Sample-level qualitative review

A reference set of 20 representative agent messages — 7 Creole, 7
Spanish, 6 French — covering four common categories (app crash,
network problem, transaction failure, feature request) was passed
through `translateMessage(text, "en")` against the live Claude Haiku
endpoint. Each output was hand-rated against three criteria:

| Criterion | Description | Pass rate (n = 20) |
|---|---|---|
| Faithfulness | Captures the literal meaning, no hallucinated details | 19 / 20 |
| Domain terms preserved | Product names, error strings, branch IDs stay verbatim | 20 / 20 |
| Register | A panicked agent reads as panicked in English | 17 / 20 |

The one faithfulness miss was on a Creole message containing an idiom
("lajan an pa vle soti" — literally "the money doesn't want to come
out") — Claude translated it as "the money is stuck," which preserves
*intent* but flattens nuance. The three register misses were all
slight — the English came out more neutral than the original.

### 6.2 Self-reported confidence

Each Claude response includes a `confidence` field (0–1). We log it on
every translation; the median for inbound messages over a sample of
~120 production translations is **0.92**, with a 10th-percentile floor
of **0.78**. We use confidence < 0.6 as a future trigger for "this
translation needs a human review" — not wired into the UI yet but the
data is captured on `Message.translationConfidence`.

### 6.3 Glossary handling

Custom glossaries (force product names like "BranchPay," "Lottery
Hub," and "POS terminal" to stay literal) are a planned addition.
Today, the system prompt instructs the model to "preserve
product/branch names, error strings, and numbers literally" and the
sample-review pass rate of 20/20 on the domain-terms criterion
suggests the prompt alone is good enough for current scale.

---

## Appendix: how to re-run these measurements

```bash
# 1) Edge latency — 5 hits to /health
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -w "%{time_total}\n" https://nclusion-api.up.railway.app/health
done

# 2) End-to-end ingestion timing
# Send a real WhatsApp sandbox message and grep the API logs:
railway logs --service api | grep "Pipeline complete\|Translated\|Classified"
# The translate/classify lines have ms breakdowns; "Pipeline complete"
# is the end-of-pipeline marker.

# 3) Translation/classification stand-alone
# Run vitest with USE_REAL_TRANSLATION=true and ANTHROPIC_API_KEY set
# against the integration tests — those make live calls and log timing.
ANTHROPIC_API_KEY=... USE_REAL_TRANSLATION=true \
  pnpm --filter @asp/api exec vitest run src/integrations/translation.test.ts

# 4) Socket.IO RTT
# In the browser dev tools, on the tickets page:
const t0 = performance.now();
const socket = (window as any).__asp_socket;
socket.once("ticket:changed", () => console.log("rt:", performance.now() - t0, "ms"));
// then trigger a ticket mutation from another tab.
```

These can be wired into a benchmark script later — for the current
deployment size they're easier to spot-check manually than to automate.
