# Accuracy Report — November 2026

State of accuracy after the algorithm improvement arc (Phases 3–6) and the
2026-11-01 refresh round, measured against the committed eval reports at
commit `c65ea84` (arc) and this round's regenerated reports.
All numbers are reproducible: `npm run eval:famous` · `eval:scraped` ·
`eval:kfold` · `eval:holdout`.

## 1. What changed this session

| Improvement | Effect on lockbox (108 held-out names) | Effect elsewhere |
|---|---|---|
| Phase 3: probability scoring + `scoredCandidates` | 0 — held 21 exact, mean 0.717 **by design**: probability-promoting dictionary variants cost 18 famous exacts in calibration (70→52), so reviewed canonicals stay pinned | Exposed Σ log P scores for matching workflows |
| Phase 4 (T4.1): FST tier vendored | — | Bridge + `npm run fst:readings` reproducible from this repo |
| Phase 4 (T4.2): FST distillation, 314 tokens | **mean 0.717 → 0.721, top-5 30 → 31**, exact held 21 | kfold CV +2 exact; shipped eval **+22 exact** (259→281) |
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
`fst-distill` → eval ladder → gate read.

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

## 6. Conclusion — what is left

Phases 5 and 6 probed the remaining algorithmic ideas and the evidence
rejected both: the rules and the distilled FST already sit near the
quality ceiling of the available supervision. The dominant fixable
class is vocabulary — and the 2026-11-01 refresh (section 5) showed the
Wikidata/Wikipedia seam is now saturated: a full re-scrape moved the
honest kfold number by +3/835 and the dictionary by one variant. The
loop (`scrape:names` → `split:corpus` → `eval:scraped` → `mine:tokens`
→ `merge:tokens` → `node scripts/fst-distill.mjs`) stays in place as
maintenance, but closing the remaining ~560-token gap needs a
qualitatively different source — civil-registry extracts, news bylines,
or partner rosters — not more of the same queries. The lockbox gate
(≥21/108 exact, mean not worse) passes as shipped.
