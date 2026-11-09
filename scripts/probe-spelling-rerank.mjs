#!/usr/bin/env node
/**
 * Probe: rerank the extra spellings of unknown words — evaluated
 * 2026-11-09, NOT shipped (round 2, workstream A).
 *
 * Question: the learned tier already generates the official spelling for
 * some missed names but ranks it too low (raising the learned cap 2 -> 8
 * grows "option generated, not chosen" 15 -> 34 rows). Can a reranker
 * lift those spellings into the top-5?
 *
 * Method (the engine change is in probe-spelling-rerank.patch):
 *   - generate up to 8 learned rewrites per rules-only word (pool)
 *   - rerank the plain reading + rewrites by
 *       learned mass x exp(w * (logP_lm(option) - logP_lm(first guess)))
 *                    x boost (if the option is a known dictionary spelling)
 *     where logP_lm is an order-4 Witten-Bell letter model built at
 *     runtime from the dictionary's own Latin spellings (leak-free per
 *     fold: it sees only the fold's counterfactual dictionary)
 *   - the first guess keeps the top mass, so `value` never changes
 *   - knobs swept on folds 0-2 only, confirmed on folds 3-4
 *
 * Findings (k-fold, 692 dev rows, baseline 204 exact / 300 top-5):
 *   | config                    | folds 0-2 top-5 | folds 3-4 top-5 |
 *   | pool 8 only               | +3/-3           | +5/-1           |
 *   | lm w=0.6, pool 8          | +10/-8          | +7/-2           |
 *   | lm w=0.3 + known x2, p 8  | +10/-7          | +7/-2           |
 *   | known x4, pool 8          | +6/-3           | +4/-1           |
 *   | length-normalized lm      | always <= +0    | —               |
 *   Best overall: top-5 +17/-9 (net +8, sign test p ~ 0.2), exact
 *   +0/-0. Below the round's bar (net >= +15, p < 0.05).
 *   - Why so small: only 24 missed rows have the official spelling among
 *     the generated options at all, mostly at option rank 4-9, and the
 *     options are genuinely ambiguous (Di / Ty / Dy, Sophan / Sophann).
 *     Every spelling promoted into the 5 name slots pushes another
 *     row's spelling out. The letter model moved the gold option up for
 *     29 words and down for 23.
 *   - Conclusion: ranking is not the bottleneck; generation is. Re-test
 *     only if a new tier makes many more official spellings reachable.
 *
 * Reproduce:
 *   git apply scripts/probe-spelling-rerank.patch && npm run build
 *   node scripts/eval-kfold.mjs --rows base.json                # before the patch
 *   node scripts/eval-kfold.mjs --lm-weight 0.6 --pool 8 --rows a.json
 *   node scripts/diff-kfold-rows.mjs base.json a.json --folds 0,1,2
 *   git apply -R scripts/probe-spelling-rerank.patch && npm run build
 */
console.log('Documentation-only probe: see the header of scripts/probe-spelling-rerank.mjs.')
