# Changelog

All notable changes to this project are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the
project versions semver-style. Accuracy numbers cited below are
reproducible via `npm run eval:famous · eval:scraped · eval:kfold ·
eval:holdout` — see `docs/accuracy-report-2026-11.md`.

## [0.4.0] - 2026-11-09

### Added — blind native vocabulary (round 5)
- **10 words spelled blind by the repo owner** (គីម Kim, ស៊ឹម Sim,
  ឡាវ Lao, កង Korng, ចន្ទ Chan, ឈីវ Chhiv, ថង Thorng, ប៉េង Peng,
  ម៉ុង Mong, ប៊ុនឈឿន Bunchhoeun), stored in
  `scripts/sources/native-vocab.json`. Words were chosen from the
  parliament rosters, not from eval rows or misses, and shown Khmer-only
  (no engine guess, no corpus answer), so the evals treat them as
  independent evidence: never scored, never stripped by the
  counterfactual. Dictionary 1461 → 1471.
- **Measured effect: none on k-fold** (paired +0/−0); the value is
  coverage for real names containing these words.

### Added — gap-filling singleton words (+195 dictionary entries)
- **Words seen once now enter the dictionary when they fill a gap.**
  Before, a word attested once fell to the rule fallback, whose first
  guess is right ~31% of the time. A new merge class admits a NEW word
  attested once when the rule engine's own reading is >= 0.55 similar
  to the corpus spelling (the repo's existing round-trip bar). That
  gate rejects one-shot mis-alignments like ខាន់ → "Jessa".
- **Gap-only by design.** A singleton never overrides a distilled FST
  reading (k-fold cannot exercise that case, so it is not shipped),
  never comes from the machine-translated `sigpwned` surname
  list (it produced ចន្ទ → "Chhan"), and never touches existing
  canonicals or variants (those keep the min-2 rule).
- **Dictionary 1266 → 1461** (166 singletons + 29 regular min-2 words
  newly in the person-grouped dev split).
- **Measured on person-grouped k-fold (paired vs. the eval-v2
  baseline):** +9/−1 exact, +12/−1 top-5. K-fold 24.4% → **25.6%**
  exact (177/692, CI 22.5–29.0), 32.4% → **34.1%** top-5, match mode
  33.2% → **35.1%**. Release lockbox read: **24.8%** exact (32/129,
  CI 18.2–32.9), 31.0% top-5 (v2 baseline 31 and 39). Famous 70/72
  held; tests 26/26.

### Fixed — evaluation methodology (lockbox v2)
A pre-release audit found the "leakage-free" evals were not. Fixes:
- **Person-grouped splits.** The lockbox hashed each `khmer\tlatin`
  row, so two spellings of one person could land on both sides
  (`អ្នកអង្គម្ចាស់ នរោត្តម កន្តុល` / `នរោត្តម កន្តុល`, `ជូ ស៊ីនទី` /
  `ជូ ស៊ិនទី`, `ព្រំ ញ៉ែម` / `ញ៉ែម`). Rows are now grouped by
  normalized Khmer name, Wikidata QID and multi-word Latin name
  (`groupRows`), and the lockbox holds whole groups. K-fold used
  round-robin over sorted rows, which put adjacent near-duplicates in
  different folds on purpose; it now folds by person group too.
- **Hand-authored rows are training-only.** Native-review pairs
  (`static/manual`) were scored against the dictionary pins written by
  the same reviewer; four sat in the lockbox, so the "correctly held
  out" claim in the round-1 entry below was wrong. They and their
  groups now stay in dev and are never scored.
- **Stricter counterfactual.** A bundled key the test rows attest now
  survives only if the train rows alone would have admitted it: not
  when its only train evidence is a hand-authored pair (វេជ្ជរ៉ា →
  Vichara had no evidence but the lockbox row "Norodom Vichara"), and
  not when the test rows were what lifted it past min-2. The
  counterfactual also re-mines the `distilled` bucket, as production does.
- **K-fold runs on the dev split only.** It used to fold the full
  corpus, lockbox included, so development decisions read lockbox rows.
- **`eval:holdout` no longer prints lockbox misses** (an answer key
  for the next correction round); `--show-misses` for post-release
  autopsies only. Read the lockbox once per release.
- **K-fold reports an unseen-name match-mode rate**; `eval:match` is
  labelled in-sample.
- **Honest numbers (new baseline, not comparable with v1):** k-fold
  **24.4%** exact (169/692, CI 21.4–27.8), 32.4% top-5, 33.2%
  match@10; lockbox v2 **24.0%** (31/129, CI 17.5–32.1), 30.2% top-5.
  Under the old method the same code scored 29.6% (k-fold) and 25.7%
  (lockbox v1, 28/109). Of the v1 lockbox's +7 exact since 0.3.0's
  baseline, about 2 were real gains; the rest were the leaks above
  plus three deleted miss rows.
- **README:** the unseen-name rate now leads; the 97% / 83% / 50%
  tiers are labelled in-sample; the false "no test name is ever in the
  dictionary it's scored against" line is gone; stale counts refreshed
  and links to unpublished docs removed.

### Added — native-reader correction round 4 (2026-11-09, late)
- **10 adjudications** from the repo owner: three canonical flips
  (សម្បត្តិ → **Sambath**, កក្កដា → **Kakada**, រតនា → **Rattana** —
  old canonicals demoted to variants, Rotana kept as a variant per the
  round-2 pair), one confirmation (សៀង stays **Seang**, Sieng variant),
  and six new entries (កឹម → Kem, កើត → Koeut, កេង → Keng, កុយ → Koy,
  កឹស → Koeus, កាំង → Kang — all admitted by the standard merge).
  `manual-verified.json` now 43 pairs; corpus 2902 → 2908; dictionary
  1260 → 1265.
- **Evals**: cambodian bucket 44.5% → **45.3%** exact (218→222/490),
  match-mode 58.3% → **58.7%** matched@10 (in-domain); lockbox
  counterfactual held **25.0%** (28/112, strict top-5 35 — the flips are
  hand-pins the counterfactual rebuild cannot see); shipped lockbox
  34/112 exact; famous held **70/72**; tests 26/26.

### Added — native-reader correction round 3 (2026-11-09, evening)
- **10 highest-leverage adjudications** from the repo owner: canonical
  flip តាំង → **Taing** (Tang demoted to variant — README example and
  tests updated), four canonical confirmations (ឃឹម Khom, ណៃ Nai,
  ប្រសិទ្ធ Broseth, ជឿន Choeurn — corpus spellings stay variants), and
  five new entries (លក្ខិណា → Leakhena, un-blocking the reviewed-junk
  "In" mis-alignment by hand-setting the correct spelling; ឃួន → Khuon,
  ស៊ូ → Sou, ប៊ុនធឿន → Bunthoeun, សារ៉ាន់ → Saran, all with
  corpus-attested variants). `manual-verified.json` now 33 pairs;
  corpus 2896 → 2902; dictionary 1255 → 1260.
- **Evals**: lockbox counterfactual 22.7% → **25.0%** exact (28/112,
  strict top-5 35), cambodian 44.1% → **44.5%** exact, match-mode
  57.6% → **58.3%** matched@10; famous held **70/72**; tests 26/26.

### Added — native-reader correction round (2026-11-09)
- **12 hand-verified spellings** from the repo owner via
  `scripts/sources/manual-verified.json` (23 pairs now): royal given
  names previously missing from the dictionary (មុនីនាថ Monineath,
  កុសមៈ Kossamak, វេជ្ជរ៉ា Vichara, យុវនាថ Yuvaneath, រតនាទេវី
  Rattana Devi, នរិន្ទ្រពង្ស Narindrapong) plus everyday-name canonical
  flips and variants (រំចង់ → Rumchong, សំណាង → Samnang, ឃឹន → Khin,
  ធាមតេង → Theam Teng, យូរ៉ាន់ → Youran, ម៉ាក → Mark, ថងយុត →
  Thorngyut; variants Rotana, Sovan). Canonical pins applied directly to
  the generated dictionary where the merge policy cannot flip
  (canonicals are never auto-demoted); ប៉ែន Penn and សាន Sann stay
  pinned to protect famous eval exacts.
- **Corpus 2883 → 2896, dictionary 1250 → 1255.** Three manual rows
  (សារ៉ាត់, ចក្រពង្ស, ម៉ារី…) hashed into the frozen lockbox and are
  correctly held out.
- **Evals**: cambodian bucket 41.6% → **44.1%** exact (204→216/490);
  lockbox counterfactual 22.0% → **22.7%** exact, strict top-5 30→32;
  famous held **70/72**; tests 26/26.

### Added — ai-common name list + full distill-source corpus absorption
- **New source `scripts/sources/ai-common-names.json`** (121 common
  Cambodian given names, AI-generated, repo-owner-approved in bulk):
  entries-format with gender + meaning (meanings stay in the source
  file), `status: corrected` — the trusted tier. Two weak spellings
  (`លក្ខណា → Leakhana` sim 0.375, `វលក្ខណ៍ → Voleak` 0.429) were
  **dropped on trust review** (below the 0.55 round-trip gate, removed
  from source, trusted tier, corpus and dictionary); the remaining 119
  pairs materialized (0 flagged) and compiled into the trusted tier
  (distill-verified 431 → 512).
- **Corpus 2434 → 2883 rows** — the ai-common dataset plus the first
  full absorption of the distill sources via `scrape:names`
  (`static/distill-verified` 401 rows, `static/adoption` 8,
  `static/btn` 34, wikidata re-bumps). One-row-per-key absorb kept
  pre-owned spellings where adoption/BTN disagreed with the list
  (Boupha, Kanya, Narith, Atith, …).
- **Dictionary 927 → 1244** (+317: trusted single attestations from the
  distilled lists and corpus growth; +variant enrichments `ទិត` +Tit,
  `វីរៈ` +Vireak). Count-1 canonical conflicts held per policy (Yorn
  vs Yoeurn, Ratanak vs Rathanak, …); blocklists held (`លក្ខិណា →
  "In"`, mis-aligned `ដាវី → "Chou"` rejected).
- **Evals**: `distilled` bucket n=443, 75.6% exact / 80.8% top-5;
  cambodian 41.6% exact; lockbox counterfactual 23/108 exact, 33 top-5;
  famous 70/72 held; tests 26/26; split invariants clean.

### Added — corpus hygiene round: tail-run dictionary expansion
- **The unmatchable-shape class turned out to be the fix**: triage of
  the 148 "structurally unmatchable" eval rows showed ~90% are run-on
  Khmer tokens (one solid token, multi-word romanization — ប៉ុលពត →
  "Pol Pot", រស់ សេរីសុទ្ធា → "Ros Serey Sothea"). New tail-run
  alignment mines them as multi-word dictionary variants (the engine
  already carried internal spaces); `alignRow` / `classifyMiss` /
  `isShapeMatchable` moved to lockstep.
- **Tail-run evidence class**: solid full-name tokens cannot repeat in
  the corpus, so their spellings are admitted at min-1 (vs min-2 for
  straight mined spellings), gated by hand-reviewed junk blocklists
  (`ញ៉ែម|Prom Nhem`, `ង៉ោ|S. Ngor`, `អេលែន|Dodgson Tan`, …) and
  mechanical spelling guards (function-word prefixes, dotted Latin
  initials). Entity-linked merge: 823 → **927** bundled tokens
  (+104 entries, +7 enrichments).
- **First lockbox-gate improvement**: 21→**22/108** exact,
  31→**32** top-5, mean 0.721→**0.724**; matchable rows 89→**107**
  (unmatchable 15→1). Match-mode 45.4→**55.1%** matched@10 in-domain
  (citizens 48.3→**54.0%**); shipped eval 34.0→**44.6%** exact;
  kfold regnal-names exact 7.4→**9.2%**. Famous 70/72 held.

### Added — benchmark v2 (reporting layer only; engine, dictionary and distill set untouched)
- **Citizens-only headline**: reports and README lead with the product-relevant
  population; the 217 out-of-scope regnal rows are reported but never
  averaged into the headline.
- **Wilson 95% CIs** on exact/top-5 in every report — the 108-row lockbox
  reads as a range (e.g. 19.4% ± ~8pp), not an over-precise point.
- **Match-mode eval** (`npm run eval:match`): the KYC question — order-
  insensitive candidate recognition with `flipOrderCandidates`. First
  reading: 45.4% in-domain matched@10, everything findable found by
  rank 5 (ranks 6–10 empty everywhere).
- **Automated miss autopsy** in every report: each miss classified as
  vocab-gap / unmatchable-shape / order-flip / option-not-chosen.
  k-fold: vocab-gap 430, unmatchable-shape 122, order-flip 4,
  option-not-chosen 2 — the ranking's entire share is 2 rows.
- **Strict word-aligned top-5** alongside the lenient space-stripping
  one (260/835 vs 277/835 on k-fold).
- **Package budget gate** in CI (`scripts/check-budget.mjs`): packed
  size ≤80 kB, unpacked ≤320 kB, throughput ≥1k names/s (baseline
  40.5 kB / 143.9 kB / ~76k names/s).

## [0.3.0] — 2026-11-01

First public release. Engine, dictionary, and measurement round over
the 0.2.0 internal state.

### Added
- **Alternation-swap candidate injection**: official spellings one
  attested alternation away from a token's primary ("Sin" → "Sinn")
  previously sat beyond the per-token option cap and could never
  compose into a full-name candidate. Each token's top cap-discarded
  option is now injected as a single-substitution variant of the
  leader, scored with the same probability mass maps. Swaps can never
  outscore the leader, so `value` is untouched by construction.
- **Matchable-ceiling metric** in all eval reports: top-5 also counted
  over shape-matchable rows only (expected Latin word count == engine
  Khmer token count). ~18% of corpus rows are structurally unmatchable
  (short-forms, reversed alignments); the fair-recall view is kfold
  250/687 (36.4%) and lockbox 27/89 (30.3%) vs 33.1%/28.7% raw.
- **Corpus refresh loop exercised end-to-end**: 2,390 → 2,432 pairs;
  lockbox verified un-reshuffled (0 flips, 0 vanished rows); mined
  tokens passed human review (3 new junk blocks, `ជួន` +Choun kept).

### Changed
- Dictionary: 823 entries (+153 over 0.2.0's mining rounds, one
  review-approved variant this round); FST distill map unchanged (314
  tokens — all 10 new candidates failed the syllable-length guard).
- Honest unseen-name accuracy rose: 5-fold CV 201 → 204/835 exact,
  270 → 276 top-5, mean 0.732 → 0.733. Lockbox gate held exactly
  (21/108 exact, 31 top-5, 0.721 mean); famous 70/72.

## [0.2.0] — 2026-10-31

Internal release: scale-up and measurement honesty.

- Multi-source Wikimedia mining (7 SPARQL passes, Wikipedia redirects,
  2 curated static lists) → 2,390-pair corpus; dictionary regenerated
  in-repo (`scrape:names` → `mine:tokens` → `merge:tokens`).
- Frozen test split (content-hash lockbox, never mined, never tuned)
  + counterfactual holdout eval + leakage-free 5-fold CV.
- Probability scoring: `scoredCandidates` (Σ log P(spelling | token)),
  reviewed canonicals pinned via a calibrated pseudo-count.
- Optional pynini FST tier vendored (out-of-process, zero-dep core)
  and distilled into a bundled 314-token prior-grade map.
- Probes committed with findings: syllable compositor and segmentation
  upgrades evaluated on evidence and **not shipped**.

## [0.1.0] — 2026-10-31

Initial release: token dictionary + segmentation + rule engine,
ranked `candidates`, honorific stripping, CLI, zero runtime
dependencies.
