# khmer-name-romanizer

Khmer script → Latin transliteration for **Cambodian personal names** (passport/roster style romanization). Zero runtime dependencies. TypeScript.

```bash
npx khmer-name-romanizer "ហង្ស សុភ័ក្រ្ត"
# ហង្ស សុភ័ក្រ្ត	Hang Sopheak
npx khmer-name-romanizer --all "សូ បញ្ញា"
# សូ បញ្ញា	So Panha | So Pagna
```

```ts
import { transliterateName } from 'khmer-name-romanizer'

transliterateName('ហង្ស សុភ័ក្រ្ត')   // "Hang Sopheak"
transliterateName('តាំងលាងខៃ')       // "Tang Leangkhai" (unspaced input is segmented)
```

## Pipeline

Every name flows through five stages; each stage falls through to the next when it can't fully resolve a token:

```text
Khmer input
  │ 0. normalize      strip zero-width chars, ':' → ៈ, collapse whitespace
  │ 1. tokenize       split on spaces → surname / given-name tokens
  │ 2. per token, first hit wins:
  │      a. tokenDict       772 learned Khmer → Latin word entries
  │      b. segmentation    longest-match DP splits unknown tokens into known words
  │      c. FST             optional pre-computed pynini readings, injected as a map
  │      d. rules           calibrated grapheme-level fallback (romanizeKhmer)
  │ 3. alternatives    per token: dictionary variants, FST/rule readings, spelling alternations
  │ 4. ranking         compose per-token options into ranked full-name candidates
  ▼
{ value, source, tokens, candidates }
```

**0 · Normalize.** Zero-width characters are stripped, roster-typo ASCII `:` is mapped to ៈ (yuukaleapintu), whitespace collapses.

**1 · Tokenize.** Khmer names are space-separated components (`surname givenName`). An input with no spaces at all (តាំងលាងខៃ) is first segmented against dictionary keys — if it covers fully, the segments become the name components.

**2 · Per-token chain** — each token resolves at the strongest tier that knows it:

- **a. Token dictionary** — 772 Khmer word → canonical Latin word entries (surname and given-name tokens) learned from verified bilingual student-name data, a Wikipedia-verified well-known-people set, and Wikidata corpus mining. A direct hit returns the canonical `latin`; its observed `variants` lead the alternatives.
- **b. Segmentation** — unknown tokens are split by a longest-match DP that maximizes covered characters, then minimizes segment count. The split is trusted only when every non-dictionary remainder is ≥ 3 characters (shorter remainders, like orphan vowel signs, would be shredded by the rules). If the remainder was rules-only but a whole-token FST reading exists, the FST reading wins instead.
- **c. FST** — readings pre-computed out-of-process with [khmer-latin-name-transformer](https://pypi.org/project/khmer-latin-name-transformer/) (pynini). The caller batches inputs with `t.fstInputs(names)` and injects the results as a lookup map — the library stays pure and synchronous; missing keys just fall through.
- **d. Rule engine** — `romanizeKhmer`, a grapheme-level fallback calibrated on the same roster pairs, for tokens the dictionary has never seen.

**3 · Alternatives.** Every token collects alternative spellings from dictionary `variants`, the other tiers' readings (FST, rules), and spelling alternations attested in roster data (nh/gn, final y/i, t/th, n/nn, n/rn, u/ou, i/y).

**4 · Candidate ranking.** The best option of each token forms `value`. Full-name candidates are combinations of the top 4 options per token, ordered by the sum of per-token ranks — "all first choices" outranks "one third choice". A whole-name FST reading (a different segmentation of the same syllable stream) slots in right after the best composed candidate unless it dropped syllables (< 80% of its length). The list is deduped and capped at `maxCandidates` (default 5).

### Result shape

```ts
import { createTransliterator, romanizeKhmerName } from 'khmer-name-romanizer'

const t = createTransliterator({
    tokenDict: { ... },                                   // extend the bundled dictionary
    fstResults: new Map([['ដារា', 'Dara']]),             // optional injected FST tier
})
const result = t.transliterate('តាំង ដារា')
// {
//   value: 'Tang Dara',                    // best single spelling — always candidates[0]
//   source: 'tokens',                      // tokens | fst | rules (weakest token tier)
//   tokens: [...],                         // per token: khmer, latin, source, alternatives[]
//   candidates: ['Tang Dara', 'Taing Dara', ...]   // ranked possibilities
// }
```

So yes — **`candidates` is the array of possibilities**: Khmer names officially romanize several ways (សូ បញ្ញា is "So Panha" *and* "So Pagna"), so besides `value` every result carries the ranked `candidates`, and every token its own `alternatives`. Offer them as choices whenever you don't know the person's official spelling:

```ts
createDefaultTransliterator().transliterate('សូ បញ្ញា').candidates
// ['So Panha', 'So Pagna']
```

The CLI prints the same thing pipe-separated with `--all`. `maxCandidates` (default 5) limits the list.

## Accuracy

Benchmarked on 366 verified Khmer↔English name pairs from university rosters (exact match; similarity = difflib ratio).

| System | Exact | ≥0.90 | ≥0.75 | Mean sim |
|---|---|---|---|---|
| Rule engine only | 57/366 | 170/366 | 327/366 | 0.875 |
| **This package on unseen names** (token dictionary + rules, leave-one-out) | **86/366** (124 in top-5 candidates) | 197/366 | 338/366 | 0.893 |
| With the optional FST tier, unseen names (leave-one-out) | 154/366 (216 in top-5) | 259/366 | 355/366 | 0.930 |
| This package on names it was built from (in-sample) | 341/366 (365 in top-5) | 358/366 | 366/366 | 0.994 |

The leave-one-out rows are the honest numbers: the dictionaries are rebuilt without the tested name, so a new student's name scores like those. The in-sample row mostly shows that the bundled dictionary reproduces the rosters it came from.

### Famous-names regression

`npm run eval:famous` checks 72 well-known Cambodians — royalty from Suramarit to Princess Jenna, ancient Angkor kings, prime ministers, generals, golden-age film stars, top pop singers, an Asian Games gold medalist, monks, journalists and novelists — with Khmer spellings from Khmer Wikipedia and official Latin spellings from English Wikipedia. It is what drove the bundled well-known-people tokens:

| Famous names (72) | Exact | Top-5 | Mean sim |
|---|---|---|---|
| **Bundled dictionary** | **70/72** | 70/72 | 0.989 |

Before these tokens were added, the same kind of name scored 15% exact (8/52 on the original set) — the dictionary is what famous-name accuracy is made of.

The two misses are both structural, not bugs: ប៉ែន រ៉ន → "Penn Rorn" vs official "Pan Ron" (one-to-many — this singer's ប៉ែន spells "Pan" while most spell Pen/Penn, and the official reading lands just past the default 5-candidate cutoff; `maxCandidates` digs it out), and អ៊ឹង លឿង → "Ung Loung" vs the author's English name "Loung Ung" (Khmer writes surname first; she reverses it in English — composition correctly preserves Khmer order).

### Scraped-corpus reliability (Wikidata)

A stdlib-only Python scraper (`scripts/scrape_names.py`) pulls every human with a Khmer Wikipedia article plus every Cambodian citizen from the Wikidata SPARQL endpoint — ~1,500 unique Khmer↔Latin name pairs, cleaned of honorifics (សម្តេច, ព្រះ, លោក…), regnal ordinals, and non-name junk. Run the whole pipeline with `npm run scrape:names`, `npm run eval:scraped`, `npm run mine:tokens`:

| Scraped corpus (unseen names) | n | Exact | Top-5 | Mean sim |
|---|---|---|---|---|
| Cambodian citizens | 385 | 107 (27.8%) | 154 (40.0%) | 0.805 |
| + historical/regnal names | 552 | 117 (21.2%) | 168 (30.4%) | 0.729 |
| Foreign names written in Khmer (out of domain) | 957 | 17 (1.8%) | 28 (2.9%) | 0.623 |

The Cambodian-citizen row is the reliability headline: on names the dictionary has never seen, it lands within the leave-one-out roster range (23.5% exact there, 27.8% here), which is what correct generalization looks like — official spellings of unseen names are one-to-many, so `candidates` is where the rest of the truth lives. Known weak spot: Sanskrit-derived regnal names (the *-varman* kings), a different register this package does not target. `scripts/mined-tokens.json` keeps 455 candidate tokens and 47 canonical conflicts found by mining for future review; tokens with ≥2 attestations are already merged into the dictionary.

**One-to-many is inherent.** Khmer names officially romanize multiple ways (តាំង is both "Tang" and "Taing"; គឹម is both "Kim" and "Koem"). The dictionary stores the most frequent spelling per token (ties go to the spelling closest to the rule-engine reading) and keeps the alternatives in `variants`. When you know a person's official spelling, check your own Khmer→Latin map first, or override the tokens via `tokenDict`. The 25 in-sample errors are almost all such alternative spellings, backed by a single roster entry each.

## Extending the dictionary

`TokenDictionaryData` entries are plain objects:

```json
{
  "តាំង": { "latin": "Tang", "count": 4, "variants": { "Taing": 2 } }
}
```

`latin` is the canonical output; `variants` documents observed alternative official spellings with their frequencies. Pass merged data via `createTransliterator({ tokenDict })` or `createDefaultTransliterator({ tokenDict: yourOverrides })`.

## License

MIT © Hang Sopheak (ហង្ស សុភ័ក្រ្ត)
