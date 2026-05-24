# Translation Pipeline

The translation system sits transparently between agents and the US team, allowing both sides to communicate naturally in their own language.

## Supported Languages

| Language | Code | Countries | Direction |
|---|---|---|---|
| Haitian Creole | ht | Haiti | Agent ↔ English |
| French | fr | DRC (and some Haiti) | Agent ↔ English |
| Spanish | es | Dominican Republic | Agent ↔ English |
| English | en | US team | Dashboard language |

## How Translation Works

### Inbound (Agent → Dashboard)

1. Agent sends a WhatsApp message in their language.
2. The translation worker detects the language (agents may code-switch — Creole mixed with French is common in Haiti).
3. The message is translated to English.
4. Both the original text and English translation are stored on the message record.
5. The dashboard shows the English translation by default with a toggle to reveal the original.

### Outbound (Dashboard → Agent)

1. US team member types a response in English and hits Send.
2. The API persists the Message row with `deliveryStatus: 'pending'` (English text pre-filled so the timeline has something to render) and returns immediately (~50 ms). The composer shows a "Queued — status in conversation" chip and the message bubble appears with a pulsing "sending" indicator.
3. The outbound BullMQ worker picks up the job, looks up the conversation's target language (tracks the last inbound language, falling back to `Agent.preferredLanguage`), and runs `translateResponse`.
4. The worker enforces per-country length caps (HT/DR 1,000 / 2,000 chars), then calls Twilio with a 10 s timeout. 3 retries with exponential backoff on transient failure.
5. On success, the row is patched to `deliveryStatus: 'sent'` with the Twilio SID and the final translated text. On terminal failure, `deliveryStatus: 'failed'` with the truncated reason in `deliveryError` — the dashboard surfaces a red "✗ failed" chip.

### Voice Notes

1. Agent sends a WhatsApp voice note (`.ogg` file).
2. The audio file is downloaded and stored in object storage.
3. Google Speech-to-Text transcribes the audio in the detected language.
4. The transcript goes through the normal translation pipeline.
5. The ticket shows both the audio player and the translated transcript.

## Translation Provider

### Anthropic Claude Haiku 4.5 (shipped)

The primary (and only) translation provider today is Claude Haiku (`claude-haiku-4-5-20251001`), called from `apps/api/src/integrations/translation.ts` → `translateWithClaude`. Same vendor as classification, reply drafts, incident summaries, and KB drafts — one Anthropic dependency for all five AI surfaces.

The original plan was Google Cloud Translation v3 Advanced (best commercial Haitian Creole support, custom glossary upload). Claude Haiku turned out to handle the language pairs well enough that the second-vendor cost wasn't justified: median 0.92 self-reported confidence on inbound Creole, 20/20 pass rate on domain-term preservation in the qualitative review (see `docs/PERFORMANCE.md §6`). Glossary-style rules ("preserve product/branch names, error strings, and numbers literally") live in the prompt today.

**Setup:**

1. Set `ANTHROPIC_API_KEY` in `apps/api/.env`.
2. Set `USE_REAL_TRANSLATION=true`.

That's it — no service account, no project ID, no glossary upload step.

### In-memory translation cache (shipped in 0.4.0)

Every call to `translateMessage` / `translateResponse` first checks an in-process LRU cache (`translation.ts`, `translateCached`):

- **Size:** 1000 entries max, evict-oldest on overflow.
- **TTL:** 24 hours per entry.
- **Key:** `${targetLanguage}::${text}` — source language is auto-detected by Claude, so the result is keyed by target.
- **Eligibility:** only cached when `confidence >= 0.7`. Stub fallbacks and low-confidence outputs are recomputed on the next hit instead of poisoning the cache.

Why it matters: canned outbound replies (auto-intake checklists, "Your ticket has been resolved", operator templates) hit repeatedly. Each hit collapses a ~300–500 ms Claude Haiku call into a Map lookup (~0 ms), which directly reduces the worker's time-on-job and therefore the field agent's perceived round-trip. Per-process and per-machine — it survives a restart of nothing, so a deploy clears it. That's acceptable: the warm-up cost is ~1 cache miss per common phrase.

### Short-circuit paths (skip the LLM entirely)

1. **Cache hit** (above) — fastest path; full skip of the Claude call.
2. **Outbound English-to-English:** when the conversation's target language is English, the operator's typed message is sent verbatim. Avoids a Claude rewrite of an already-English support script.
3. **Inbound likely-English:** the conservative `isLikelyEnglish` heuristic (`apps/api/src/services/language-detection.ts`) pre-checks inbound text. If it has no accented Latin letters, no Creole / Spanish / French stopwords, and at least one English function word, `translatedText = originalText` and the LLM call is skipped.

### Development Stub

When `USE_REAL_TRANSLATION=false` (default in local dev) the system uses `translateStub`, which returns the input text unchanged in <1 ms. Stub outputs carry confidence `0.85`, so they're cached normally — repeated dev runs still exercise the cache hit path. The composer no longer renders a "Translated as:" preview (the translation isn't known at send time under the async outbound queue); it shows a short "Queued — status in conversation" chip instead, and the delivery state surfaces on the message bubble itself.

### Swap path

The `translateMessage()` interface in `translation.ts` is provider-agnostic. Wiring up Google Cloud Translation v3 — or DeepL as a secondary engine for fr / es — is a single-file change; nothing downstream knows which engine ran.

## Custom Glossary (planned)

A formal custom-glossary path is not built today — domain-term preservation is handled by prompt instruction. The sections below document the planned glossary surface for when prompt-only handling stops being good enough or when the platform migrates to Google Cloud Translation. Track regressions on `Message.translationConfidence` and the dashboard's edit-translation flow to decide when to invest here.

### What Would Need Glossary Entries

| Term | Context | Why It Matters |
|---|---|---|
| Product-specific names | App name, feature names, menu items | Should not be translated |
| Transaction types | "transfer," "deposit," "withdrawal" | Must translate to the financial sense, not physical |
| Lottery terminology | "draw," "ticket," "results," "payout" | Domain-specific meanings differ from general usage |
| Error messages | App error strings agents might quote | Should map to the English error string for engineering triage |
| Branch names | "Port-au-Prince Central" | Should not be translated |
| Roles and titles | "agent," "supervisor," "manager" | Should use the company's terminology |

### Glossary File Format

Google Cloud Translation uses a TSV (tab-separated values) file:

```tsv
en	ht	fr	es
transfer	transfè	transfert	transferencia
deposit	depo	dépôt	depósito
withdrawal	retrè	retrait	retiro
payout	peman	paiement	pago
lottery draw	tiraj	tirage	sorteo
account balance	balans kont	solde du compte	saldo de cuenta
app crash	aplikasyon an tonbe	crash de l'application	caída de la aplicación
```

### Uploading the Glossary

```bash
# Create glossary via gcloud CLI
gcloud translate glossaries create agent-support-glossary \
  --source-language=en \
  --target-languages=ht,fr,es \
  --input-uri=gs://your-bucket/glossary.tsv \
  --project=your-project-id
```

### Glossary Management on the Dashboard

The admin settings include a glossary manager where the ops team can:

- View all glossary entries.
- Add new terms (e.g., when a new product feature launches).
- Edit existing translations.
- Export the glossary as TSV.

Changes to the glossary require re-uploading to Google Cloud. The dashboard triggers this via the API.

## Translation Quality

### Confidence Scoring

Every translation includes a confidence score (0–1). When confidence is below 0.7:

- The dashboard shows a "translation may be inaccurate" warning badge.
- The original text is shown alongside the translation (not hidden behind a toggle).
- The message is flagged for potential manual review.

### Human Override

Dashboard users can edit any translation. When they do:

- The edited version replaces the machine translation on the ticket.
- The edit is logged with the editor's name and timestamp.
- The original machine translation is preserved for reference.
- Edited translations can be batch-exported to identify glossary gaps (if the team keeps correcting the same word, it should be added to the glossary).

### Code-Switching

Agents in Haiti frequently mix Creole and French in the same message. The translation pipeline handles this by:

1. Running language detection on the full message.
2. If confidence is low (the message contains two languages), defaulting to the agent's `preferredLanguage` for translation direction.
3. Google Translate generally handles mixed-language input well, but edge cases should be monitored.

### Quality Metrics

Track these on the analytics dashboard:

- **Low-confidence rate:** % of messages with translation confidence < 0.7, by language.
- **Human edit rate:** % of translations manually edited by the US team.
- **Common corrections:** Most frequently edited words/phrases (glossary candidates).
- **Average confidence by language:** Creole will likely be lower than Spanish/French.

## Adding a New Language

If the platform expands to a new country/language:

1. Add the language code to the `Language` enum in `schema.prisma`.
2. Add the language pair to the translation service.
3. Create a glossary for the new language.
4. Add the country to the SLA, bot TTL, and clustering configs in `packages/shared`.
5. Test with a small group of agents before full rollout.
