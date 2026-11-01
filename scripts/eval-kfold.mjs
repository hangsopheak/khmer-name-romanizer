#!/usr/bin/env node
/**
 * K-fold cross-validated accuracy on the scraped corpus.
 *
 * The shipped eval (`eval:scraped`) scores the bundled dictionary on the
 * whole corpus at once — but that dictionary already contains tokens mined
 * from this corpus (>= 2 attestations merged), so those numbers are partly
 * in-sample. This script measures leakage-free generalization:
 *
 *   for each fold i of the in-domain rows:
 *     1. mine tokens from the OTHER folds only — same strict 1:1
 *        alignment and attestation counting as mine-tokens.mjs
 *     2. build the counterfactual dictionary the package would ship if
 *        fold i had never been scraped:
 *          base  = bundled dictionary minus keys whose corpus
 *                  attestations ALL come from fold i (they would never
 *                  have met the merge threshold)
 *          dict  = base + train-fold merges under the merge-tokens.mjs
 *                  policy (>= min attestations, trusted static lists
 *                  excepted, canonicals never touched)
 *     3. evaluate fold i with that dictionary
 *
 * Known limits, kept honest:
 *   - canonical-level leakage is stripped exactly; variant-level leakage
 *     (a test-fold spelling previously folded into an entry's variants)
 *     is not attributable and remains — top-5 is slightly optimistic
 *   - a removed key might independently be gold/roster-sourced — exact
 *     is then slightly pessimistic
 *
 * Usage: node scripts/eval-kfold.mjs [--k 5] [--min 2]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createDefaultTransliterator, createTransliterator, defaultFstDistill, defaultTokenDict } from '../dist/index.js'
import {
    counterfactualDict,
    distillMapFor,
    isInDomain,
    norm,
    passesHygiene,
    similarity,
    sortedNorm,
    supportOf,
} from './lib/corpus-tools.mjs'

const args = process.argv.slice(2)
const value = (name, fallback) => {
    const i = args.indexOf(name)
    return i !== -1 ? Number(args[i + 1]) : fallback
}
const K = value('--k', 5)
const MIN = value('--min', 2)

if (!Number.isInteger(K) || K < 2) {
    console.error('--k must be an integer >= 2')
    process.exit(1)
}

/* ------------------------------------------------------------------ */
/* corpus, hygiene filter, folds (deterministic assignment)            */
/* ------------------------------------------------------------------ */
const pairs = JSON.parse(readFileSync(new URL('./scraped-names.json', import.meta.url), 'utf8'))
const inDomain = pairs.filter(isInDomain)
const evalRows = inDomain.filter(passesHygiene)

// stable order -> fold = index % K: balanced, reproducible, no RNG
const ordered = [...evalRows].sort((a, b) => a.khmer.localeCompare(b.khmer) || a.latin.localeCompare(b.latin))
const foldOf = new Map(ordered.map((p, i) => [p, i % K]))

/* ------------------------------------------------------------------ */
/* evaluation                                                          */
/* ------------------------------------------------------------------ */
const evaluate = (rows, t) =>
    rows.map((p) => {
        const r = t.transliterate(p.khmer)
        const hit = r.value.toLowerCase() === p.latin.toLowerCase()
        return {
            bucket: p.bucket,
            hit,
            orderOnly: !hit && sortedNorm(r.value) === sortedNorm(p.latin),
            inTop5: r.candidates.some((c) => norm(c) === norm(p.latin)),
            sim: similarity(r.value, p.latin),
        }
    })

const report = (rows) => {
    if (!rows.length) return { n: 0 }
    const exact = rows.filter((r) => r.hit).length
    return {
        n: rows.length,
        exact,
        exactPct: +(100 * (exact / rows.length)).toFixed(1),
        anyOrder: rows.filter((r) => r.hit || r.orderOnly).length,
        top5: rows.filter((r) => r.inTop5).length,
        top5Pct: +(100 * (rows.filter((r) => r.inTop5).length / rows.length)).toFixed(1),
        meanSim: +(rows.reduce((a, r) => a + r.sim, 0) / rows.length).toFixed(3),
    }
}

/* ------------------------------------------------------------------ */
/* k-fold loop                                                         */
/* ------------------------------------------------------------------ */
const fullSupport = supportOf(inDomain) // what the shipped dictionary was mined from
const foldResults = []
const foldMeta = []

for (let f = 0; f < K; f++) {
    const testRows = evalRows.filter((p) => foldOf.get(p) === f)
    const trainRows = inDomain.filter((p) => foldOf.get(p) !== f)

    const { dict, removed, added, enriched } = counterfactualDict({
        bundled: defaultTokenDict,
        trainRows,
        testRows,
        fullSupport,
        min: MIN,
    })
    const t = createTransliterator({ tokenDict: dict, fstResults: distillMapFor(defaultFstDistill, trainRows, dict) })
    const results = evaluate(testRows, t)
    foldResults.push(...results)
    foldMeta.push({ fold: f, testRows: testRows.length, dictSize: Object.keys(dict).length, removed, addedByTrain: added, enrichedByTrain: enriched, perFold: report(results) })
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

console.log(`K-fold cross-validation (k=${K}, min ${MIN} attestations) on scraped in-domain rows`)
console.log(`eval rows: ${evalRows.length} (of ${inDomain.length} in-domain), deterministic fold assignment\n`)

for (const m of foldMeta)
    console.log(`  fold ${m.fold}: test ${m.testRows}  dict ${m.dictSize} (-${m.removed} test-only, +${m.addedByTrain} train-mined, ~${m.enrichedByTrain} enriched)`)

const kfold = bucketize(foldResults)
const shipped = bucketize(shippedResults)
const perFold = foldMeta.map((m) => m.perFold).filter(Boolean)

console.log('\nSHIPPED dictionary (partly in-sample — what eval:scraped reports):')
console.log(fmt('  in-domain', shipped.inDomain))
console.log(fmt('  cambodian citizens', shipped.cambodian))
console.log(fmt('  unknown (ancient kings etc.)', shipped.unknown))

console.log(`\nK-FOLD (leakage-free counterfactual dictionary per fold):`)
console.log(fmt('  in-domain', kfold.inDomain))
console.log(fmt('  cambodian citizens', kfold.cambodian))
console.log(fmt('  unknown (ancient kings etc.)', kfold.unknown))

const foldRates = perFold.filter((r) => r.n).map((r) => r.exactPct)
if (foldRates.length)
    console.log(`  per-fold in-domain exact: ${foldRates.map((r) => r + '%').join('  ')}  (spread ${Math.min(...foldRates)}–${Math.max(...foldRates)}%)`)

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
