#!/usr/bin/env node
/**
 * Compile the trusted distillation dataset (scripts/sources/distill-verified.json).
 *
 * Trusted tiers — pairs a single attestation of which may merge into the
 * bundled dictionary (TRUSTED_STATIC in merge-tokens.mjs / corpus-tools.mjs):
 *
 *   corrected  — native-reader or user-approved second-AI spellings
 *   btn        — behindthename.com submitter transcriptions (kname-class
 *                name-list attestations, round-trip verified)
 *
 * Round-trip-only LLM spellings are deliberately NOT compiled here: they
 * stay in the raw source files' pairs (bucket "distilled", untrusted tag)
 * and need the standard min-2 attestations to merge.
 *
 * Bucket stays "distilled" for every row — trust applies to DICTIONARY
 * MERGING only, never to the eval in-domain composition.
 *
 * Usage: npm run build && node scripts/compile-trusted.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createDefaultTransliterator } from '../dist/index.js'
import { similarity } from './lib/corpus-tools.mjs'

const SOURCES = [
    ['sources/adoption-com.json', 'adoption.com'],
    ['sources/behindthename-khmer.json', 'behindthename'],
    ['sources/ai-common-names.json', 'ai-common'],
]
const SIM_THRESHOLD = 0.55
const KHMER_ONLY = /^[\u1780-\u17ff]+$/
const hasConsonant = (s) => [...s].some((ch) => ch >= '\u1780' && ch <= '\u17b2')
const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '')

const t = createDefaultTransliterator()
const shapeOk = (khmer) =>
    KHMER_ONLY.test(khmer) && khmer.length >= 2 && hasConsonant(khmer) && !khmer.endsWith('\u17d2')
const roundTripOk = (latin, khmer) => {
    const r = t.transliterate(khmer)
    return norm(r.value) === norm(latin)
        || r.candidates.some((c) => norm(c) === norm(latin))
        || similarity(r.value, latin) >= SIM_THRESHOLD
}

const pairs = []
const seen = new Set()
const tierCount = { corrected: 0, btn: 0 }
for (const [path] of SOURCES) {
    const data = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
    for (const e of data.entries) {
        const corrected = e.status === 'corrected'
        const attested = e.khmerSource === 'btn' && e.status === 'verified'
        if (!corrected && !attested) continue
        const spellings = [
            ...(e.khmer ? [{ khmer: e.khmer, isAlt: false }] : []),
            ...(e.altKhmer ?? []).map((k) => ({ khmer: k, isAlt: true })),
        ]
        for (const s of spellings) {
            if (seen.has(s.khmer) || !shapeOk(s.khmer)) continue
            // corrected primaries are final (round-trip can't veto);
            // everything else needs the round-trip gate
            if (!(corrected && !s.isAlt) && !roundTripOk(e.latin, s.khmer)) continue
            seen.add(s.khmer)
            pairs.push({ khmer: s.khmer, latin: e.latin, bucket: 'distilled' })
            tierCount[corrected ? 'corrected' : 'btn']++
        }
    }
}
pairs.sort((a, b) => a.latin.localeCompare(b.latin) || a.khmer.localeCompare(b.khmer))

const doc = {
    license: `compiled from adoption.com + behindthename.com + ai-common-names distillation (this repo): native-reader-corrected and user-approved second-AI spellings, plus behindthename submitter transcriptions that passed round-trip validation (see docs/distill-review.md and the three raw source files for provenance)`,
    origin: 'scripts/compile-trusted.mjs — trusted tier of the name-list distillation pipeline',
    pairs,
}
writeFileSync(fileURLToPath(new URL('./sources/distill-verified.json', import.meta.url)), JSON.stringify(doc, null, 1) + '\n')
console.log(`scripts/sources/distill-verified.json: ${pairs.length} trusted pairs `
    + `(corrected ${tierCount.corrected}, btn-attested ${tierCount.btn})`)
