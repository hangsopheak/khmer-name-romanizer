# khmer-name-romanizer

Khmer script → Latin transliteration for **Cambodian personal names** (passport/roster style romanization). Zero runtime dependencies. TypeScript.

```bash
npx khmer-name-romanizer "តាំង លាងខៃ"
# តាំង លាងខៃ	Tang Leangkhai
npx khmer-name-romanizer --all "សូ បញ្ញា"
# សូ បញ្ញា	So Panha | So Pagna
```

```ts
import { transliterateName } from 'khmer-name-romanizer'

transliterateName('តាំង លាងខៃ')   // "Tang Leangkhai"
transliterateName('តាំងលាងខៃ')     // "Tang Leangkhai" (unspaced input is segmented)
```

## How it works

Names are transliterated through a chain of tiers, each more general than the last:

1. **Token dictionary** — 601 Khmer word → canonical Latin word entries (surname and given-name tokens) learned from verified bilingual student-name data. A name whose tokens are all known is composed from official spellings.
2. **Segmentation** — unspaced input (តាំងលាងខៃ) is segmented against dictionary keys with a longest-match DP, so name components are recovered even without spaces.
3. **Optional FST** — callers can batch [khmer-latin-name-transformer](https://pypi.org/project/khmer-latin-name-transformer/) (pynini) results and inject them; the library stays pure/synchronous.
4. **Rule engine** — a calibrated grapheme-level fallback (`romanizeKhmer`) for tokens the dictionary has never seen.

```ts
import { createTransliterator, romanizeKhmerName } from 'khmer-name-romanizer'

const t = createTransliterator({
    wholeNameDict: { តាំងលាងខៃ: 'Taing Leangkhai' }, // your official spellings, tier 0
    tokenDict: { ... },                                   // extend the bundled dictionary
    fstResults: new Map([['ដារា', 'Dara']]),             // optional injected FST tier
})
const result = t.transliterate('តាំង ដារា')
// { value: 'Tang Dara', source: 'fst', tokens: [...], candidates: ['Tang Dara', 'Taing Dara', ...] }
```

### Multiple spellings

A Khmer name often has several official romanizations (សូ បញ្ញា is "So Panha" and also "So Pagna"). Every result carries ranked `candidates`, with `value` first. Each token also has its own `alternatives`. They come from dictionary variants, FST and rule readings, and a few spelling alternations attested in roster data (nh/gn, final y/i, t/th, n/nn, n/rn, u/ou). Offer them as choices when you don't know the official spelling:

```ts
createDefaultTransliterator().transliterate('សូ បញ្ញា').candidates
// ['So Panha', 'So Pagna']
```

`maxCandidates` (default 5) limits the list.

## Accuracy

Benchmarked on 366 verified Khmer↔English name pairs from university rosters (exact match; similarity = difflib ratio).

| System | Exact | ≥0.90 | ≥0.75 | Mean sim |
|---|---|---|---|---|
| Rule engine only | 57/366 | 170/366 | 327/366 | 0.875 |
| **This package on unseen names** (token dictionary + rules, leave-one-out) | **86/366** (124 in top-5 candidates) | 197/366 | 338/366 | 0.893 |
| With the optional FST tier, unseen names (leave-one-out) | 154/366 (216 in top-5) | 259/366 | 355/366 | 0.930 |
| This package on names it was built from (in-sample) | 341/366 (365 in top-5) | 358/366 | 366/366 | 0.994 |

The leave-one-out rows are the honest numbers: the dictionaries are rebuilt without the tested name, so a new student's name scores like those. The in-sample row mostly shows that the bundled dictionary reproduces the rosters it came from.

**One-to-many is inherent.** Khmer names officially romanize multiple ways (តាំង is both "Tang" and "Taing"; គឹម is both "Kim" and "Koem"). The dictionary stores the most frequent spelling per token (ties go to the spelling closest to the rule-engine reading) and keeps the alternatives in `variants`. When you know a person's official spelling, add it via `wholeNameDict`. The 25 in-sample errors are almost all such alternative spellings, backed by a single roster entry each.

## Extending the dictionary

`TokenDictionaryData` entries are plain objects:

```json
{
  "តាំង": { "latin": "Tang", "count": 4, "variants": { "Taing": 2 } }
}
```

`latin` is the canonical output; `variants` documents observed alternative official spellings with their frequencies. Pass merged data via `createTransliterator({ tokenDict })` or `createDefaultTransliterator({ tokenDict: yourOverrides })`.

## License

MIT
