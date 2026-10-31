#!/usr/bin/env node
/**
 * Dictionary merger: folds mined corpus tokens into src/token-data.ts.
 *
 * Reads scripts/mined-tokens.json (from `npm run mine:tokens`) and the
 * current bundled dictionary, then REGENERATES src/token-data.ts in
 * place — this repo owns its dictionary now; no external source
 * repository is needed.
 *
 * Merge policy (deliberately conservative):
 *   new + count >= --min (default 2)   -> added
 *   agree                              -> kept as-is (bundle wins)
 *   conflict                           -> kept as-is, logged for review
 *
 * Existing entries are never modified: the verified gold set stays
 * byte-stable, and the diff stays reviewable.
 *
 * Usage: node scripts/merge-tokens.mjs [--min 2] [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { defaultTokenDict } from '../dist/index.js'

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
const conflicts = []
for (const m of mined) {
    if (merged[m.khmer]) {
        if (titleCase(merged[m.khmer].latin) !== m.latin) conflicts.push(m)
        continue // agree or conflict — bundle wins either way
    }
    if (m.count < min) continue
    const entry = { latin: m.latin, count: m.count }
    const variants = Object.fromEntries(
        Object.entries(m.variants ?? {}).filter(([, n]) => n >= min),
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

console.log(`bundled: ${Object.keys(defaultTokenDict).length}  mined: ${mined.length}  ->  merged: ${Object.keys(merged).length} (+${added} added, min ${min} attestation${min === 1 ? '' : 's'})`)
console.log(`conflicts held back for review: ${conflicts.length}`)
for (const c of conflicts.slice(0, 15)) {
    console.log(`  ${c.khmer}  bundled: ${titleCase(merged[c.khmer].latin)}  vs  corpus: ${c.latin} (x${c.count})`)
}

if (dry) {
    console.log('\n(dry run — src/token-data.ts not written)')
} else {
    writeFileSync(new URL('../src/token-data.ts', import.meta.url), header)
    console.log('\nwrote src/token-data.ts')
}
