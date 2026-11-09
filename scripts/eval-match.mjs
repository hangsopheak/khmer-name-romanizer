#!/usr/bin/env node
/**
 * Match-mode eval: the KYC/dedup use case (eval:match).
 *
 * Suggest-mode evals ask "is the official spelling the FIRST/best guess";
 * match mode asks the question a screening workflow actually needs:
 *
 *   Given a Khmer-script name and an official Latin spelling, does the
 *   engine's candidate set recognize them as the same person?
 *
 * Uses flipOrderCandidates (Khmer writes the surname first; Latin records
 * often reorder), order-insensitive comparison, and reports the rank at
 * which the official spelling is found — a rank-1 hit is an exact match,
 * ranks 2..10 are "found, but not the first guess".
 *
 * IN-SAMPLE: scores the shipped dictionary on the corpus it was mined
 * from — an upper bound for names the dictionary already knows. The
 * honest unseen-name match rate is the "match mode" line of eval:kfold.
 *
 * Usage: node scripts/eval-match.mjs [--max 10]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createDefaultTransliterator } from '../dist/index.js'
import { isInDomain, norm, passesHygiene, similarity, sortedNorm } from './lib/corpus-tools.mjs'

const maxRank = Number(process.argv.includes('--max')
    ? process.argv[process.argv.indexOf('--max') + 1]
    : 10)

const pairs = JSON.parse(readFileSync(new URL('./scraped-names.json', import.meta.url), 'utf8'))
const rows = pairs.filter(isInDomain).filter(passesHygiene)
const t = createDefaultTransliterator({ flipOrderCandidates: true })

const results = rows.map((p) => {
    const r = t.transliterate(p.khmer)
    let rank = 0
    for (let i = 0; i < Math.min(r.candidates.length, maxRank); i++) {
        if (norm(r.candidates[i]) === norm(p.latin) || sortedNorm(r.candidates[i]) === sortedNorm(p.latin)) {
            rank = i + 1
            break
        }
    }
    return { bucket: p.bucket, rank, sim: similarity(r.value, p.latin) }
})

const report = (list) => {
    if (!list.length) return { n: 0 }
    const at = (k) => list.filter((r) => r.rank >= 1 && r.rank <= k).length
    return {
        n: list.length,
        matched: at(maxRank),
        matchedPct: +((100 * at(maxRank)) / list.length).toFixed(1),
        rank1: at(1),
        rank1Pct: +((100 * at(1)) / list.length).toFixed(1),
        rank2to5: at(5) - at(1),
        rank6to10: at(10) - at(5),
        meanSim: +(list.reduce((a, r) => a + r.sim, 0) / list.length).toFixed(3),
    }
}

const byBucket = (bucket) => results.filter((r) => r.bucket === bucket)
const overall = report(results)
const fmt = (label, r) =>
    r.n
        ? `${label.padEnd(36)} n=${String(r.n).padStart(4)}  matched@${maxRank} ${String(r.matched).padStart(4)} (${String(r.matchedPct).padStart(5)}%)  rank1 ${String(r.rank1).padStart(4)}  ranks2-5 ${String(r.rank2to5).padStart(4)}  ranks6-${maxRank} ${String(r.rank6to10).padStart(3)}`
        : `${label.padEnd(36)} n=0`

console.log(`MATCH-MODE eval (flipOrderCandidates, order-insensitive, top-${maxRank}) on scraped in-domain rows`)
console.log('IN-SAMPLE (shipped dictionary on its own mining corpus) — unseen-name match rate: npm run eval:kfold')
console.log(`eval rows: ${rows.length}\n`)
console.log(fmt('IN-DOMAIN (cambodian+unknown+curated)', overall))
console.log(fmt('  cambodian citizens', report(byBucket('cambodian'))))
console.log(fmt('  unknown (ancient kings etc.)', report(byBucket('unknown'))))
console.log(fmt('  curated lists', report(byBucket('curated'))))
writeFileSync(
    new URL('./eval-match-report.json', import.meta.url),
    JSON.stringify({
        generated: new Date().toISOString(),
        maxRank,
        inDomain: overall,
        buckets: {
            cambodian: report(byBucket('cambodian')),
            unknown: report(byBucket('unknown')),
            curated: report(byBucket('curated')),
        },
    }, null, 1),
)
console.log('\nfull report -> scripts/eval-match-report.json')
