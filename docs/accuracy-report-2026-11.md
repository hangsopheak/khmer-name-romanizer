# Accuracy Report — November 2026

State of accuracy after the algorithm improvement arc (Phases 3–6),
measured against the committed eval reports at commit `c65ea84`.
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

## 2. Current accuracy

| Benchmark | Exact (top-1) | In top-5 | Mean similarity |
|---|---|---|---|
| Famous Cambodians (72, in-sample) | **70 (97.2%)** | 70 (97.2%) | 0.989 |
| Curated name lists (129) | **104 (80.6%)** | 116 (90.0%) | 0.944 |
| Citizens, shipped dict (488)* | 159 (32.6%) | 224 (45.9%) | 0.795 |
| **Citizens, 5-fold CV (honest unseen)** | **105 (21.5%)** | **158 (32.4%)** | **0.771** |
| All in-domain, 5-fold CV (834) | 201 (24.1%) | 270 (32.4%) | 0.732 |
| **Lockbox counterfactual (the judge)** | **21 (19.4%)** | **31 (28.7%)** | **0.721** |
| Foreign names in Khmer (out of scope) | 32/1544 (2.1%) | 49 (3.2%) | 0.634 |

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

## 5. Conclusion — the one remaining evidence-backed lever

Phases 5 and 6 probed the remaining algorithmic ideas and the evidence
rejected both: the rules and the distilled FST already sit near the
quality ceiling of the available supervision. The dominant fixable
class is vocabulary. A **corpus refresh** — `scrape:names` →
`split:corpus` → `eval:scraped` → `mine:tokens` → `merge:tokens` →
`node scripts/fst-distill.mjs` — converts new Wikidata/Wikipedia data
into dictionary entries and distill coverage, attacking the 560-token
gap directly. It is maintenance, not a fire: the lockbox gate
(≥21/108 exact, mean not worse) passes as shipped.
