#!/usr/bin/env node
/**
 * Famous-people regression eval for khmer-name-romanizer.
 *
 * Khmer spellings verified against Khmer Wikipedia, official Latin
 * spellings against English Wikipedia / established usage. Run:
 *
 *   npm run build && node scripts/eval-famous.mjs [--verbose]
 */
import { readFileSync } from 'node:fs'
import { createDefaultTransliterator } from '../dist/index.js'

const names = JSON.parse(readFileSync(new URL('./famous-people.json', import.meta.url), 'utf8'))
const verbose = process.argv.includes('--verbose')
/** Regression gate for CI: exit 1 when exact drops below N. */
const minExact = Number(process.argv.includes('--min-exact')
    ? process.argv[process.argv.indexOf('--min-exact') + 1]
    : 0)

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

const t = createDefaultTransliterator()
let exact = 0
let top5 = 0
const sims = []
const misses = []

for (const { khmer, expected, who } of names) {
    const result = t.transliterate(khmer)
    const hit = result.value.toLowerCase() === expected.toLowerCase()
    const inTop5 = result.candidates.some((c) => c.toLowerCase() === expected.toLowerCase())
    if (hit) exact++
    if (inTop5) top5++
    sims.push(similarity(result.value, expected))
    if (!hit) misses.push({ khmer, expected, who, got: result.value, inTop5, candidates: result.candidates })
}

const pct = (n) => `${n}/${names.length} (${((100 * n) / names.length).toFixed(1)}%)`
console.log(`Famous Cambodian names: ${names.length}`)
console.log(`Exact match:   ${pct(exact)}`)
console.log(`In top-5:      ${pct(top5)}`)
console.log(`Mean similarity: ${(sims.reduce((a, b) => a + b, 0) / sims.length).toFixed(3)}`)

if (misses.length) {
    console.log('\nMisses:')
    for (const m of misses) {
        console.log(`  ${m.khmer} (${m.who})`)
        console.log(`    expected: ${m.expected}`)
        console.log(`    got:      ${m.got}${m.inTop5 ? '   [official spelling IS in top-5]' : ''}`)
        if (verbose) console.log(`    candidates: ${m.candidates.join(' | ')}`)
    }
}

if (minExact && exact < minExact) {
    console.error(`\nGATE FAILED: famous exact ${exact} < ${minExact}`)
    process.exit(1)
}
