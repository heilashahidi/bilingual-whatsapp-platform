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

1. US team member types a response in English.
2. The system looks up the agent's `preferredLanguage`.
3. The response is translated to the agent's language.
4. A preview of the translation is shown to the US team member before sending (they can edit if needed).
5. The translated message is sent via WhatsApp.

### Voice Notes

1. Agent sends a WhatsApp voice note (`.ogg` file).
2. The audio file is downloaded and stored in object storage.
3. Google Speech-to-Text transcribes the audio in the detected language.
4. The transcript goes through the normal translation pipeline.
5. The ticket shows both the audio player and the translated transcript.

## Translation Provider

### Google Cloud Translation API v3 (Advanced)

The primary translation provider. Chosen because it has the best commercial support for Haitian Creole.

**Setup:**

1. Create a Google Cloud project.
2. Enable the Cloud Translation API.
3. Create a service account with `roles/cloudtranslate.user`.
4. Download the service account key JSON.
5. Set `GOOGLE_APPLICATION_CREDENTIALS` to the path of the key file.
6. Set `GOOGLE_CLOUD_PROJECT_ID` in your `.env`.
7. Set `USE_REAL_TRANSLATION=true`.

### Development Stub

When `USE_REAL_TRANSLATION` is not set, the system uses a stub translator that:

- Detects language using simple keyword heuristics (checks for common Creole, Spanish, and French words).
- Passes through the original text with a `[ht→en]` prefix.
- Returns a confidence score of 0.85.

This lets you develop and test the full pipeline without a Google Cloud account.

## Custom Glossary

The glossary is the most important factor in translation quality for this project. Without it, Google Translate will mishandle domain-specific terms.

### What Needs Glossary Entries

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
