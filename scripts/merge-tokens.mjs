#!/usr/bin/env node
/**
 * Dictionary merger: folds mined corpus tokens into src/token-data.ts.
 *
 * Reads scripts/mined-tokens.json (from `npm run mine:tokens`) and the
 * current bundled dictionary, then REGENERATES src/token-data.ts in
 * place — this repo owns its dictionary now; no external source
 * repository is needed.
 *
 * Merge policy:
 *   new + count >= --min (default 2)   -> added
 *   new + count 1 from static/kname    -> added (see below)
 *   agree / conflict                   -> canonical kept; corpus-observed
 *        variants (count >= min) folded into `variants`
 *
 * A single attestation is never enough from SCRAPED sources: Wikidata's
 * name items are foreign transcriptions (it barely models Khmer names),
 * and one-shot label alignments produce junk (ខាន់ → Jessa was caught
 * exactly this way). The one exception is static/kname — a hand-curated
 * MIT-licensed Cambodian name list whose quality was measured before
 * trusting: 25/30 tokens that overlap the verified dictionary agree
 * exactly, and the remaining 5 are legitimate variant spellings
 * (Cheurn/Choeurn, Saen/Sen…), zero junk. Canonical spellings and counts
 * of existing entries are never touched: the verified gold set stays
 * authoritative, and the diff stays reviewable.
 *
 * Usage: node scripts/merge-tokens.mjs [--min 2] [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { defaultTokenDict } from '../dist/index.js'

const TRUSTED_STATIC = new Set(['static/kname'])

// Hand-reviewed junk that slipped the quantitative gates (2026-10-31
// review of the +68 batch): bible-apostle titles (សាវក "apostle" ->
// Bartholomew), foreign public figures with no citizenship on Wikidata
// (Modi, Garegin, Veloso…), a title-fused token (លោកឌីអូហ្គូ "Mr.
// Diego"), mis-aligned birth-name/redirect artifacts (ប៊ុនណាល់ -> "Hun"
// is Hun Sen's FAMILY name; បូរ៉េត -> "Long" is Long Boret's GIVEN name;
// សាមុត -> "Sisamouth" is half of Sinn Sisamouth), and one bad
// alphabetical tie-break (លក្ខិណា -> "In" overrode the correct Lakhena).
const REVIEWED_JUNK = new Set([
    'សាវក', 'សាវ័កបាថូឡូមេ', 'ប៊ុនណាល់', 'បូរ៉េត', 'មីចឡែន', 'ម៉ូឌី',
    'លោកឌីអូហ្គូ', 'សឺវ៉ាន់ដ្សទីយាន', 'ហ្គារីហ្គិន', 'វេឡូសូ', 'អ៊ូ', 'សាមុត',
    'លក្ខិណា',
])
// variant-level blocks ("khmer|Latin"): mis-alignments, not spellings
const REVIEWED_JUNK_VARIANTS = new Set(['ស|Pot'])

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name, fallback) => {
    const i = args.indexOf(name)
    return i !== -1 ? Number(args[i + 1]) : fallback
}
const min = value('--min', 2)
const dry = flag('--dry')

const { tokens: mined } = JSON.parse(readFileSync(new URL('./mined-tokens.json', import.meta.url), 'utf8'))

const merged = { ...defaultTokenDict }
let added = 0
let enriched = 0
const enrichments = []
const conflicts = []
for (const m of mined) {
    const existing = merged[m.khmer]
    if (existing) {
        if (titleCase(existing.latin) !== m.latin) {
            conflicts.push(m)
            // Adjudicated rule: a conflicting corpus spelling with >= min
            // attestations is a legitimate alternative romanization (all
            // cases reviewed: Samnang/Kakada/Khim/Pen/Rattana/Sambath) —
            // expose it as a variant; the canonical stays untouched.
            // Single-attestation conflicts stay held back (label junk:
            // ខាន់ -> "Jessa" was caught exactly this way).
            if (m.count >= min) {
                const known = new Set([
                    titleCase(existing.latin),
                    ...Object.keys(existing.variants ?? {}).map(titleCase),
                ])
                const junk = REVIEWED_JUNK_VARIANTS.has(`${m.khmer}|${titleCase(m.latin)}`)
                if (!known.has(titleCase(m.latin)) && !junk) {
                    merged[m.khmer] = {
                        ...existing,
                        variants: { ...(existing.variants ?? {}), [m.latin]: m.count },
                    }
                    enriched++
                    enrichments.push({ khmer: m.khmer, added: [m.latin] })
                }
            }
        }
        // fold corpus-observed spellings into variants (never the canonical)
        const known = new Set([
            titleCase(existing.latin),
            ...Object.keys(existing.variants ?? {}).map(titleCase),
        ])
        const additions = Object.entries(m.variants ?? {}).filter(
            ([sp, n]) => n >= min && !known.has(titleCase(sp))
                && !REVIEWED_JUNK_VARIANTS.has(`${m.khmer}|${titleCase(sp)}`),
        )
        if (additions.length) {
            merged[m.khmer] = {
                ...existing,
                variants: { ...(existing.variants ?? {}), ...Object.fromEntries(additions) },
            }
            enriched++
            enrichments.push({ khmer: m.khmer, added: additions.map(([sp]) => sp) })
        }
        continue
    }
    if (REVIEWED_JUNK.has(m.khmer)) continue
    if (m.count < min && !(m.count >= 1 && (m.sources ?? []).some((s) => TRUSTED_STATIC.has(s)))) continue
    const entry = { latin: m.latin, count: m.count }
    const variants = Object.fromEntries(
        Object.entries(m.variants ?? {}).filter(
            ([sp, n]) => n >= min && !REVIEWED_JUNK_VARIANTS.has(`${m.khmer}|${titleCase(sp)}`),
        ),
    )
    if (Object.keys(variants).length) entry.variants = variants
    merged[m.khmer] = entry
    added++
}

function titleCase(w) {
    return w.split(' ').map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase()).join(' ')
}

const lines = []
for (const khmer of Object.keys(merged).sort()) {
    const { latin, count, variants } = merged[khmer]
    let entry = `{ latin: ${JSON.stringify(latin)}, count: ${count}`
    if (variants && Object.keys(variants).length) {
        entry += `, variants: ${JSON.stringify(variants)}`
    }
    lines.push(`    ${JSON.stringify(khmer)}: ${entry} },`)
}

const header = `/**
 * Generated dictionary — DO NOT EDIT BY HAND.
 * Base: verified bilingual gold set. Extended by corpus mining:
 *   npm run scrape:names && npm run eval:scraped && npm run mine:tokens
 *   npm run merge:tokens
 * (scripts/scrape_names.py + scripts/mine-tokens.mjs + scripts/merge-tokens.mjs)
 */

import { TokenDictionaryData } from './types.js'

export const defaultTokenDict: TokenDictionaryData = {
${lines.join('\n')}
}
`

console.log(`bundled: ${Object.keys(defaultTokenDict).length}  mined: ${mined.length}  ->  merged: ${Object.keys(merged).length} (+${added} added, ${enriched} enriched with variants, min ${min} attestation${min === 1 ? '' : 's'})`)
console.log(`conflicts held back for review: ${conflicts.length}`)
for (const c of conflicts.slice(0, 15)) {
    console.log(`  ${c.khmer}  bundled: ${titleCase(merged[c.khmer].latin)}  vs  corpus: ${c.latin} (x${c.count})`)
}
if (enrichments.length) {
    console.log(`\nvariant enrichments (${Math.min(10, enrichments.length)} shown):`)
    for (const e of enrichments.slice(0, 10)) {
        console.log(`  ${e.khmer}  +${e.added.join(', +')}`)
    }
}

if (dry) {
    console.log('\n(dry run — src/token-data.ts not written)')
} else {
    writeFileSync(new URL('../src/token-data.ts', import.meta.url), header)
    console.log('\nwrote src/token-data.ts')
}
