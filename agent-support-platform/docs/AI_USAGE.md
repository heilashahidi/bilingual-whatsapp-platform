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
- Wrote the deploy artifacts (Dockerfiles, fly.toml, .dockerignore) and
  walked through the Fly.io / Neon / Upstash setup.
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

### Design assets

Two visual design handoffs were produced separately using Claude's design
tooling and dropped in as `handoff/` and `handoff 2/`. Each contained TSX
component drop-ins for the kanban refresh and the v2 features (list view,
new-ticket modal, UI prefs). Claude Code applied them, integrated them
with the existing data flow (drawer pattern, realtime, auth), and added
the backend endpoints the new UI required.

The README.md in each handoff folder documents what was authored by
design vs what was extended in integration.

## 2. AI used in the production runtime

The shipped platform calls two AI APIs at runtime, both Anthropic.

### Translation (Claude Haiku 4.5)

- File: `apps/api/src/integrations/translation.ts` → `translateWithClaude`
- Triggered on every inbound WhatsApp message (translate agent → English)
  and every outbound dashboard reply (translate English → agent's
  preferredLanguage).
- Prompt asks for strict JSON output with three fields:
  `translatedText`, `detectedLanguage`, `confidence`. Rules in the prompt:
  preserve product names and error strings literally; if source matches
  target language, return unchanged with confidence 1.0; keep tone.
- Languages supported: English, Haitian Creole (ht), French (fr),
  Spanish (es).
- Latency: ~300–500 ms p50 per call.
- Cost: ~$0.0001 per translation at Haiku rates.
- Fallback: a stub translator (`translateStub`) runs when
  `USE_REAL_TRANSLATION` is unset or the API call fails. The stub does
  keyword-based language detection and passes the text through unchanged.

### Classification (Claude Haiku 4.5)

- File: `apps/api/src/integrations/classification.ts` → `classifyWithLLM`
- Triggered on every inbound message after translation.
- Prompt includes category definitions (bug_report / operational_complaint
  / feature_request / question / other), a severity rubric, product-area
  enum, and example messages. Output is strict JSON: category, severity,
  tags, productArea, confidence, likelyNetwork.
- Used to set the ticket's severity, route to a product area, and feed
  the kanban filter taxonomy.
- Cost: ~$0.0002 per classification.
- Fallback: a keyword-based stub (`classifyStub`) runs when
  `USE_REAL_CLASSIFICATION` is unset, with simple regex rules over
  English text.

### What's intentionally not LLM-driven

The following look AI-adjacent but are deterministic:

- **Knowledge base similarity search** — uses category + tag overlap
  scoring (`apps/api/src/services/kb-search.ts`), not embedding-based
  similarity. The `KnowledgeArticle.embedding` pgvector column exists in
  the schema but is currently unused. The interface is set up so swapping
  to OpenAI / Cohere embeddings is a single-function replacement.
- **Incident clustering** — model and UI exist; the auto-clustering worker
  is unbuilt. Manual incident linking from the dashboard works today.

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

When the real classification/translation paths are enabled, Claude Haiku
receives:

- The text body of each WhatsApp message (translation).
- The English-translated text of each inbound message (classification).
- A static system prompt describing the categorization rubric, language
  pairs, and JSON output format.

**No PII is sent beyond the message body itself.** Agent names, phone
numbers, branch information, and ticket IDs are never included in the
LLM prompts. The dashboard's display of that metadata is handled
client-side.

The Anthropic API is called from the API server only; the browser
never talks to Anthropic directly.

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
