#!/usr/bin/env node
/**
 * Token miner: turns the scraped corpus into candidate dictionary entries.
 *
 * Aligns in-domain pairs whose token shapes the composer can produce:
 * 1:1 (token count = word count) or tail-run rows (Khmer spellings that
 * run syllables together; the tail token absorbs up to 2 extra Latin
 * words as a multi-word variant). Counts Khmer-token -> Latin-word
 * attestations, and compares the result with the bundled dictionary:
 *
 *   new       — tokens the bundled dictionary does not know
 *   conflict  — tokens it knows with a different canonical spelling
 *   agree     — tokens it already gets right
 *
 * Output: scripts/mined-tokens.json (review before merging anything into
 * src/token-data.ts). Usage: node scripts/mine-tokens.mjs [--top 30]
 *
 * Input is scripts/dev-split.json — the corpus minus the frozen test split
 * (scripts/test-split.json, see split-corpus.mjs) — so mining can never
 * learn from held-out rows.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { defaultTokenDict, normalizeName, splitTokens, stripHonorifics } from '../dist/index.js'
import { countAttestations, alignRow } from './lib/corpus-tools.mjs'

const top = Number(process.argv.includes('--top')
    ? process.argv[process.argv.indexOf('--top') + 1]
    : 30)

let pairs
try {
    pairs = JSON.parse(readFileSync(new URL('./dev-split.json', import.meta.url), 'utf8'))
} catch {
    console.error('scripts/dev-split.json not found — run `npm run split:corpus` first.')
    console.error('(The dev split excludes the frozen test split, so mining never learns from it.)')
    process.exit(1)
}
const inDomain = pairs.filter((p) => ['cambodian', 'unknown', 'curated', 'distilled'].includes(p.bucket))

const counts = countAttestations(inDomain)
let aligned = 0
for (const p of inDomain) {
    const kt = splitTokens(stripHonorifics(normalizeName(p.khmer)).name)
    const lw = p.latin.split(/\s+/).filter(Boolean)
    if (alignRow(kt.length, lw.length)) aligned++
}

const titleCase = (w) => w.split(' ').map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase()).join(' ')
const mined = []
for (const [khmer, spellings] of counts) {
    const ranked = [...spellings.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    const [canonical, canonicalHit] = ranked[0]
    const isTail = ([, hit]) => hit.tail
    // tail-run spellings: separate evidence class (see corpus-tools.mjs)
    const canonicalTail = canonicalHit.tail || undefined
    const variants = Object.fromEntries(ranked.filter((sp) => !isTail(sp)).slice(1).map(([sp, hit]) => [sp, hit.count]))
    const tailVariants = Object.fromEntries(ranked.filter(isTail).map(([sp, hit]) => [sp, hit.count]))
    const sources = [...new Set(ranked.flatMap(([, hit]) => [...hit.sources]))]
    const bundled = defaultTokenDict[khmer]
    const status = !bundled ? 'new' : titleCase(bundled.latin) === canonical ? 'agree' : 'conflict'
    mined.push({
        khmer,
        latin: canonical,
        count: canonicalHit.count,
        canonicalTail,
        variants,
        tailVariants: Object.keys(tailVariants).length ? tailVariants : undefined,
        sources,
        status,
        bundledLatin: bundled ? titleCase(bundled.latin) : undefined,
    })
}

mined.sort((a, b) => b.count - a.count || a.khmer.localeCompare(b.khmer))
const news = mined.filter((m) => m.status === 'new')
const conflicts = mined.filter((m) => m.status === 'conflict')
const agrees = mined.filter((m) => m.status === 'agree')

console.log(`aligned ${aligned}/${inDomain.length} in-domain pairs into ${counts.size} unique tokens`)
console.log(`agree: ${agrees.length}   new: ${news.length}   conflict: ${conflicts.length}`)
console.log(`\ntop ${Math.min(top, news.length)} NEW tokens:`)
for (const m of news.slice(0, top)) {
    console.log(`  ${m.khmer}  ->  ${m.latin}  (x${m.count}${Object.keys(m.variants).length ? `  variants: ${JSON.stringify(m.variants)}` : ''})`)
}
console.log(`\ntop ${Math.min(15, conflicts.length)} CONFLICTS (bundled vs scraped-canonical):`)
for (const m of conflicts.sort((a, b) => b.count - a.count).slice(0, 15)) {
    console.log(`  ${m.khmer}  bundled: ${m.bundledLatin}  vs  scraped: ${m.latin} (x${m.count})`)
}

writeFileSync(
    new URL('./mined-tokens.json', import.meta.url),
    JSON.stringify({ generated: new Date().toISOString(), aligned, tokens: mined }, null, 1),
)
console.log('\nfull list -> scripts/mined-tokens.json')
