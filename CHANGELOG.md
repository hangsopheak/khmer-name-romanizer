# Changelog

All notable changes to this project are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the
project versions semver-style. Accuracy numbers cited below are
reproducible via `npm run eval:famous · eval:scraped · eval:kfold ·
eval:holdout` — see `docs/accuracy-report-2026-11.md`.

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
