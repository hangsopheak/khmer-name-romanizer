# khmer-name-romanizer

Khmer script → Latin transliteration for **Cambodian personal names** (passport/roster style romanization). Zero runtime dependencies. TypeScript.

**Accuracy (held-out names):** 86/366 roster (leave-one-out) · 99/488 Wikidata citizens (5-fold CV) · 154/366 with the optional FST tier · 70/72 famous Cambodians (in-sample) — [full benchmarks](#accuracy)

```bash
npx khmer-name-romanizer "ហង្ស សុភ័ក្រ្ត"     # Hang Sopheak
npx khmer-name-romanizer --all "សូ បញ្ញា"     # So Panha | So Pagna
```

```ts
import { transliterateName } from 'khmer-name-romanizer'

transliterateName('ហង្ស សុភ័ក្រ្ត')   // "Hang Sopheak"
transliterateName('តាំងលាងខៃ')       // "Tang Leangkhai" (unspaced input is segmented)
```

## Why this library?

- **Khmer doesn't map character-by-character.** It's an abugida — subscripts stack, vowel signs wrap — so naive converters produce gibberish, and scholarly schemes (ALA-LC, ISO 11940) return diacritics no passport uses.
- **Romanization is one-to-many.** តាំង is Tang *and* Taing; សូ បញ្ញា is So Panha *and* So Pagna. A single-guess tool is wrong by construction — this library returns ranked `candidates`.
- **The only strong name-oriented engine** ([khmer-latin-name-transformer](https://pypi.org/project/khmer-latin-name-transformer/)) **is Python-only.** This one is pure TypeScript, synchronous, fully offline (names are PII — nothing leaves your process), and runs in browser, Node, and CLI.

### A suggestion engine, not an authority

Only the name owner knows their official spelling — no algorithm can know what a family declared at birth registration. So this library **suggests, recommends, and matches**; it never decides. Treat `value` and `candidates` as **pre-fills for a human decision** — never auto-write them onto an ID, diploma, bank record, or civil registry.

| Mode | Use it for |
|---|---|
| **Suggest** | Rosters, HR onboarding, registration forms, autofill — pre-fill ranked spellings; the person or registrar confirms |
| **Match** | KYC/fintech, people search & dedup — score whether a Khmer-script and a Latin-script name belong to the same person (rank against `candidates`, not just `value`; enable `flipOrderCandidates: true` for order-insensitive matching — Khmer writes the surname first) |
| **Display** | Readable Latin alongside Khmer for non-Khmer-reading staff; batch migration — propose candidates, flag low-confidence rows for review |

**Not for:** deciding anyone's official spelling, general prose transliteration, Sanskrit-derived regnal names (*-varman* kings), or foreign names written in Khmer.

## Pipeline

```text
Khmer input
  │ 0. normalize      strip zero-width chars, ':' → ៈ, collapse whitespace
  │ 0b. strip         leading honorifics/titles removed (reported as `honorifics`)
  │ 1. tokenize       split on spaces → surname / given-name tokens
  │ 2. per token, first hit wins:
  │      a. tokenDict       776 learned Khmer → Latin word entries
  │      b. segmentation    longest-match DP splits unknown tokens into known words
  │      c. FST             optional pre-computed pynini readings, injected as a map
  │      d. rules           calibrated grapheme-level fallback (romanizeKhmer)
  │ 3. alternatives    per token: dictionary variants, FST/rule readings, spelling alternations
  │ 4. ranking         compose per-token options into ranked full-name candidates
  ▼
{ value, source, tokens, candidates }
```

- **Normalize & strip** — strip zero-width characters, map roster-typo `:` → ៈ, collapse whitespace. Leading honorifics/titles (ព្រះ, សម្តេច, ព្រះបាទ, លោក, អ្នកម្នាង, ឧកញ៉ា, ពញា…, royal compounds even when glued to the name) are not part of a personal name: they are removed before resolving and reported in an optional `honorifics` field — `សម្តេច ហ៊ុន សេន` → `"Hun Sen"` with `honorifics: ["សម្តេច"]`.
- **Tokenize** — space-separated surname/given-name tokens; unspaced input (តាំងលាងខៃ) is segmented against dictionary keys first.
- **Resolve each token**, strongest tier first: **token dictionary** (776 entries learned from verified bilingual rosters, well-known people, and Wikidata mining; a hit returns the canonical `latin`, its `variants` lead the alternatives) → **segmentation** (longest-match DP, trusted only when every non-dictionary remainder is ≥ 3 characters) → **FST** (readings pre-computed with pynini, injected as a lookup map via `t.fstInputs()` — the library stays pure and synchronous) → **rules** (`romanizeKhmer`, a grapheme-level fallback calibrated on the same rosters).
- **Alternatives & ranking** — each token collects spellings from dictionary `variants`, other tiers' readings, and attested alternations (nh/gn, t/th, n/nn, u/ou, i/y…); top options compose ranked full-name candidates, deduped and capped at `maxCandidates` (default 5).

### Result shape

```ts
import { createTransliterator } from 'khmer-name-romanizer'

const t = createTransliterator({
    tokenDict: { ... },                        // extend the bundled dictionary
    fstResults: new Map([['ដារា', 'Dara']]),  // optional injected FST tier
})
const result = t.transliterate('តាំង ដារា')
// {
//   value: 'Tang Dara',                             // best spelling — always candidates[0]
//   source: 'tokens',                               // tokens | fst | rules (weakest token tier)
//   tokens: [...],                                  // per token: khmer, latin, source, alternatives[]
//   candidates: ['Tang Dara', 'Taing Dara', ...]    // ranked possibilities
// }
```

The CLI prints candidates pipe-separated with `--all`.

## Accuracy

Benchmarked on 366 verified Khmer↔English pairs from university rosters (exact match; similarity = difflib ratio):

| System | Exact | ≥0.90 | ≥0.75 | Mean sim |
|---|---|---|---|---|
| Rule engine only | 57/366 | 170/366 | 327/366 | 0.875 |
| **This package, unseen names** (leave-one-out) | **86/366** (124 in top-5) | 197/366 | 338/366 | 0.893 |
| With the optional FST tier (leave-one-out) | 154/366 (216 in top-5) | 259/366 | 355/366 | 0.930 |
| This package, in-sample | 341/366 (365 in top-5) | 358/366 | 366/366 | 0.994 |

The leave-one-out rows are the honest numbers — dictionaries are rebuilt without the tested name, so a new student's name scores like those.

**Famous names (72)** — royalty, Angkor kings, prime ministers, film stars, singers, monks (`npm run eval:famous`): **70/72 exact**, 0.989 mean. Before these tokens were bundled, the same kind of name scored 15% — the dictionary is what famous-name accuracy is made of.

**Wikimedia + curated corpus** — ~2,400 scraped Khmer↔Latin pairs from seven SPARQL passes (kmwiki humans, Cambodian citizens, P1559 *native-name* and P1477 *birth-name* statements — Cambodians whose native name never appears as a label, km/en article *titles*, all humans with both labels, given-/family-name items — the latter are foreign transcriptions and land in the out-of-domain bucket), **Wikipedia redirects** (km-side alternate spellings become new rows; en-side spellings feed `variants` via `altLatin`), and two curated openly-licensed name lists (`scripts/sources/`: [kname](https://github.com/kennntech/kname), MIT — Cambodian name tokens; [popular-names-by-country](https://github.com/sigpwned/popular-names-by-country-dataset), CC0 — most-common KH surnames with Google-Translate artifacts filtered out). Scraping is incremental and failure-tolerant; the full refresh loop is `scrape:names` → `split:corpus` → `eval:scraped` → `mine:tokens` → `merge:tokens`, where `split:corpus` first freezes a held-out test split and `merge:tokens` regenerates `src/token-data.ts` in-repo. The frozen test split (`scripts/test-split.json`, ~15%, content-hash assignment so refreshes never reshuffle it) is the project's lockbox — never mined into the dictionary, never used for tuning: `mine:tokens` reads only `dev-split.json`, and `npm run split:corpus -- --check` verifies the frozen files against the corpus.

| Corpus | n | Exact | Top-5 | Mean sim |
|---|---|---|---|---|
| Cambodian citizens | 488 | 140 (28.7%) | 194 (39.8%) | 0.783 |
| Curated name lists (MIT/CC0) | 129 | 98 (76.0%) | 110 (85.3%) | 0.920 |
| All in-domain (+ historical/regnal) | 834 | 251 (30.1%) | 323 (38.7%) | 0.740 |
| Foreign names written in Khmer (out of domain) | 1544 | 30 (1.9%) | 47 (3.0%) | 0.631 |

**How honest are those numbers?** The table scores the shipped dictionary on this corpus — but that dictionary already contains ≥2-attestation tokens mined *from* the dev split, so those rows are partly in-sample. `npm run eval:kfold` runs 5-fold cross-validation: per fold it rebuilds the leakage-free dictionary the package would ship without the test fold, then scores only that fold:

| Citizens (488) | Exact | Top-5 | Mean sim |
|---|---|---|---|
| Shipped dictionary (partly in-sample) | 140 (28.7%) | 194 (39.8%) | 0.783 |
| **5-fold CV (leakage-free)** | **99 (20.3%)** | **150 (30.7%)** | 0.765 |

The k-fold figure is the honest unseen-name number, in line with the roster leave-one-out (23.5% exact). Note what leakage inflates: exact-form recall drops 8.4pp, but mean similarity barely moves (0.783 → 0.765) — unseen guesses stay near-misses, with the official spelling usually still in `candidates`. Known weak spot: regnal names, a different register this package does not target. `scripts/mined-tokens.json` keeps candidate tokens for review; tokens with ≥2 attestations are merged, conflicting corpus spellings with ≥2 attestations (Samnang for សំណាង, Rattana for រតនា…) are folded in as `variants`, kname tokens are trusted at a single attestation (measured 25/30 agreement + 5 legitimate variants vs the verified dictionary), and hand-reviewed junk is block-listed (bible-apostle titles, citizenship-less foreign figures, mis-aligned birth-name/redirect artifacts).

**The frozen lockbox.** `npm run split:corpus` freezes a held-out test split (~15%, content-hash assignment — refreshes never reshuffle it) that is never mined and never tuned on; `npm run eval:holdout` scores it against the counterfactual dictionary the package would ship without it. This is the number every improvement round is judged by:

| Frozen test split (108 in-domain) | Exact | Top-5 | Mean sim |
|---|---|---|---|
| Shipped dictionary (upper bound) | 24 (22.2%) | 33 (30.6%) | 0.714 |
| **Holdout counterfactual (lockbox)** | **19 (17.6%)** | **28 (25.9%)** | **0.705** |

Cambodian-citizen rows: 10/63 shipped vs **6/63 holdout** exact — the gap is leakage, the lockbox row is the truth.

**One-to-many is inherent.** The dictionary stores the most frequent spelling per token (ties go closest to the rule reading) and keeps alternatives in `variants`. When you know a person's official spelling, keep your own Khmer→Latin map and override tokens via `tokenDict`.

## Extending the dictionary

```json
{ "តាំង": { "latin": "Tang", "count": 4, "variants": { "Taing": 2 } } }
```

`latin` is the canonical output; `variants` documents observed alternative spellings with frequencies. Pass merged data via `createTransliterator({ tokenDict })` or `createDefaultTransliterator({ tokenDict: yourOverrides })`.

## License

MIT © Hang Sopheak (ហង្ស សុភ័ក្រ្ត)
