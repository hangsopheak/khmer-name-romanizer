#!/usr/bin/env node
/**
 * Leakage-free accuracy on the FROZEN test split (scripts/test-split.json).
 *
 * `eval:scraped` scores the shipped dictionary on the whole corpus (partly
 * in-sample). `eval:kfold` cross-validates over the corpus. This script is
 * the lockbox reading: it scores ONLY the frozen test rows, against the
 * counterfactual dictionary the package would ship if those rows had never
 * been scraped:
 *
 *   1. strip bundled keys whose corpus support comes ENTIRELY from test rows
 *      (they would never have met the >= 2-attestation merge threshold)
 *   2. re-merge everything minable from the dev split
 *
 * The frozen split is also never used for tuning — every improvement round
 * is judged by this number, so the honest baseline must be captured before
 * any accuracy work lands.
 *
 * Same known limits as eval-kfold (kept honest): variant-level leakage is
 * not attributable (top-5 slightly optimistic); a stripped key might
 * independently be gold/roster-sourced (exact slightly pessimistic).
 *
 * Usage: node scripts/eval-holdout.mjs [--top 15]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createDefaultTransliterator, createTransliterator, defaultFstDistill, defaultTokenDict } from '../dist/index.js'
import {
    counterfactualDict,
    distillMapFor,
    isInDomain,
    isShapeMatchable,
    norm,
    passesHygiene,
    similarity,
    sortedNorm,
    supportOf,
} from './lib/corpus-tools.mjs'

const top = Number(process.argv.includes('--top')
    ? process.argv[process.argv.indexOf('--top') + 1]
    : 15)

const read = (name) => JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'))
const dev = read('dev-split.json')
const test = read('test-split.json')

const devInDomain = dev.filter(isInDomain)
const testInDomain = test.filter(isInDomain).filter(passesHygiene)
const testForeign = test.filter((p) => p.bucket === 'foreign').filter(passesHygiene)

/* ------------------------------------------------------------------ */
/* counterfactual dictionary: as if the test split never existed       */
/* ------------------------------------------------------------------ */
const fullSupport = supportOf([...devInDomain, ...test.filter(isInDomain)])
const { dict, removed, added, enriched } = counterfactualDict({
    bundled: defaultTokenDict,
    trainRows: devInDomain,
    testRows: testInDomain,
    fullSupport,
})

/* ------------------------------------------------------------------ */
/* evaluation                                                          */
/* ------------------------------------------------------------------ */
const evaluate = (rows, t) =>
    rows.map((p) => {
        const r = t.transliterate(p.khmer)
        const hit = r.value.toLowerCase() === p.latin.toLowerCase()
        return {
            khmer: p.khmer,
            latin: p.latin,
            bucket: p.bucket,
            got: r.value,
            hit,
            orderOnly: !hit && sortedNorm(r.value) === sortedNorm(p.latin),
            inTop5: r.candidates.some((c) => norm(c) === norm(p.latin)),
            sim: +similarity(r.value, p.latin).toFixed(3),
            matchable: isShapeMatchable(p),
        }
    })

const report = (rows) => {
    if (!rows.length) return { n: 0 }
    const exact = rows.filter((r) => r.hit).length
    const matchable = rows.filter((r) => r.matchable)
    const top5Matchable = matchable.filter((r) => r.inTop5).length
    return {
        n: rows.length,
        exact,
        exactPct: +(100 * (exact / rows.length)).toFixed(1),
        anyOrder: rows.filter((r) => r.hit || r.orderOnly).length,
        top5: rows.filter((r) => r.inTop5).length,
        top5Pct: +(100 * (rows.filter((r) => r.inTop5).length / rows.length)).toFixed(1),
        meanSim: +(rows.reduce((a, r) => a + r.sim, 0) / rows.length).toFixed(3),
        matchableN: matchable.length,
        top5Matchable,
        top5MatchablePct: matchable.length ? +((100 * top5Matchable) / matchable.length).toFixed(1) : 0,
    }
}

const holdoutResults = evaluate(testInDomain, createTransliterator({ tokenDict: dict, fstResults: distillMapFor(defaultFstDistill, devInDomain, dict) }))
const shippedResults = evaluate(testInDomain, createDefaultTransliterator())
const foreignResults = evaluate(testForeign, createTransliterator({ tokenDict: dict }))

const byBucket = (rows) => ({
    cambodian: report(rows.filter((r) => r.bucket === 'cambodian')),
    unknown: report(rows.filter((r) => r.bucket === 'unknown')),
    curated: report(rows.filter((r) => r.bucket === 'curated')),
    inDomain: report(rows),
})

const holdout = byBucket(holdoutResults)
const shipped = byBucket(shippedResults)

const fmt = (label, r) =>
    r.n
        ? `${label.padEnd(36)} n=${String(r.n).padStart(3)}  exact ${String(r.exact).padStart(3)} (${String(r.exactPct).padStart(5)}%)  top-5 ${String(r.top5).padStart(3)} (${String(r.top5Pct).padStart(5)}%)  mean ${r.meanSim}`
        : `${label.padEnd(36)} n=0`

console.log(`HOLDOUT: frozen test split (${test.length} rows, never mined, never tuned on)`)
console.log(`eval rows: ${testInDomain.length} in-domain (of ${test.filter(isInDomain).length}), hygiene-filtered`)
console.log(`counterfactual dict: ${Object.keys(dict).length} keys (-${removed} test-only, +${added} dev-mined, ~${enriched} enriched)\n`)

console.log('SHIPPED dictionary on the same test rows (partly in-sample — upper bound):')
console.log(fmt('  in-domain', shipped.inDomain))
console.log(fmt('  cambodian citizens', shipped.cambodian))
console.log(fmt('  unknown (ancient kings etc.)', shipped.unknown))
console.log(fmt('  curated', shipped.curated))

console.log('\nHOLDOUT counterfactual dictionary (the honest number):')
console.log(fmt('  in-domain', holdout.inDomain))
console.log(fmt('  cambodian citizens', holdout.cambodian))
console.log(fmt('  unknown (ancient kings etc.)', holdout.unknown))
console.log(fmt('  curated', holdout.curated))
console.log(fmt('  foreign (out-of-domain ref.)', report(foreignResults)))
console.log(
    `\n  in-domain top-5 over shape-matchable rows only: ${holdout.inDomain.top5Matchable}/${holdout.inDomain.matchableN} (${holdout.inDomain.top5MatchablePct}%) — ${holdout.inDomain.n - holdout.inDomain.matchableN} of ${holdout.inDomain.n} rows are structurally unmatchable`,
)

const misses = holdoutResults
    .filter((r) => !r.hit)
    .sort((a, b) => a.sim - b.sim)
    .slice(0, top)
console.log(`\nworst ${misses.length} in-domain misses:`)
for (const m of misses) console.log(`  ${m.khmer}  want ${m.latin}  got ${m.got}  sim ${m.sim}${m.inTop5 ? '  (in top-5)' : ''}`)

writeFileSync(
    new URL('./eval-holdout-report.json', import.meta.url),
    JSON.stringify(
        {
            generated: new Date().toISOString(),
            testRows: test.length,
            evalRows: testInDomain.length,
            dict: { size: Object.keys(dict).length, removed, added, enriched },
            shipped,
            holdout,
            foreign: report(foreignResults),
            misses: holdoutResults.filter((r) => !r.hit).sort((a, b) => a.sim - b.sim),
        },
        null,
        1,
    ),
)
console.log('\nfull report -> scripts/eval-holdout-report.json')
