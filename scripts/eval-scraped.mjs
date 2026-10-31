#!/usr/bin/env node
/**
 * Reliability eval over the scraped corpus (scripts/scraped-names.json,
 * produced by scripts/scrape_names.py — Wikidata / Khmer Wikipedia).
 *
 * Buckets: cambodian (P27=Q424), unknown (no citizenship on Wikidata —
 * mostly ancient Khmer kings, in-domain), foreign (other citizenship —
 * Khmer renderings of foreign names, reported separately because
 * round-tripping transliterated foreign names is a different task).
 *
 * Usage: node scripts/eval-scraped.mjs [--max-misses 30]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createDefaultTransliterator } from '../dist/index.js'

const maxMisses = Number(process.argv.includes('--max-misses')
    ? process.argv[process.argv.indexOf('--max-misses') + 1]
    : 30)

function levenshtein(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
    for (let j = 0; j <= b.length; j++) dp[0][j] = j
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            )
        }
    }
    return dp[a.length][b.length]
}

const similarity = (a, b) =>
    1 - levenshtein(a.toLowerCase(), b.toLowerCase()) / Math.max(a.length, b.length)

const pairs = JSON.parse(readFileSync(new URL('./scraped-names.json', import.meta.url), 'utf8'))
const t = createDefaultTransliterator()

// Corpus hygiene: Wikidata labels are messy. Drop rows that are clearly not
// name pairs (titles, descriptions, mismatched entities).
const BAD_LATIN_WORDS = new Set(['the', 'of', 'buddha', 'and'])
const excluded = []
const cleanPairs = pairs.filter((p) => {
    const words = p.latin.toLowerCase().split(/\s+/)
    if (words.some((w) => BAD_LATIN_WORDS.has(w))) return excluded.push({ ...p, why: 'non-name latin' }), false
    if (p.latin.split(' ').length === 1 && p.khmer.split(' ').length >= 3)
        return excluded.push({ ...p, why: 'long khmer title vs single latin word' }), false
    return true
})

// Order-free comparison: Khmer is surname-first, English labels are often
// given-name-first. The romanizer deliberately preserves Khmer order, so a
// token-sorted match counts as an order-only difference, not a miss.
const sortedNorm = (s) => s.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean).sort().join(' ')

const results = cleanPairs.map((p) => {
    const r = t.transliterate(p.khmer)
    const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '')
    const hit = r.value.toLowerCase() === p.latin.toLowerCase()
    return {
        ...p,
        got: r.value,
        hit,
        orderOnly: !hit && sortedNorm(r.value) === sortedNorm(p.latin),
        inTop5: r.candidates.some((c) => norm(c) === norm(p.latin)),
        sim: +similarity(r.value, p.latin).toFixed(3),
    }
})

function bucketReport(list) {
    if (!list.length) return null
    const exact = list.filter((r) => r.hit).length
    const exactAnyOrder = list.filter((r) => r.hit || r.orderOnly).length
    const top5 = list.filter((r) => r.inTop5).length
    const ge90 = list.filter((r) => r.sim >= 0.9).length
    const ge75 = list.filter((r) => r.sim >= 0.75).length
    const meanSim = list.reduce((a, r) => a + r.sim, 0) / list.length
    return { n: list.length, exact, exactAnyOrder, top5, ge90, ge75, meanSim: +meanSim.toFixed(3) }
}

const buckets = { cambodian: [], unknown: [], foreign: [] }
for (const r of results) (buckets[r.bucket] ??= []).push(r)
const inDomain = [...buckets.cambodian, ...buckets.unknown]

const fmt = (label, rep) =>
    rep
        ? `${label.padEnd(36)} ${String(rep.n).padStart(5)}  exact ${String(rep.exact).padStart(5)} (${((100 * rep.exact) / rep.n).toFixed(1)}%)  any-order ${String(rep.exactAnyOrder).padStart(5)} (${((100 * rep.exactAnyOrder) / rep.n).toFixed(1)}%)  top5 ${String(rep.top5).padStart(5)}  ≥0.90 ${String(rep.ge90).padStart(5)}  mean ${rep.meanSim}`
        : `${label.padEnd(36)}     0  (no rows)`

console.log('Scraped-corpus reliability (scripts/scraped-names.json)')
console.log(`rows: ${pairs.length} unique scraped, ${excluded.length} excluded as junk`)
console.log(fmt('IN-DOMAIN (cambodian+unknown)', bucketReport(inDomain)))
console.log(fmt('  cambodian citizens', bucketReport(buckets.cambodian)))
console.log(fmt('  unknown (ancient kings etc.)', bucketReport(buckets.unknown)))
console.log(fmt('foreign (out of domain)', bucketReport(buckets.foreign)))

const misses = inDomain.filter((r) => !r.hit && !r.orderOnly).sort((a, b) => a.sim - b.sim)
const orderFlips = inDomain.filter((r) => r.orderOnly)
console.log(`\norder-only differences (correct tokens, Khmer vs Western order): ${orderFlips.length}`)
for (const m of orderFlips.slice(0, 5)) console.log(`  ${m.khmer}  ${m.got}  <->  ${m.latin}`)
console.log(`\nWorst in-domain misses (${Math.min(maxMisses, misses.length)} of ${misses.length}):`)
for (const m of misses.slice(0, maxMisses)) {
    console.log(`  ${m.khmer}\n    expected: ${m.latin}\n    got:      ${m.got}   sim ${m.sim}${m.inTop5 ? '  [in top-5]' : ''}`)
}

writeFileSync(
    new URL('./eval-scraped-report.json', import.meta.url),
    JSON.stringify({
        generated: new Date().toISOString(),
        scraped: pairs.length,
        excluded: excluded.map(({ khmer, latin, why }) => ({ khmer, latin, why })),
        inDomain: bucketReport(inDomain),
        buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, bucketReport(v)])),
        orderFlips: orderFlips.map(({ khmer, got, latin }) => ({ khmer, got, latin })),
        misses: misses.map(({ khmer, latin, got, sim, inTop5, bucket }) => ({ khmer, latin, got, sim, inTop5, bucket })),
    }, null, 1),
)
console.log('\nfull report -> scripts/eval-scraped-report.json')
