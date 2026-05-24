# Evals

Braintrust evals for every LLM call site in `apps/api`:

- **`classification/`** — message → category/severity/tags/productArea
- **`translation/`** — bi-directional en↔ht/fr/es with LLM-as-judge
- **`reply-suggester/`** — operator reply drafts (3 tones)
- **`kb-search/`** — pure scoring retrieval of relevant knowledge articles
- **`incident-summarizer/`** — title + root-cause hypothesis for clustered incidents

## Run

From `apps/api/`:

```sh
# Local-only — runs all 5 evals. LLM-judge scorers gracefully skip without ANTHROPIC_API_KEY.
pnpm eval:offline

# Online — uploads to braintrust.dev for diffs across runs and the trace UI.
# Requires BRAINTRUST_API_KEY (https://www.braintrust.dev/app/settings/api-keys).
pnpm eval

# Single eval at a time:
npx braintrust eval --no-send-logs evals/reply-suggester

# Trace what the LLM judge is actually returning:
DEBUG_JUDGE=1 npx braintrust eval --no-send-logs evals/translation
```

By default, the production call sites that have a stub fallback (translation,
classification) run against the stub. Flip env flags to eval the real models:

```sh
USE_REAL_CLASSIFICATION=true USE_REAL_TRANSLATION=true \
  ANTHROPIC_API_KEY=sk-... pnpm eval:offline
```

The LLM-as-judge scorers (accuracy, fluency, faithfulness, hallucination,
helpfulness, actionability) use Claude Sonnet because it follows scoring
rubrics more strictly than Haiku — see `_lib/judge.ts`.

## What gets scored

### `classification/` — 20 cases (en/ht/fr/es)
| Scorer | Range | Signal |
|---|---|---|
| `category_match` | 0/1 | Exact match on 5-category label |
| `severity_proximity` | 0–1 | Adjacent severities partial credit (high↔critical = 0.5) |
| `product_area_match` | 0/1 | Exact match on product area |
| `connectivity_flag` | 0/1 | Network-vs-app distinction |
| `confidence_calibration` | 0–1 | Penalizes overconfident-and-wrong |
| `tag_recall` | 0–1 | Fraction of expected tags emitted (extras allowed — kb-search uses `hasSome`) |

### `translation/` — 20 cases (en↔ht, en↔fr, en↔es, preservation, pass-through, tone)
| Scorer | Range | Signal | Needs key? |
|---|---|---|---|
| `language_detection` | 0/1 | `detectedLanguage` matches source | no |
| `preservation` | 0–1 | Numbers / error codes / IDs survived verbatim | no |
| `length_sanity` | 0/1 | Output length within 0.5–2× of reference | no |
| `pass_through_exact` | 0/1 | source==target ⇒ output==input, confidence==1.0 | no |
| `accuracy_judge` | 0–1 | Claude Sonnet: semantic match to reference | yes |
| `fluency_judge` | 0–1 | Claude Sonnet: native-sounding in target language | yes |

### `reply-suggester/` — 5 scenarios (en, multi-turn, KB hint, vague complaint, connectivity)
| Scorer | Range | Signal | Needs key? |
|---|---|---|---|
| `has_three_suggestions` | 0/1 | Always returns exactly 3 drafts | no |
| `distinct_tones` | 0–1 | All three tones (direct/empathetic/investigative) present | no |
| `length_sanity` | 0–1 | Each draft 30–500 chars | no |
| `fact_reference` | 0–1 | Required facts (account number, error code) appear in ≥1 draft | no |
| `hallucination_judge` | 0–1 | Claude Sonnet: no invented details | yes |
| `helpfulness_judge` | 0–1 | Claude Sonnet: best draft advances toward the ideal next step | yes |

### `kb-search/` — 6 retrieval scenarios (all offline, no API key needed)
| Scorer | Range | Signal |
|---|---|---|
| `recall` | 0–1 | Fraction of expected-relevant IDs returned |
| `precision` | 0–1 | Fraction of returned IDs that were actually relevant |
| `mrr` | 0–1 | Mean reciprocal rank — 1/rank of first relevant hit |
| `no_forbidden` | 0/1 | Hard fail if any forbidden article appears |
| `scores_in_range` | 0–1 | All scores in (0.34, 1.0] |

### `incident-summarizer/` — 4 cluster scenarios
| Scorer | Range | Signal | Needs key? |
|---|---|---|---|
| `produces_non_null` | 0/1 | Returns title + rootCause | no |
| `title_length` | 0/0.5/1 | ≤80 = 1, ≤120 = 0.5, >120 = 0 | no |
| `title_mentions` | 0–1 | Title references expected feature/location keywords | no |
| `no_hallucinated_mentions` | 0/1 | Title doesn't reference version numbers / error codes never given | no |
| `faithfulness_judge` | 0–1 | Claude Sonnet: every claim grounded in the reports | yes |
| `actionability_judge` | 0–1 | Claude Sonnet: useful for an on-call engineer waking up to a page | yes |

## Datasets

Each eval folder has a `dataset.ts` with `~5–20` hand-curated cases covering
the most common scenarios + 1–2 deliberately hard edge cases. Extend as
production traffic reveals failure modes worth pinning behavior on — aim
for `5–10` new cases per iteration, not massive batches.

## Adding a new eval

```
evals/
  <call-site>/
    dataset.ts            # Array of { input, expected, metadata }
    scorers.ts            # async ({ input, output, expected }) => { name, score, metadata? }
    <call-site>.eval.ts   # Eval("name", { data, task, scores })
```

The `braintrust eval evals` command autodiscovers any `*.eval.ts` recursively,
so you don't need to register new files anywhere. For LLM-as-judge scorers,
import `judgeWithClaude` from `../_lib/judge`.

## Production code requirements

For an LLM call site to be evalable, the LLM-calling logic must accept
structured context (not just a DB ID). The pattern used here is:

- Thin wrapper that takes a DB ID and pulls the context: `summarizeIncident(id)`
- Pure exported function the eval targets: `generateIncidentSummary(context)`

If a call site doesn't have this split, refactor it first (it's a small
non-breaking change and improves general testability).

## CI

`.github/workflows/evals.yml` runs the full eval suite on every push to
`main` and every PR that touches the API or evals.

**Setup:** add two repo secrets under Settings → Secrets and variables → Actions:

- `ANTHROPIC_API_KEY` — required. Without it the job logs a warning and skips.
- `BRAINTRUST_API_KEY` — optional. Without it, evals run in `--no-send-logs`
  mode (scores print in logs but aren't uploaded for diff tracking). With it,
  results upload to braintrust.dev and you can diff PR vs `main`.

The workflow only runs when API source or eval files change, so docs-only
or dashboard-only PRs don't burn LLM credits.

**Regression gating (future):** Braintrust supports a `--fail-on` flag for
score-regression gating. To enable, change `pnpm eval` to
`pnpm exec braintrust eval --fail-on regression evals` in the workflow once
you have a baseline experiment on `main`.
