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
 *   new + count 1, round-trip gated     -> added (singleton class, below)
 *
 * Singleton class (0.4.0): a NEW token attested once is admitted when the
 * rule engine's own reading is >= SINGLETON_SIM similar to the spelling
 * (singletonOk in scripts/lib/corpus-tools.mjs). Without it the token
 * falls to the rules, whose first guess is right ~31% of the time; a
 * corpus spelling that passes the gate is right far more often. Measured
 * on person-grouped k-fold: +10/-2 exact, +11/-1 top-5. The gate rejects
 * one-shot mis-alignments (ខាន់ -> "Jessa"); existing canonicals and
 * variants keep the min-2 rule. Singletons only fill gaps: never over a
 * distilled FST reading (k-fold cannot exercise that case) and never from
 * machine-translated lists (static/sigpwned).
 *
 * Before 0.4.0, a single attestation was never enough from SCRAPED sources: Wikidata's
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
import { defaultFstDistill, defaultTokenDict } from '../dist/index.js'
import { SINGLETON_SIM, SINGLETON_SKIP_SOURCES, loadNativeVocab, singletonOk } from './lib/corpus-tools.mjs'

const TRUSTED_STATIC = new Set(['static/kname', 'static/manual', 'static/distill-verified'])
// 'static/manual' = hand-verified pairs from manual CLI testing
// (scripts/sources/manual-verified.json): a human-confirmed official
// spelling is the same trust class as kname's hand-curated list — a
// single attestation is admitted.
// 'static/distill-verified' = compiled trusted tier of the name-list
// distillation pipeline (scripts/compile-trusted.mjs): native-reader-
// corrected / user-approved second-AI spellings plus round-trip-verified
// behindthename transcriptions. Same single-attestation admission.

// Hand-reviewed junk that slipped the quantitative gates (2026-10-31
// review of the +68 batch): bible-apostle titles (សាវក "apostle" ->
// Bartholomew), foreign public figures with no citizenship on Wikidata
// (Modi, Garegin, Veloso…), a title-fused token (លោកឌីអូហ្គូ "Mr.
// Diego"), mis-aligned birth-name/redirect artifacts (ប៊ុនណាល់ -> "Hun"
// is Hun Sen's FAMILY name; បូរ៉េត -> "Long" is Long Boret's GIVEN name;
// សាមុត -> "Sisamouth" is half of Sinn Sisamouth), and one bad
// alphabetical tie-break (លក្ខិណា -> "In" overrode the correct Lakhena).
// 2026-11-01 refresh: បូរេ៉ត is a combining-mark reordering of the
// junk-blocked បូរ៉េត (same Long Boret mis-alignment, different bytes).
const REVIEWED_JUNK = new Set([
    'សាវក', 'សាវ័កបាថូឡូមេ', 'ប៊ុនណាល់', 'បូរ៉េត', 'បូរេ៉ត', 'មីចឡែន', 'ម៉ូឌី',
    'លោកឌីអូហ្គូ', 'សឺវ៉ាន់ដ្សទីយាន', 'ហ្គារីហ្គិន', 'វេឡូសូ', 'អ៊ូ', 'សាមុត',
    'លក្ខិណា', 'ញ៉ែម', 'ង៉ោ', 'អេលែន',
])
// Mechanical spelling guards, applied to every admitted spelling (canonical
// or variant, tail-run or not): no sane name romanization starts with a
// function word ("Of Assisi", "The Buddha", "Of Cambodia") or carries a
// dotted Latin initial ("S. Ngor", "L. Hammond", "J. Quach") — those are
// artifacts of Latin-first rows and honorific fusions, not spellings.
const isJunkSpelling = (sp) =>
    /^(of|the|and)(\s|$)/i.test(sp) || /\b[A-Za-z]\.(\s|$)/.test(sp)

// variant-level blocks ("khmer|Latin"): mis-alignments, not spellings.
// ឡុង|Boret / ឡុង|Boreth: Khmer "ឡុង បូរ៉េត" rows aligned against
// reversed Latin ("Boret Long") — the Long Boret family again.
// 2026-11-08 tail-run review: ញ៉ែម|Prom Nhem (order artifact), រស់|Moneang Ros
// (honorific fusion), ង៉ោ|S. Ngor + ម៉េងលី|J. Quach + ហាម៉ុង|L. Hammond
// (initial-only artifacts), អេលែន|Dodgson Tan (western-order artifact),
// ស៊ីសុវត្ថិ|Sisowath Of Cambodia + ពុទ្ធប្រវត្តិសង្ខេប|The Buddha ("of/the"
// noise from alt spellings), សុទ្ធា|Serey Sothea (borrowed given-name run),
// ផានីវង្ស|Manivan Phanivong (reversed family-first row),
// សាវក|The Apostle (bible title token).
const REVIEWED_JUNK_VARIANTS = new Set(['ស|Pot', 'ឡុង|Boret', 'ឡុង|Boreth',
    'ញ៉ែម|Prom Nhem', 'រស់|Moneang Ros', 'ង៉ោ|S. Ngor', 'ម៉េងលី|J. Quach',
    'ហាម៉ុង|L. Hammond', 'អេលែន|Dodgson Tan', 'ស៊ីសុវត្ថិ|Sisowath Of Cambodia',
    'ពុទ្ធប្រវត្តិសង្ខេប|The Buddha', 'សុទ្ធា|Serey Sothea',
    'ផានីវង្ស|Manivan Phanivong', 'សាវក|The Apostle'])

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name, fallback) => {
    const i = args.indexOf(name)
    return i !== -1 ? Number(args[i + 1]) : fallback
}
const min = value('--min', 2)
const dry = flag('--dry')

// Tail-run spellings (Khmer tokens whose standard romanization runs
// syllables together, e.g. ប៉ុលពត -> "Pol Pot"): their evidence is the
// in-row alignment, not corpus multiplicity — a solid token's full-name
// row appears once by construction (the token IS the whole name), so a
// count-2 rule would never admit them. They enter at min 1, gated by the
// reviewed-junk blocklists.
const tailMin = 1

const { tokens: mined } = JSON.parse(readFileSync(new URL('./mined-tokens.json', import.meta.url), 'utf8'))

const merged = { ...defaultTokenDict }
let added = 0
let enriched = 0
const enrichments = []
const singletons = []
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
            // ខាន់ -> "Jessa" was caught exactly this way). Tail-run
            // canonicals are the reviewed exception (see tailMin).
            if (m.count >= min || m.canonicalTail) {
                const known = new Set([
                    titleCase(existing.latin),
                    ...Object.keys(existing.variants ?? {}).map(titleCase),
                ])
                const junkKey = `${m.khmer}|${titleCase(m.latin)}`
                const junk = REVIEWED_JUNK_VARIANTS.has(junkKey) || isJunkSpelling(m.latin)
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
        const junkFree = ([sp]) =>
            !known.has(titleCase(sp))
            && !REVIEWED_JUNK_VARIANTS.has(`${m.khmer}|${titleCase(sp)}`)
            && !isJunkSpelling(sp)
        // tail-run variants enter at tailMin (blocklist-gated)
        const additions = Object.entries(m.variants ?? {}).filter(([sp, n]) => n >= min && junkFree([sp]))
            .concat(Object.entries(m.tailVariants ?? {}).filter(([sp, n]) => n >= tailMin))
            .filter(junkFree)
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
    const tailCanonical = m.canonicalTail && m.count >= tailMin
        && !isJunkSpelling(m.latin)
    if (!m.canonicalTail && isJunkSpelling(m.latin)) continue
    // singletons fill gaps only: never over a distilled FST reading (k-fold
    // cannot measure that case), never from machine-translated lists
    const singleton = !m.canonicalTail && m.count >= 1
        && !(m.khmer in defaultFstDistill)
        && !(m.sources ?? []).every((src) => SINGLETON_SKIP_SOURCES.has(src))
        && singletonOk(m.khmer, m.latin)
    if (singleton && m.count < min) singletons.push(m)
    if (m.count < min && !(m.count >= 1 && (m.sources ?? []).some((s) => TRUSTED_STATIC.has(s))) && !tailCanonical && !singleton) continue
    if (m.canonicalTail
        && REVIEWED_JUNK_VARIANTS.has(`${m.khmer}|${titleCase(m.latin)}`)) continue
    const entry = { latin: m.latin, count: m.count }
    const variants = Object.fromEntries(mineVariantPairs(m))
    if (Object.keys(variants).length) entry.variants = variants
    merged[m.khmer] = entry
    added++
}

// Blind native vocabulary (scripts/sources/native-vocab.json): a new key
// takes the native spelling as canonical; an existing key only gains
// missing spellings as variants (canonicals are never flipped here).
const nativeAdded = []
for (const { khmer, spellings } of loadNativeVocab()) {
    const existing = merged[khmer]
    if (!existing) {
        const [latin, ...rest] = spellings
        merged[khmer] = { latin, count: 1, ...(rest.length ? { variants: Object.fromEntries(rest.map((sp) => [sp, 1])) } : {}) }
        added++
        nativeAdded.push(`${khmer} -> ${spellings.join(' / ')}`)
        continue
    }
    const known = new Set([titleCase(existing.latin), ...Object.keys(existing.variants ?? {}).map(titleCase)])
    const extra = spellings.filter((sp) => !known.has(titleCase(sp)))
    if (extra.length) {
        merged[khmer] = { ...existing, variants: { ...(existing.variants ?? {}), ...Object.fromEntries(extra.map((sp) => [sp, 1])) } }
        nativeAdded.push(`${khmer} +${extra.join(', +')}`)
    }
}

function mineVariantPairs(m) {
    // min-2 corpus spellings + blocklist-gated min-1 tail-run spellings;
    // spellings equal to the canonical are redundant and skipped, and the
    // mechanical spelling guards apply regardless of evidence class
    const junkVariant = (sp) => titleCase(sp) === titleCase(m.latin)
        || REVIEWED_JUNK_VARIANTS.has(`${m.khmer}|${titleCase(sp)}`)
        || isJunkSpelling(sp)
    const out = Object.entries(m.variants ?? {}).filter(
        ([sp, n]) => n >= min && !junkVariant(sp),
    )
    for (const [sp, n] of Object.entries(m.tailVariants ?? {})) {
        if (n >= tailMin && !junkVariant(sp)) out.push([sp, n])
    }
    return out
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

console.log(`\nnative vocabulary: ${nativeAdded.length}`)
for (const line of nativeAdded) console.log(`  ${line}`)
console.log(`\nsingleton admissions (count 1, round-trip >= ${SINGLETON_SIM}): ${singletons.length}`)
for (const m of singletons) console.log(`  ${m.khmer}  ->  ${m.latin}  [${(m.sources ?? []).join(', ')}]`)

if (dry) {
    console.log('\n(dry run — src/token-data.ts not written)')
} else {
    writeFileSync(new URL('../src/token-data.ts', import.meta.url), header)
    console.log('\nwrote src/token-data.ts')
}
