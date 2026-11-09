#!/usr/bin/env node
/**
 * Probe: extra spellings for rarely seen dictionary words — evaluated
 * 2026-11-09, NOT shipped (round 2, workstream B).
 *
 * Question: 36 missed words are in the dictionary, one or two letters
 * from a second official spelling (នុត Nuth / Nouth, សួន Suon / Soun).
 * Can learned rewrites offer that second spelling?
 *
 * Findings (k-fold, 692 dev rows, baseline 204 exact / 300 top-5):
 *   - The shipped learned table cannot do it: it learned to fix RULES
 *     readings, and on official spellings it yields junk (Nuth -> Nuthh,
 *     Nudh; Khieu -> Kheau). Measured: top-5 +1/-0 on folds 0-2.
 *   - A second table learned between official spellings of the same
 *     Khmer word (train rows only, pairs <= 2 edits apart, 78 rules)
 *     applied to dictionary words (any count, 1 extra spelling) and to
 *     rules readings: folds 0-2 +3/-0, folds 3-4 +1/-1, overall top-5
 *     +4/-1 (p = 0.38), exact +0/-0. Below the round's bar.
 *   - Why: few Khmer words carry two official spellings in the train
 *     rows, many such pairs are misalignments (Hun / Sen), and the
 *     common alternations (i/y, n/nn, t/th, ou/u) are already
 *     hand-coded in src/alternatives.ts.
 *
 * Reproduce:
 *   git apply scripts/probe-dictionary-variants.patch && npm run build
 *   node scripts/eval-kfold.mjs --rv 1 --dl 1 --dl-max 99 --rows a.json
 *   node scripts/diff-kfold-rows.mjs base.json a.json --folds 3,4
 *   git apply -R scripts/probe-dictionary-variants.patch && npm run build
 */
console.log('Documentation-only probe: see the header of scripts/probe-dictionary-variants.mjs.')
