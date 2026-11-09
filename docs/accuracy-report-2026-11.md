# Accuracy Report — November 2026

> **Superseded numbers.** Sections 1–7 use the v1 eval (row-hashed
> lockbox, round-robin k-fold over the full corpus). Section 0 below
> shows the pre-release audit (2026-11-09) that found leaks in it, and
> the v2 baseline that replaces it. Compare only v2 numbers with v2
> numbers.

## 0. Eval v2 — the 0.4.0 baseline (2026-11-09)

| Benchmark | v1 method | v2 method |
|---|---|---|
| K-fold CV, in-domain exact | 29.6% (251/848) | **24.4%** (169/692, CI 21.4–27.8) |
| K-fold CV, top-5 | 38.1% | **32.4%** (CI 29.0–35.9) |
| K-fold CV, match mode (top-10, order-insensitive) | 59.7% (in-sample `eval:match`) | **33.2%** (CI 29.8–36.8) |
| Lockbox, exact | 25.7% (28/109) | **24.0%** (31/129, CI 17.5–32.1) |
| Lockbox, top-5 | 34.9% | **30.2%** |

What v2 changed, and why:

1. **Person-grouped splits.** v1 hashed each `khmer\tlatin` row, so
   different spellings of one person landed on both sides. v2 groups
   rows by normalized Khmer name (honorifics stripped, spaces removed),
   Wikidata QID, and multi-word Latin name, then splits whole groups.
   v1 k-fold assigned folds round-robin over Khmer-sorted rows, which
   put adjacent near-duplicates in different folds by construction.
2. **Hand-authored rows are training-only.** Native-review pairs were
   scored against the dictionary pins the same reviewer wrote. They now
   stay in dev (with their whole group) and are never scored.
3. **Stricter counterfactual.** A bundled key that test rows attest
   survives only if the train rows alone would have admitted it: at
   least one independent (non-hand-authored) attestation, and min-2 or
   a trusted static list. v1 stripped a key only when ALL its support
   was in test, so keys lifted past min-2 by a test row, and manual
   pairs whose only evidence was a lockbox row (វេជ្ជរ៉ា → Vichara,
   ធាមតេង → Theam Teng), survived.
4. **K-fold reads the dev split only**, so development decisions never
   touch lockbox rows. `eval:holdout` no longer prints lockbox misses.

Attribution of the v1 lockbox's rise from 21/108 to 28/109 during the
native-review rounds: 2 hits were the reviewer's own manual rows, 2
came from manual pairs whose only evidence was a lockbox row, 1 was a
cross-split duplicate (Prom Nhem), and 3 miss rows were deleted from
the corpus. About 2 were genuine gains (for example ស៊ូ → Sou, with
independent dev support).

**0.4.0 release (after the singleton merge class, see CHANGELOG):**
k-fold **25.6%** exact (177/692, CI 22.5–29.0), 34.1% top-5, 35.1%
match mode; paired vs. the v2 baseline +9/−1 exact, +12/−1 top-5.
Lockbox release read **24.8%** (32/129, CI 18.2–32.9), 31.0% top-5.

Process rules from v2 on: judge every round on `eval:kfold`; read the
lockbox once per release; never choose correction candidates from
lockbox rows.

## 0.5.0 — learned alternatives and French-style conventions (2026-11-09)

Same v2 method, same 692 dev eval rows. Every step was judged on
`eval:kfold` with a paired row-by-row diff (`--rows` +
`scripts/diff-kfold-rows.mjs`); the lockbox was read once, at the end.

| Step | K-fold exact | K-fold top-5 | Paired exact | Paired top-5 |
|---|---|---|---|---|
| 0.4.0 baseline | 177 (25.6%) | 236 (34.1%) | — | — |
| Learned spelling alternatives | 177 | 273 | +0/−0 | +38/−1 |
| 10 owner-spelled words | 177 | 273 | +0/−0 | +0/−0 |
| French conventions, round 1 | 186 | 278 | +16/−7 | +8/−3 |
| Round 2 (ឆ ឌ ប, final ា) | 196 | 289 | +11/−1 | +12/−1 |
| Round 3 (សំ, inner ា, ៃ, ាំង, ុយ) | 200 | 297 | +4/−0 | +8/−0 |
| Round 4 (ិត្រ, ឌ្ឍ, ភា, ូ, ែន/ែម) | **208 (30.1%)** | **302 (43.6%)** | +10/−2 | +5/−0 |

0.5.0 vs. 0.4.0, paired: exact +41/−10 rows (sign test p = 0.00002),
top-5 +71/−5, match mode 243 → 311 (35.1% → 44.9%). Counted once per
person group (one person can have several Khmer spellings, e.g. Dith
Pran has five rows): exact +35/−10, top-5 +65/−5. Citizens exact
95 → 122 (23.9% → 30.7%).

**Lockbox release read:** exact 32 → **37/129** (24.8% → 28.7%, CI
21.6–37.0), top-5 40 → **50/129** (31.0% → 38.8%), citizens 23/79
exact. Consistent with the k-fold, with top-5 a little lower; the
lockbox has 129 rows, so its CI is wide.

**How the learned tier stays leakage-free.** Each k-fold fold learns
its rewrite table from its train folds only; `eval:holdout` learns it
from the dev rows; the shipped table learns from the dev split and
never from `test-split.json`.

**How the conventions were chosen.** The repo owner, a native reader,
answered four rounds of yes / both / no questions about spelling
conventions. The candidate list came from the most frequent rules-vs-
official edits on the dev split, so each round carries some risk of
fitting those rows; the guard was to test each rule on its own, keep
only rules with a net gain, and count per person. Rejected: final ី →
y (−2), ឹ → e (−4), final ត → t (−2), ិ + final → e (−15), open final
ោ → or (−1). The French reading is the first guess; the plain reading
stays an equal-weight alternative, so a rule that is wrong for a name
still leaves its old spelling in the candidates.

**The exact-match ceiling.** Of the 165 Khmer words with two or more
official attestations in the dev split (cambodian + curated rows), 103
(62%) have more than one official spelling. An oracle that always
picks each word's most common official spelling matches 72.0% of the
attestations — roughly half of two-word names. Unseen-name exact
should be read against that bar, not against 100%.

**Remaining misses.** Of the 390 k-fold rows that miss the top-5, 362
are vocabulary gaps (miss autopsy: the official word is not reachable
from any option). Most are several letters away from the rules
reading, which letter rules cannot fix; new dictionary words can.

State of accuracy after the algorithm improvement arc (Phases 3–6) and the
2026-11-01 refresh round, measured against the committed eval reports at
commit `c65ea84` (arc) and this round's regenerated reports.
All numbers are reproducible: `npm run eval:famous` · `eval:scraped` ·
`eval:kfold` · `eval:holdout`.

## 1. What changed this session

| Improvement | Effect on lockbox (108 held-out names) | Effect elsewhere |
|---|---|---|
| Phase 3: probability scoring + `scoredCandidates` | 0 — held 21 exact, mean 0.717 **by design**: probability-promoting dictionary variants cost 18 famous exacts in calibration (70→52), so reviewed canonicals stay pinned | Exposed Σ log P scores for matching workflows |
| Phase 5: syllable lexicon + compositor | *Not shipped* — loses to the rules as a single guess (72 vs 76 exact, LOO) | Probe committed: `scripts/probe-syllable-compositor.mjs` |
| Phase 6: segmentation upgrades | *Not shipped* — the DP already beats rules (18 vs 13); trust relaxation gains 0; n-best rescues ≤3/102 | Probe committed: `scripts/probe-segmentation.mjs` |
| 2026-11-01: alternation-swap injection | 0 — gate held 21/31/0.721 (swaps cannot outscore the leader by construction) | Structural fix: official alternation spellings the per-token option cap discarded ("Sin"→"Sinn") can now appear as candidates; measured dev-CV rescue count 0 today |
| 2026-11-01: corpus refresh | 0 — gate held **21/31/0.721**; in-domain lockbox rows unchanged (108) | kfold **201→204/835 exact, 270→276 top-5**; shipped eval 281→282/835 |

## 2. Current accuracy

| Benchmark | Exact (top-1) | In top-5 | Mean similarity |
|---|---|---|---|
| Famous Cambodians (72, in-sample) | **70 (97.2%)** | 70 (97.2%) | 0.989 |
| Curated name lists (129) | **104 (80.6%)** | 116 (89.9%) | 0.944 |
| Citizens, shipped dict (489)* | 160 (32.7%) | 224 (45.8%) | 0.796 |
| **Citizens, 5-fold CV (honest unseen)** | **109 (22.3%)** | **164 (33.5%)** | **0.773** |
| All in-domain, 5-fold CV (835) | 204 (24.4%) | 276 (33.1%) | 0.733 |
| **Lockbox counterfactual (the judge)** | **21 (19.4%)** | **31 (28.7%)** | **0.721** |
| Foreign names in Khmer (out of scope) | 32/1585 (2.0%) | 49 (3.1%) | 0.634 |

\* partly in-sample (dictionary mined from the same corpus); the CV and
lockbox rows are the honest unseen-name numbers. The lockbox
(`scripts/test-split.json`) is frozen, never mined, never tuned on.

## 3. Two different accuracy stories

**Known names: excellent.** Famous, curated, and roster names score
80–97% exact because the dictionary knows them. Workloads matching
against real Cambodian name distributions hit this tier often.

**Unseen names: ~20% exact — honest, but needs context:**

- Mean similarity is **0.72–0.77**: misses are near-misses, not gibberish
- The official spelling sits in `candidates` (top-5) about a third of the
  time — the working metric for the library's stated use case
- This is a **suggestion engine by design** (README: "it suggests,
  recommends, and matches; it never decides") — outputs are pre-fills
  for a human decision, not auto-written official spellings

## 4. Why top-1 exact is capped — where misses come from

| Limiting factor | Share of unseen-name misses | Fixable by algorithms? |
|---|---|---|
| **One-to-many walls** — ប៉ែន is *Penn Nuth* AND *Pan Ron*; only the name owner knows which is official | Largest single class | **No.** Proven this session: letting corpus counts demote reviewed canonicals cost 18 famous exacts |
| **Vocabulary gaps** — 560 unseen dev tokens had no dictionary prefix at all | Large and dominant | **No** — missing data, not a missing algorithm |
| Out-of-scope names (regnal kings, foreign transcriptions) | ~20% of corpus rows | Out of scope by declaration |
| Corpus noise (Wikidata short-forms: គឹមហួន → "Kim") | Small | No |

## 5. The 2026-11-01 refresh round

The full loop ran: `scrape:names` → `split:corpus` (lockbox verified) →
`eval:scraped` → `mine:tokens` → human review → `merge:tokens` →
eval ladder → gate read.

- **Corpus 2,390 → 2,432 pairs** (+42: 3 cambodian, 4 unknown, 47 foreign,
  −12 junk exclusions net). The family-name SPARQL source was lost to
  repeated Wikidata 504s (small: the given-name pass yields ~30 rows);
  everything else landed.
- **Lockbox verified, not reshuffled**: the content-hash assignment kept
  every surviving row in place — 0 flips, 0 vanished rows across the
  2,390-row previous corpus. The test split grew 355 → 365; all 10 new
  rows are foreign-bucket, so the in-domain lockbox denominator stays 108
  and the gate remains directly comparable.
- **Mining net effect: +0 entries, +1 variant.** The +42 rows are mostly
  out-of-domain; the x2-attested "new" tokens were dominated by the
  2026-10-31 junk blocklist doing its job. Human review added three
  blocks: `បូរេ៉ត` (a combining-mark reordering of the junk-blocked
  បូរ៉េត — same Long Boret mis-alignment, different bytes) and
  `ឡុង|Boret` / `ឡុង|Boreth` (reversed-order alignment of the same name);
  `ជួន` +Choun is the one legitimate enrichment. One shipped-dict top-5
  row moved (365→364) — Choun-compositions crowd out a rank-5 candidate
  on a ជួន name — while every honest metric rose.
- **Distill unchanged**: 324 uncovered dev tokens considered, the same 314
  kept (the 10 new candidates all failed the syllable-length guard).
- **Result**: kfold 201→**204/835** exact, 270→**276** top-5, 0.732→0.733
  mean; shipped eval 281→282/835; lockbox gate held at **21/31/0.721**;
  famous 70/72. The vocabulary-gap ceiling did not move this round —
  Wikidata's in-domain name coverage is saturated at this scale; the next
  meaningful step is a qualitatively different source (civil-registry
  extracts, news bylines), not a re-scrape.
- **Matchable ceiling added to all eval reports**: top-5 now also counted
  over shape-matchable rows only (expected Latin word count == engine
  Khmer token count). 148/835 in-domain rows (~18%) are structurally
  unmatchable — no candidate the composer can build will ever equal them
  (corpus short-forms, reversed alignments, title fragments). Fair-recall
  view: kfold top-5 **250/687 (36.4%)** vs 33.1% raw; lockbox **27/89
  (30.3%)** vs 28.7% raw. Gate numbers (exact/mean/top-5 over all rows)
  are unchanged and remain the judge.

## 6. The 2026-11-08 hygiene round — the unmatchable-shape tail-run pass

Triage of the 148 unmatchable-shape eval rows (the round-5 class everyone
wrote off as junk) showed ~90% is one systematic phenomenon, not noise:
Khmer orthography runs a full given name into one solid token while the
standard romanization spaces it — ប៉ុលពត → "Pol Pot",
រស់ សេរីសុទ្ធា → "Ros Serey Sothea", គឹមហួន → "Kim Hourn". The engine
already carries multi-word dictionary entries (internal spaces pass
straight through the composer); the gap was purely the miner, which
aligned strictly 1:1 and could never produce them.

What shipped:

- **Tail-run alignment** (`alignRow` in `scripts/lib/corpus-tools.mjs`):
  for rows with `0 < lw − kt ≤ 2`, prefix tokens zip 1:1 and the LAST
  token absorbs the remaining words as a multi-word spelling. The
  ingestion hygiene filters (`isShapeMatchable`, `classifyMiss`) went to
  lockstep, so the 148 rows are now 99% in-scope eval rows instead of
  write-offs.
- **A separate evidence class**: tail-run spellings enter at min-1
  (a solid full-name token's row cannot repeat, so count-2 promotion
  would never fire), gated by hand-reviewed junk blocklists and two
  mechanical spelling guards — function-word prefixes ("Of Assisi",
  "The Buddha", "Of Cambodia") and dotted Latin initials ("S. Ngor",
  "L. Hammond", "J. Quach", artifacts of Latin-first rows).
- **Entity-linked production merge**: 823 → **927** bundled tokens
  (+104 added, +7 enriched; spellings equal to the canonical are
  deduped). The eval counterfactuals (`applyMergePolicy`) mirror the
  mechanics, so kfold/holdout saw the same change.

Measured (all honest reads; gate numbers unchanged in character):

| Benchmark | Before (c5d9f1a) | After |
|---|---|---|
| Lockbox gate (the judge) | 21/108 exact · 31 top-5 · 0.721 | **22/108 (20.4%) · 32 top-5 · 0.724** — gate held, first improvement |
| Lockbox matchable rows | 89/108 | **107/108** (unmatchable 15 → 1) |
| kfold CV, in-domain | 24.6% exact · 33.2% top-5 | 24.8% · **34.0%** |
| kfold CV, citizens | 22.3% · 33.5% · matchable 407 | 21.7% · 33.9% · matchable **483** |
| kfold CV, regnal names | 7.4% exact · 9.7% top-5 | **9.2% · 11.5%** |
| Shipped eval, in-domain | 34.0% exact · 43.8% top-5 | **44.6% · 53.5%** |
| Match-mode (KYC) in-domain | 45.4% matched@10 | **55.1%** (citizens 48.3 → **54.0%**) |
| Unmatchable-shape misses (in-domain) | 120 | **9** |
| Famous names | 70/72 | 70/72 (held) |

Cost: CV exact in the citizens bucket moved 109 → 106 (a few candidates
re-ranked when the richer variant surface entered folds) — top-5 and
mean rose with the honest reads, and the lockbox — the judge — improved
on every axis. Matchable-ceiling footnotes updated accordingly: the
"fair recall" view is now nearly the raw view (34.4% CV / 29.9% lockbox
over matchable vs 34.0% / 29.6% raw).

## 7. Conclusion — what is left

Phases 5 and 6 probed the remaining algorithmic ideas and the evidence
rejected both: the rules already sit near the
quality ceiling of the available supervision. The dominant fixable
class is vocabulary — and the 2026-11-01 refresh (section 5) showed the
Wikidata/Wikipedia seam is now saturated: a full re-scrape moved the
honest kfold number by +3/835 and the dictionary by one variant. The
loop (`scrape:names` → `split:corpus` → `eval:scraped` → `mine:tokens`
→ `merge:tokens`) stays in place as
maintenance, but closing the remaining token gap needs a qualitatively
different source — civil-registry extracts (do not scrape the NEC
voterlist live site; sampled rosters are scanned Khmer-only images with
no Latin), news bylines, or partner rosters — not more of the same
queries. The lockbox gate (≥21/108 exact, mean not worse) passes as
shipped, and the 2026-11-08 hygiene round (section 6) is the first
improvement round to move it (+1 exact, +1 top-5, mean 0.721 → 0.724).
