#!/usr/bin/env node
/**
 * K-fold cross-validated accuracy on the DEV split (scripts/dev-split.json).
 *
 * This is the number development decisions are made on. The lockbox
 * (scripts/test-split.json) is never read here, so it stays a clean
 * once-per-release judge.
 *
 * The shipped eval (`eval:scraped`) scores the bundled dictionary on the
 * whole corpus at once — but that dictionary already contains tokens mined
 * from this corpus (>= 2 attestations merged), so those numbers are partly
 * in-sample. This script measures leakage-free generalization:
 *
 *   folds are assigned by PERSON GROUP (groupRows): every spelling of one
 *   name/person lands in the same fold — a near-duplicate in the train
 *   folds can never answer for a test row.
 *
 *   for each fold i:
 *     1. mine tokens from the OTHER folds only — same strict 1:1
 *        alignment and attestation counting as mine-tokens.mjs
 *     2. build the counterfactual dictionary the package would ship if
 *        fold i had never been scraped (counterfactualDict: bundled keys
 *        the train folds alone would not have admitted are stripped, then
 *        train-fold merges are applied under the merge-tokens.mjs policy)
 *     3. evaluate fold i's eval rows (in-domain, hygiene-clean, not
 *        hand-authored) with that dictionary — suggest mode (exact /
 *        top-5) and match mode (flipOrderCandidates, order-insensitive,
 *        top-10: the honest version of eval:match)
 *
 * Known limits, kept honest:
 *   - variant-level leakage (a test-fold spelling previously folded into
 *     an entry's variants) is not attributable and remains — top-5 is
 *     slightly optimistic
 *   - a removed key might independently be gold/roster-sourced — exact
 *     is then slightly pessimistic
 *
 * Usage: node scripts/eval-kfold.mjs [--k 5] [--min 2] [--rows <file>]
 *
 *   --no-learned   turn the learned alternation tier off (0.4.0 behavior)
 *   --max-learned N  learned rewrites per rules-only token (default: engine's)
 *   --rows <file>  also write per-row results (fold, khmer, gold, value,
 *                  candidates, per-token options, hit / top-5 / match
 *                  flags) as JSON, so two
 *                  runs can be compared row by row (scripts/diff-kfold-rows.mjs)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createDefaultTransliterator, createTransliterator, defaultTokenDict } from '../dist/index.js'
import {
    classifyMiss,
    counterfactualDict,
    fnv1a,
    groupRows,
    isEvalRow,
    isInDomain,
    isShapeMatchable,
    isTrainable,
    norm,
    similarity,
    sortedNorm,
    strictEqual,
    wilson,
} from './lib/corpus-tools.mjs'
import { learnRules, trainingPairs } from './lib/learn-alternations.mjs'

const args = process.argv.slice(2)
const value = (name, fallback) => {
    const i = args.indexOf(name)
    return i !== -1 ? Number(args[i + 1]) : fallback
}
const K = value('--k', 5)
const MIN = value('--min', 2)
const LEARNED = !args.includes('--no-learned')
const MAX_LEARNED = args.includes('--max-learned') ? value('--max-learned', undefined) : undefined
const rowsIdx = args.indexOf('--rows')
const ROWS_FILE = rowsIdx !== -1 ? args[rowsIdx + 1] : undefined
if (rowsIdx !== -1 && !ROWS_FILE) {
    console.error('--rows needs a file path')
    process.exit(1)
}

if (!Number.isInteger(K) || K < 2) {
    console.error('--k must be an integer >= 2')
    process.exit(1)
}

/* ------------------------------------------------------------------ */
/* dev split, eval rows, folds (deterministic, by person group)         */
/* ------------------------------------------------------------------ */
let pairs
try {
    pairs = JSON.parse(readFileSync(new URL('./dev-split.json', import.meta.url), 'utf8'))
} catch {
    console.error('scripts/dev-split.json not found — run `npm run split:corpus` first.')
    process.exit(1)
}
const trainable = pairs.filter(isTrainable)
const inDomain = pairs.filter(isInDomain)
const evalRows = pairs.filter(isEvalRow)

// fold = hash(person group) % K: reproducible, no RNG, and every spelling
// of one person shares a fold (round-robin over sorted rows did the
// opposite — near-duplicates sort adjacent and were split on purpose)
const groupOf = groupRows(trainable)
const foldOf = new Map(trainable.map((p) => [p, fnv1a(groupOf.get(p)) % K]))

/* ------------------------------------------------------------------ */
/* evaluation                                                          */
/* ------------------------------------------------------------------ */
const evaluate = (rows, t) =>
    rows.map((p) => {
        const r = t.transliterate(p.khmer)
        const hit = r.value.toLowerCase() === p.latin.toLowerCase()
        const inTop5 = r.candidates.some((c) => norm(c) === norm(p.latin))
        return {
            bucket: p.bucket,
            hit,
            orderOnly: !hit && sortedNorm(r.value) === sortedNorm(p.latin),
            inTop5,
            strictTop5: r.candidates.some((c) => strictEqual(c, p.latin)),
            sim: similarity(r.value, p.latin),
            matchable: isShapeMatchable(p),
            missClass: !hit && !inTop5
                ? classifyMiss({ got: r.value, tokens: r.tokens, pair: p })
                : undefined,
        }
    })

const report = (rows) => {
    if (!rows.length) return { n: 0 }
    const exact = rows.filter((r) => r.hit).length
    const matchable = rows.filter((r) => r.matchable)
    const top5Matchable = matchable.filter((r) => r.inTop5).length
    const misses = rows.filter((r) => r.missClass)
    const taxonomy = {}
    for (const r of misses) taxonomy[r.missClass] = (taxonomy[r.missClass] ?? 0) + 1
    return {
        n: rows.length,
        exact,
        exactPct: +(100 * (exact / rows.length)).toFixed(1),
        exactCI: wilson(exact, rows.length),
        anyOrder: rows.filter((r) => r.hit || r.orderOnly).length,
        top5: rows.filter((r) => r.inTop5).length,
        top5Pct: +(100 * (rows.filter((r) => r.inTop5).length / rows.length)).toFixed(1),
        top5CI: wilson(rows.filter((r) => r.inTop5).length, rows.length),
        strictTop5: rows.filter((r) => r.strictTop5).length,
        meanSim: +(rows.reduce((a, r) => a + r.sim, 0) / rows.length).toFixed(3),
        matchableN: matchable.length,
        top5Matchable,
        top5MatchablePct: matchable.length ? +((100 * top5Matchable) / matchable.length).toFixed(1) : 0,
        missTaxonomy: taxonomy,
        ...(rows.some((r) => r.matched !== undefined)
            ? { matched: rows.filter((r) => r.matched).length, matchedPct: +((100 * rows.filter((r) => r.matched).length) / rows.length).toFixed(1), matchedCI: wilson(rows.filter((r) => r.matched).length, rows.length) }
            : {}),
    }
}

/* ------------------------------------------------------------------ */
/* k-fold loop                                                         */
/* ------------------------------------------------------------------ */
const MATCH_MAX = 10
const foldResults = []
const foldMeta = []
const rowDump = []

for (let f = 0; f < K; f++) {
    const testRows = evalRows.filter((p) => foldOf.get(p) === f)
    const trainRows = trainable.filter((p) => foldOf.get(p) !== f)
    const heldOut = inDomain.filter((p) => foldOf.get(p) === f)

    const { dict, removed, added, enriched } = counterfactualDict({
        bundled: defaultTokenDict,
        trainRows,
        testRows: heldOut,
        min: MIN,
    })
    // learned alternations: TRAIN folds only (the shipped table learns
    // from the whole dev split, so a test fold would leak through it)
    const learned = LEARNED
        ? { learnedAlternations: learnRules(trainingPairs(trainRows)), maxLearnedAlternates: MAX_LEARNED }
        : {}
    const t = createTransliterator({ tokenDict: dict, ...learned })
    const results = evaluate(testRows, t)
    // match mode (KYC/dedup): same counterfactual, order-swapped candidates
    const tm = createTransliterator({ tokenDict: dict, flipOrderCandidates: true, ...learned })
    for (const [i, p] of testRows.entries()) {
        const c = tm.transliterate(p.khmer).candidates.slice(0, MATCH_MAX)
        results[i].matched = c.some((x) => norm(x) === norm(p.latin) || sortedNorm(x) === sortedNorm(p.latin))
    }
    if (ROWS_FILE)
        for (const [i, p] of testRows.entries()) {
            const r = t.transliterate(p.khmer)
            rowDump.push({
                fold: f,
                khmer: p.khmer,
                gold: p.latin,
                bucket: p.bucket,
                value: r.value,
                candidates: r.candidates,
                sources: r.tokens.map((x) => x.source),
                options: r.tokens.map((x) => [x.latin, ...x.alternatives]),
                hit: results[i].hit,
                inTop5: results[i].inTop5,
                matched: results[i].matched,
            })
        }
    foldResults.push(...results)
    foldMeta.push({ fold: f, learnedRules: learned.learnedAlternations?.length ?? 0, testRows: testRows.length, dictSize: Object.keys(dict).length, removed, addedByTrain: added, enrichedByTrain: enriched, perFold: report(results) })
}

/* ------------------------------------------------------------------ */
/* side-by-side with the shipped dictionary (partly in-sample)         */
/* ------------------------------------------------------------------ */
const shippedResults = evaluate(evalRows, createDefaultTransliterator())

const bucketize = (rows) => ({
    cambodian: report(rows.filter((r) => r.bucket === 'cambodian')),
    unknown: report(rows.filter((r) => r.bucket === 'unknown')),
    curated: report(rows.filter((r) => r.bucket === 'curated')),
    inDomain: report(rows),
})

const fmt = (label, r) =>
    r.n
        ? `${label.padEnd(34)} n=${String(r.n).padStart(4)}  exact ${String(r.exact).padStart(4)} (${r.exactPct}%)  top-5 ${String(r.top5).padStart(4)} (${r.top5Pct}%)  mean ${r.meanSim}`
        : `${label.padEnd(34)} n=0`

console.log(`K-fold cross-validation (k=${K}, min ${MIN} attestations) on the DEV split, folds by person group`)
console.log(`eval rows: ${evalRows.length} (of ${inDomain.length} in-domain; hygiene-filtered, hand-authored excluded)\n`)

for (const m of foldMeta)
    console.log(`  fold ${m.fold}: test ${m.testRows}  dict ${m.dictSize} (-${m.removed} not admissible, +${m.addedByTrain} train-mined, ~${m.enrichedByTrain} enriched)  learned rules ${m.learnedRules}`)

const kfold = bucketize(foldResults)
const shipped = bucketize(shippedResults)
const perFold = foldMeta.map((m) => m.perFold).filter(Boolean)

console.log('\nSHIPPED dictionary (partly in-sample — what eval:scraped reports):')
console.log(fmt('  in-domain', shipped.inDomain))
console.log(fmt('  cambodian citizens', shipped.cambodian))
console.log(fmt('  unknown (ancient kings etc.)', shipped.unknown))

console.log(`\nK-FOLD (counterfactual dictionary per fold):`)
console.log(fmt('  in-domain', kfold.inDomain))
console.log(fmt('  cambodian citizens', kfold.cambodian))
console.log(fmt('  unknown (ancient kings etc.)', kfold.unknown))

const foldRates = perFold.filter((r) => r.n).map((r) => r.exactPct)
if (foldRates.length)
    console.log(`  per-fold in-domain exact: ${foldRates.map((r) => r + '%').join('  ')}  (spread ${Math.min(...foldRates)}–${Math.max(...foldRates)}%)`)
console.log(
    `  in-domain top-5 over shape-matchable rows only: ${kfold.inDomain.top5Matchable}/${kfold.inDomain.matchableN} (${kfold.inDomain.top5MatchablePct}%) — ${kfold.inDomain.n - kfold.inDomain.matchableN} of ${kfold.inDomain.n} rows are structurally unmatchable`,
)
console.log(
    `  in-domain exact 95% CI: ${kfold.inDomain.exactCI.low}–${kfold.inDomain.exactCI.high}% · top-5 CI: ${kfold.inDomain.top5CI.low}–${kfold.inDomain.top5CI.high}% · strict (word-aligned) top-5: ${kfold.inDomain.strictTop5}/${kfold.inDomain.n}`,
)
console.log(
    `  match mode (order-insensitive, top-${MATCH_MAX}): in-domain ${kfold.inDomain.matched}/${kfold.inDomain.n} (${kfold.inDomain.matchedPct}%, CI ${kfold.inDomain.matchedCI.low}–${kfold.inDomain.matchedCI.high}%) · citizens ${kfold.cambodian.matchedPct}%`,
)
console.log(
    `  in-domain miss autopsy: ${Object.entries(kfold.inDomain.missTaxonomy).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`,
)

writeFileSync(
    new URL('./eval-kfold-report.json', import.meta.url),
    JSON.stringify(
        {
            generated: new Date().toISOString(),
            k: K,
            min: MIN,
            evalRows: evalRows.length,
            folds: foldMeta,
            perFold,
            shipped,
            kfold,
        },
        null,
        1,
    ),
)
console.log('\nfull report -> scripts/eval-kfold-report.json')
if (ROWS_FILE) {
    writeFileSync(ROWS_FILE, JSON.stringify(rowDump, null, 1))
    console.log(`per-row results -> ${ROWS_FILE}`)
}
