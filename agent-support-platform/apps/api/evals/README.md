# Evals

Braintrust evals for the LLM call sites in `apps/api`.
Today: **classification**, **translation** (with LLM-as-judge).
Pattern is reusable for reply-suggester, kb-search, and incident-summarizer
— see "Adding a new eval" below.

## Run

From `apps/api/`:

```sh
# Local-only — no Braintrust account or API key needed. Prints summary.
pnpm eval:offline

# Online — uploads to braintrust.dev for diffs across runs and trace UI.
# Requires BRAINTRUST_API_KEY (https://www.braintrust.dev/app/settings/api-keys).
pnpm eval
```

By default, evals run against the dev stubs. Flip env vars to eval real models:

```sh
USE_REAL_CLASSIFICATION=true ANTHROPIC_API_KEY=sk-... pnpm eval:offline
USE_REAL_TRANSLATION=true    ANTHROPIC_API_KEY=sk-... pnpm eval:offline
```

The translation eval also uses Claude as a judge (semantic accuracy + fluency).
Without `ANTHROPIC_API_KEY` those scorers return a `skipped` marker rather than
failing — non-LLM scorers (preservation, language detection, length, pass-through)
keep working.

## What gets scored

### Classification (`evals/classification/`)
| Scorer | Range | Signal |
|---|---|---|
| `category_match` | 0/1 | Exact match on the 5-category label |
| `severity_proximity` | 0–1 | Adjacent severities get partial credit (high↔critical = 0.5) |
| `product_area_match` | 0/1 | Exact match on product area |
| `connectivity_flag` | 0/1 | Did the model correctly flag a network-vs-app issue? |
| `confidence_calibration` | 0–1 | Penalizes overconfident-and-wrong; rewards appropriately uncertain |
| `tag_overlap` | 0–1 | Jaccard similarity on tag sets |

### Translation (`evals/translation/`)
| Scorer | Range | Signal | Needs key? |
|---|---|---|---|
| `language_detection` | 0/1 | Did `detectedLanguage` match the source? | no |
| `preservation` | 0–1 | Required tokens (numbers, IDs, error codes) survived verbatim | no |
| `length_sanity` | 0/1 | Output length within 0.5–2× of reference | no |
| `pass_through_exact` | 0/1 | source==target ⇒ output==input, confidence==1.0 | no |
| `accuracy_judge` | 0–1 | Claude-as-judge: semantic match to reference translation | yes |
| `fluency_judge` | 0–1 | Claude-as-judge: native-sounding in target language | yes |

Each scorer's `metadata` field surfaces predicted-vs-expected values (or judge
rationale) in the Braintrust UI for quick diffing.

## Datasets

- `classification/dataset.ts` — 20 cases across en/ht/fr/es. Bug reports,
  operational complaints, feature requests, questions, connectivity.
- `translation/dataset.ts` — 20 cases covering en↔ht, en↔fr, en↔es, plus
  preservation (numbers, error codes, reference IDs), pass-through
  (source==target), and tone/register cases.

Extend datasets as production traffic reveals failure modes worth pinning
behavior on — aim for ~5–10 new cases per iteration, not massive batches.

## Adding a new eval

Mirror the structure for any other LLM call site:

```
evals/
  <call-site>/
    dataset.ts            # ClassificationCase-style array (input + expected + metadata)
    scorers.ts            # async ({ output, expected }) => ({ name, score })
    <call-site>.eval.ts   # Eval("name", { data, task, scores })
```

The `braintrust eval evals` command autodiscovers any `*.eval.ts` under
`evals/`, so you don't need to register new files anywhere.

## CI (optional)

To gate PRs on regressions, add a step to `.github/workflows/ci.yml`:

```yaml
- name: Run evals
  env:
    BRAINTRUST_API_KEY: ${{ secrets.BRAINTRUST_API_KEY }}
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    USE_REAL_CLASSIFICATION: "true"
  run: pnpm --filter @asp/api eval
```

Braintrust will diff scores against the last main-branch run and surface
regressions inline on the PR.
