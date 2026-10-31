#!/usr/bin/env node
/**
 * Token miner: turns the scraped corpus into candidate dictionary entries.
 *
 * Aligns in-domain pairs whose Khmer token count equals the Latin word
 * count (strict 1:1 alignment), counts Khmer-token -> Latin-word
 * attestations, and compares the result with the bundled dictionary:
 *
 *   new       — tokens the bundled dictionary does not know
 *   conflict  — tokens it knows with a different canonical spelling
 *   agree     — tokens it already gets right
 *
 * Output: scripts/mined-tokens.json (review before merging anything into
 * src/token-data.ts). Usage: node scripts/mine-tokens.mjs [--top 30]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { defaultTokenDict } from '../dist/index.js'

const top = Number(process.argv.includes('--top')
    ? process.argv[process.argv.indexOf('--top') + 1]
    : 30)

const pairs = JSON.parse(readFileSync(new URL('./scraped-names.json', import.meta.url), 'utf8'))
const inDomain = pairs.filter((p) => ['cambodian', 'unknown', 'curated'].includes(p.bucket))

const counts = new Map()
let aligned = 0
const countAttestation = (kt, words, source) => {
    kt.forEach((k, i) => {
        const word = words[i]
        const latin = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        if (!counts.has(k)) counts.set(k, new Map())
        const m = counts.get(k)
        const hit = m.get(latin) ?? { count: 0, sources: new Set() }
        hit.count += 1
        hit.sources.add(source)
        m.set(latin, hit)
    })
}
for (const p of inDomain) {
    const kt = p.khmer.split(' ')
    const lw = p.latin.split(' ')
    if (kt.length === lw.length) {
        aligned++
        countAttestation(kt, lw, p.source ?? 'unknown')
    }
    // alternate Latin spellings harvested from en.wikipedia redirects:
    // extra attestations (variant material), never counted as alignments
    for (const alt of p.altLatin ?? []) {
        const aw = alt.split(' ')
        if (aw.length !== kt.length) continue
        countAttestation(kt, aw, 'wikipedia/redirects-en')
    }
}

const titleCase = (w) => w.split(' ').map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase()).join(' ')
const mined = []
for (const [khmer, spellings] of counts) {
    const ranked = [...spellings.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    const [canonical, canonicalHit] = ranked[0]
    const variants = Object.fromEntries(ranked.slice(1).map(([sp, hit]) => [sp, hit.count]))
    const sources = [...new Set(ranked.flatMap(([, hit]) => [...hit.sources]))]
    const bundled = defaultTokenDict[khmer]
    const status = !bundled ? 'new' : titleCase(bundled.latin) === canonical ? 'agree' : 'conflict'
    mined.push({
        khmer,
        latin: canonical,
        count: canonicalHit.count,
        variants,
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
