# khmer-name-romanizer

Khmer script → Latin transliteration for **Cambodian personal names** (passport/roster style romanization). Zero runtime dependencies. TypeScript.

**Accuracy (unseen names):** 86/366 exact roster matches · 154/366 with the optional FST tier · 70/72 famous Cambodians — [full benchmarks](#accuracy)

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
| **Match** | KYC/fintech, people search & dedup — score whether a Khmer-script and a Latin-script name belong to the same person (rank against `candidates`, not just `value`) |
| **Display** | Readable Latin alongside Khmer for non-Khmer-reading staff; batch migration — propose candidates, flag low-confidence rows for review |

**Not for:** deciding anyone's official spelling, general prose transliteration, Sanskrit-derived regnal names (*-varman* kings), or foreign names written in Khmer.

## Pipeline

```text
Khmer input
  │ 0. normalize      strip zero-width chars, ':' → ៈ, collapse whitespace
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

- **Normalize** — strip zero-width characters, map roster-typo `:` → ៈ, collapse whitespace.
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

**Wikimedia corpus** — ~1,800 scraped Khmer↔Latin pairs from five SPARQL passes (kmwiki humans, Cambodian citizens, all humans with km+en labels, km/en article *titles*, given-/family-name items — the latter are foreign transcriptions and land in the out-of-domain bucket). Scraping is incremental and failure-tolerant; the full refresh loop is `scrape:names` → `eval:scraped` → `mine:tokens` → `merge:tokens`, where `merge:tokens` regenerates `src/token-data.ts` in-repo:

| Corpus | n | Exact | Top-5 | Mean sim |
|---|---|---|---|---|
| Cambodian citizens | 414 | 118 (28.5%) | 167 (40.3%) | 0.804 |
| + historical/regnal names | 598 | 128 (21.4%) | 181 (30.3%) | 0.724 |
| Foreign names written in Khmer (out of domain) | 1198 | 23 (1.9%) | 36 (3.0%) | 0.622 |

On unseen Cambodian-citizen names the package lands within its leave-one-out range (28.5% vs 23.5% exact) — correct generalization, with the rest of the truth in `candidates`. Known weak spot: regnal names, a different register this package does not target. `scripts/mined-tokens.json` keeps 472 candidate tokens for review; tokens with ≥2 attestations are merged, and conflicting corpus spellings with ≥2 attestations (Samnang for សំណាង, Rattana for រតនា…) are folded in as `variants` while the verified canonicals stay untouched.

**One-to-many is inherent.** The dictionary stores the most frequent spelling per token (ties go closest to the rule reading) and keeps alternatives in `variants`. When you know a person's official spelling, keep your own Khmer→Latin map and override tokens via `tokenDict`.

## Extending the dictionary

```json
{ "តាំង": { "latin": "Tang", "count": 4, "variants": { "Taing": 2 } } }
```

`latin` is the canonical output; `variants` documents observed alternative spellings with frequencies. Pass merged data via `createTransliterator({ tokenDict })` or `createDefaultTransliterator({ tokenDict: yourOverrides })`.

## License

MIT © Hang Sopheak (ហង្ស សុភ័ក្រ្ត)
