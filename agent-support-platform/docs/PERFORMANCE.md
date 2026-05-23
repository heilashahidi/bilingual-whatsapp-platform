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

**Pipeline.** A single inbound message walks through nine steps in
`apps/api/src/services/message-pipeline.ts`:

1. Dedup lookup (`Message.findUnique` by `whatsappMessageId`)
2. Agent lookup / auto-register
3. Update `agent.lastSeenAt`
4. Translate via Claude Haiku → English
5. Classify via Claude Haiku → category/severity/tags
6. Create-or-find open ticket
7. Persist message row
8. KB lookup (only on new tickets)
9. Slack fire-and-forget + Socket.IO `ticket:changed` broadcast

Steps 4 and 5 dominate the wall clock (two sequential LLM calls).
Everything else is DB writes against Neon and finishes in tens of ms.

**Measured.**

| Step | Median | Source |
|---|---|---|
| Twilio → API edge | ~90 ms (warm) | `curl /health` × 5, see appendix |
| `prisma.findUnique` dedup | < 5 ms | Prisma logs |
| Translation (Claude Haiku) | **~750 ms** | Per-call timing in `translation.ts` |
| Classification (Claude Haiku) | **~700 ms** | Per-call timing in `classification.ts` |
| Ticket + Message inserts | < 20 ms total | Two indexed writes |
| Socket.IO broadcast | < 5 ms | In-process emit |

**End-to-end median: ~1.6 s** for a non-English inbound message that
requires both translation and classification. Twilio's own ingress
(phone → carrier → Twilio → our webhook) adds ~200–500 ms on top of
that depending on the carrier, putting the user-perceived "I sent it,
it's visible" time at **~2.0 s in the median**.

**Optimisation paths if this ever needs to drop:**

- Run translation and classification in parallel (`Promise.all`) — saves
  ~700 ms by overlapping the two LLM calls. We deliberately keep them
  sequential today because the classifier reads the *translated* text.
  Translating the original text and classifying the original would let
  these parallelize, at the cost of classifier accuracy on non-English
  inputs.
- Move to streaming Claude responses — first chunk arrives at ~200 ms,
  enough to render an interim "translating…" placeholder.
- Cache translations for known phrases (greetings, sign-offs).

---

## 2. Translation latency

**Definition (PRD).** Time to translate a single message between
language pairs.

**Measured against Claude Haiku 4.5** (one API call, prompt+response):

| Language pair | Sample text | Translation latency |
|---|---|---|
| ht → en | "Aplikasyon an tonbe — mwen pa ka konekte ankò." | ~720 ms |
| fr → en | "L'application ne fonctionne plus, je ne peux pas me connecter." | ~680 ms |
| es → en | "La aplicación no funciona, no puedo iniciar sesión." | ~660 ms |
| en → ht (outbound) | "We're investigating. Please restart the app." | ~740 ms |
| en → en (skipped) | (any text) | **0 ms** — we short-circuit when target = source |

The en→en short-circuit was added in response to a real bug: routing an
already-English message through Claude occasionally rewrote it. The
operator's exact wording matters when they're quoting a fintech support
script, so the API now skips the LLM call when the resolved target
language is `en` (see `sendAgentResponse` in
`apps/api/src/integrations/whatsapp.ts`).

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
