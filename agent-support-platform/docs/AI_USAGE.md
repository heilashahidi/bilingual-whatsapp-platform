# AI Usage Documentation

This project was built using AI tooling across two distinct surfaces, both
disclosed below.

## 1. AI used during development (Claude Code)

The codebase was built collaboratively with [Claude Code](https://claude.com/claude-code)
(Anthropic), the official CLI for Claude. The model used was **Claude Opus 4.7**
(`claude-opus-4-7`).

### What Claude Code did

- Scaffolded the initial monorepo structure (apps/api, apps/dashboard,
  packages/shared, docs/).
- Wrote first-pass implementations of every TypeScript file in `apps/api`
  and `apps/dashboard`, plus the Prisma schema.
- Generated all five Prisma migrations (one auto-generated, four written
  by hand because the existing `pgvector` init blocked Prisma's shadow-DB
  step on subsequent migrations).
- Authored the CI/CD GitHub Actions workflows.
- Wrote the deploy artifacts (Dockerfiles, railway.*.json, .dockerignore)
  and walked through the Railway / Neon / Upstash setup. (The Fly.io
  parallel deploy that existed at one point was retired in favor of
  Railway-only — see DEPLOYMENT.md.)
- Diagnosed every production bug encountered (Next.js cache corruption,
  Prisma P3005 / P3018, Twilio signature mismatch, NextAuth JWE vs HS256
  decoder, SLA ring negative-fill, et al.) and committed the fixes.

### Human review process

Every code change was reviewed before being committed. The reviewer:

- Read each diff in the chat / editor before approving.
- Tested every feature locally in the browser before pushing to production.
- Verified end-to-end behavior (WhatsApp send → dashboard → reply) at each
  major milestone.
- Made architectural decisions (e.g., drawer vs full route, query-param vs
  intercepting routes, JWT vs cookie auth) personally; Claude proposed
  options with tradeoffs and the human chose.

No code was committed without human inspection.

## 2. AI used in the production runtime

The shipped platform calls Anthropic's Claude Haiku 4.5
(`claude-haiku-4-5-20251001`) across **five distinct surfaces**. Each one
is fail-silent: missing `ANTHROPIC_API_KEY`, non-OK API responses, and
malformed JSON all degrade gracefully without breaking the request that
triggered them.

### 2.1 Translation

- **File:** `apps/api/src/integrations/translation.ts` → `translateWithClaude`
- **Triggered on:** every inbound WhatsApp message (agent → English)
  and every outbound dashboard reply (English → the agent's *detected*
  conversation language, which may differ from their registered
  preferredLanguage).
- **Two optimizations that skip Claude entirely:**
  1. **Outbound English-to-English:** when the resolved target language
     is English (the conversation language detected from the last
     inbound message is English), the outbound path skips the Claude
     call entirely. Operators replying in English to an English-speaking
     agent never burn a translation round-trip.
  2. **Inbound already-English:** a conservative heuristic in
     `apps/api/src/services/language-detection.ts` (`isLikelyEnglish`)
     pre-checks inbound messages. If the text has no accented Latin
     letters (è/ñ/ç/ô), no known Creole/Spanish/French stopwords, and
     contains at least one English function word, the pipeline sets
     `translatedText = originalText` with `detectedLanguage="en"` and
     skips the LLM call. Heuristic is deliberately conservative — false
     negatives (foreign text passed through to Claude) are fine; false
     positives (foreign text mistakenly flagged English) would leave
     the dashboard showing untranslated text.
- **Composer "Sent. Translated as:" toast** only renders when the
  translation actually changed the text. English-to-English replies
  show a simple "Sent." instead.
- **Prompt shape:** asks for strict JSON `{ translatedText,
  detectedLanguage, confidence }`. Rules: preserve product names + error
  strings literally; if source matches target, return unchanged with
  confidence 1.0; keep tone (a panicked agent stays panicked).
- **Languages:** English, Haitian Creole (ht), French (fr), Spanish (es).
- **Latency:** ~660–740 ms p50 per call (see `docs/PERFORMANCE.md §2`).
- **Cost:** ~$0.0001 per translation at Haiku rates.
- **Fallback:** `translateStub` keyword-based detector that passes text
  through unchanged.

### 2.2 Classification

- **File:** `apps/api/src/integrations/classification.ts` → `classifyWithLLM`
- **Triggered on:** every inbound message after translation.
- **Prompt shape:** strict JSON `{ category, severity, tags, productArea,
  confidence, likelyNetwork }`. Includes category definitions
  (bug_report / operational_complaint / feature_request / question /
  other), a severity rubric, the product-area enum, and example messages.
- **Used for:** ticket severity assignment, product-area routing,
  filter-taxonomy population.
- **Latency:** ~700 ms p50.
- **Cost:** ~$0.0002 per classification.
- **Fallback:** `classifyStub` keyword regex.

### 2.3 Reply drafts (operator-facing)

- **File:** `apps/api/src/services/reply-suggester.ts` → `suggestReplies`
- **Endpoint:** `POST /api/tickets/:id/suggest-replies`
- **Triggered on:** dashboard composer opening a ticket (and on demand
  via a regenerate button).
- **Input:** last 8 messages of the conversation + ticket category /
  severity / tags + top 2 pinned KB suggestions.
- **Output:** three candidate reply drafts varying in tone (direct,
  empathetic, investigative). Each 1–3 sentences, written in English.
  The operator picks one, edits in the textarea, and hits send — drafts
  are never sent automatically.
- **Failure behavior:** route always returns 200 with an empty list when
  Claude is unavailable, so the dashboard simply hides the suggestions
  block instead of breaking the ticket page.

### 2.4 Incident summaries

- **File:** `apps/api/src/services/incident-summarizer.ts` → `summarizeIncident`
- **Triggered on:** new incident formation by the clusterer
  (`incident-clusterer.ts`).
- **Input:** all contributing tickets' first inbound messages + branch /
  region / tag metadata.
- **Output:** rewrites the mechanical incident title ("Bug Report surge
  — Haiti") into something specific ("Login screen frozen across HT
  branches"), plus a 1–3 sentence root-cause hypothesis with a
  suggested next investigation step. Stored on `Incident.title` and
  `Incident.rootCause`.
- **Fire-and-forget:** runs after the incident is created with the
  mechanical title, so a slow Claude call never blocks clustering.
  Socket events are re-emitted after the rewrite so the dashboard
  refetches and shows the upgraded title.

### 2.5 KB article drafts

- **File:** `apps/api/src/services/kb-drafter.ts` → `draftKbArticle`
  (called from `kb-indexer.ts` `indexResolvedTicket`)
- **Triggered on:** ticket resolution with a non-empty
  `resolutionSummary`.
- **Input:** full conversation thread + operator's resolution summary +
  ticket metadata.
- **Output:** complete KB article draft `{ title, problemDescription,
  resolutionText, resolutionTextShort, tags }`. Stored as a
  `KnowledgeArticle` with `status: "draft"` for operator review on
  `/knowledge?status=draft`.
- **Two-stage fallback:** if Claude fails, `kb-indexer` falls back to
  its mechanical generator (first inbound as problem +
  resolutionSummary + concatenated outbound responses). KB drafts
  always get created regardless of LLM availability.

### What's intentionally not LLM-driven

- **Incident clustering** itself is deterministic — same-country +
  same-category in a 30-min window with a 3-ticket threshold.
  Only the *summary* of a formed incident uses Claude.
- **KB similarity search** for pinning suggestions onto new tickets
  (`apps/api/src/services/kb-search.ts`) uses category + tag overlap
  scoring, not embeddings. The `KnowledgeArticle.embedding` pgvector
  column exists for a future swap to embedding-based similarity but
  is currently unused.
- **Translation language detection** for non-English text is delegated
  to Claude inside the translation call (the `detectedLanguage` field).
  The only standalone detector is the conservative `isLikelyEnglish`
  heuristic used to short-circuit the LLM call on already-English
  inbound messages (see §2.1 above).

## Environment variables that gate AI behavior

| Variable | Default | Effect when set |
|---|---|---|
| `ANTHROPIC_API_KEY` | unset | Enables real Claude calls |
| `USE_REAL_CLASSIFICATION` | `false` | Routes classification to Claude Haiku |
| `USE_REAL_TRANSLATION` | `false` | Routes translation to Claude Haiku |
| `USE_REAL_WHATSAPP` | `false` | Routes outbound sends to Twilio (not AI but related to the production switch) |

The stub modes exist specifically so the platform can run end-to-end with
zero AI API calls during development, with no code branching beyond the
integration boundary.

## Data sent to Anthropic

The Anthropic API is called from the API server only; the browser
never talks to Anthropic directly. What gets included depends on which
of the five surfaces is invoked:

| Surface | Data included in the prompt |
|---|---|
| Translation | Message body text only. |
| Classification | English-translated message body + a static rubric prompt. |
| Reply drafts | Last 8 messages of the conversation, agent's first name, branch name (e.g., "Cap-Haïtien Central"), country code, ticket category/severity/tags, top 2 pinned KB articles. **Phone numbers are never included.** |
| Incident summary | First inbound message of each contributing ticket (up to ~10 lines total), branch names, region names, country codes, classifier tags. |
| KB article draft | Full ticket conversation, operator's free-text resolution summary, classifier tags. **Agent names and phone numbers are excluded.** |

**What is never sent to Anthropic, on any surface:**
- Phone numbers
- WhatsApp message IDs (whatsappMessageId)
- Internal user emails or IDs
- Auth tokens or session data
- Twilio account credentials

Branch names and country codes are sent for the surfaces where they
materially improve the output (e.g., the reply suggester needs to
generate French replies for DRC agents). Operators reviewing the demo
of any specific prompt can grep the relevant `services/*.ts` file for
the `prompt` string to see the exact template.

## Reproducibility

To regenerate any of the LLM outputs from a given input:

```bash
# Translation
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-haiku-4-5-20251001",
    "max_tokens": 600,
    "messages": [{"role":"user","content":"<the prompt template from translation.ts with your text>"}]
  }'
```

The full prompts live in `apps/api/src/integrations/translation.ts`
(`LANG_NAMES` table + prompt body) and
`apps/api/src/integrations/classification.ts` (`CLASSIFICATION_PROMPT`
constant).
