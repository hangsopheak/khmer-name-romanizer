#!/usr/bin/env node
/**
 * Probe: space the parts of a compound given name — evaluated
 * 2026-11-09, NOT shipped (round 2, workstream C).
 *
 * Question: 78 missed rows have fewer words than the official spelling
 * (ចិន្តាសោភា -> "Chendasophea", gold "Chenda Sophea"). Should the engine
 * space the parts of a word the dictionary splitter split?
 *
 * Findings (k-fold, 692 dev rows, baseline 204 exact / 300 top-5):
 *   - Top-5 cannot gain: the eval's top-5 compares letters only (`norm`),
 *     so a spelling right but for spacing is already a top-5 hit. None of
 *     the 78 rows has the right letters anywhere in its options. Adding a
 *     spaced form as an extra candidate can only crowd others out.
 *   - Exact: 15 rows have the right letters and miss only a space. But
 *     spacing `value` breaks as many joined official spellings:
 *     | variant                          | folds 0-2 exact | folds 3-4 exact |
 *     | space every split compound       | +4/-8           | +5/-6           |
 *     | only when every part is in dict  | +3/-5           | +1/-3           |
 *     | only when the first part is dict | +3/-7           | +3/-3           |
 *     Joined: Namhong, Chanthol, Sokpheng, Soksophea, Sovannareach.
 *     Spaced: Pich Pisey, Chenda Sophea, Vong Vathana, Sam Ol. Nothing
 *     visible in the Khmer separates the two; spacing is a family choice.
 *   - Conclusion: keep compounds joined (the more common official form).
 *
 * Reproduce:
 *   git apply scripts/probe-compound-spacing.patch && npm run build
 *   node scripts/eval-kfold.mjs --space all --rows a.json   (all | full | dictfirst)
 *   node scripts/diff-kfold-rows.mjs base.json a.json --folds 0,1,2 --list
 *   git apply -R scripts/probe-compound-spacing.patch && npm run build
 */
console.log('Documentation-only probe: see the header of scripts/probe-compound-spacing.mjs.')
