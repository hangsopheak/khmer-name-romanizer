#!/usr/bin/env node
/**
 * Round-trip validator for the name-list distillation sources.
 *
 * For every entry that carries a Khmer spelling (LLM-distilled or
 * site-attested) in adoption-com.json / behindthename-khmer.json /
 * ai-common-names.json:
 *
 *   1. shape check — single Khmer-only token with at least one consonant
 *      and no dangling trailing coeng (a common submitter typo)
 *   2. round-trip — the bundled romanizer must land near the site's
 *      Latin: similarity(value, latin) >= 0.55, or the exact spelling is
 *      among the candidate alternatives. A miss is not automatically a
 *      bad Khmer spelling — it can be a romanizer gap this data will
 *      fix — so misses are FLAGGED for human review, never dropped.
 *   3. corpus cross-ref — whether scraped-names.json already knows the
 *      Khmer key (agreement or variant attestation)
 *
 * Statuses: pending -> distilled/attested (distill_fill.py / scrape_btn.py)
 *           -> verified | flagged (this script)
 *
 * Materializes the static-source contract: `pairs` (khmer/latin/bucket
 * "distilled") from verified entries only, one row per spelling (primary
 * + alts). Also writes the human-review report docs/distill-review.md.
 *
 * Usage: npm run build && node scripts/validate-distilled.mjs
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

// existing corpus, for cross-reference
const corpusKey = (khmer) => khmer.replace(/\s+/g, '')
const corpus = new Map(
    JSON.parse(readFileSync(new URL('./scraped-names.json', import.meta.url), 'utf8'))
        .map((p) => [corpusKey(p.khmer), p]),
)

/** All spellings of an entry: [{khmer, isAlt}] */
const spellingsOf = (e) => [
    ...(e.khmer ? [{ khmer: e.khmer, isAlt: false }] : []),
    ...(e.altKhmer ?? []).map((k) => ({ khmer: k, isAlt: true })),
]

const validate = (latin, khmer) => {
    if (!KHMER_ONLY.test(khmer)) return { verdict: 'flagged', reason: 'shape: non-Khmer characters' }
    if (khmer.length < 2) return { verdict: 'flagged', reason: 'shape: too short' }
    if (!hasConsonant(khmer)) return { verdict: 'flagged', reason: 'shape: no consonant' }
    if (khmer.endsWith('\u17d2')) return { verdict: 'flagged', reason: 'shape: dangling trailing coeng (submitter typo?)' }
    const r = t.transliterate(khmer)
    const sim = +similarity(r.value, latin).toFixed(3)
    const inCandidates = r.candidates.some((c) => norm(c) === norm(latin))
    const exact = norm(r.value) === norm(latin)
    if (exact || inCandidates || sim >= SIM_THRESHOLD) {
        return { verdict: 'verified', roundtrip: r.value, sim, inCandidates, exact }
    }
    return { verdict: 'flagged', reason: `round-trip: got "${r.value}" (sim ${sim})`, roundtrip: r.value, sim }
}

const rows = [] // flattened per-spelling rows for the report
const summary = []

for (const [path, label] of SOURCES) {
    const data = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
    const counts = { entries: data.entries.length, verified: 0, flagged: 0, pending: 0, corrected: 0, spellingsVerified: 0 }

    for (const e of data.entries) {
        if (e.status === 'dropped') {
            // manual veto during review: kept in the file for provenance,
            // never validated, never reaches pairs
            counts.dropped = (counts.dropped ?? 0) + 1
            continue
        }
        if (!e.khmer) {
            counts.pending++
            rows.push({ source: label, latin: e.latin, khmer: null, entry: e, status: 'pending' })
            continue
        }
        // a native-reader correction (apply_corrections.py) is final: the
        // round-trip check is recorded for the report but can never flag it
        const wasCorrected = e.status === 'corrected'
        e.status = ['attested', 'corrected'].includes(e.status) ? e.status : 'distilled'
        const results = spellingsOf(e).map((s) => ({ ...s, ...validate(e.latin, s.khmer) }))
        // primary spelling decides the entry verdict; alt spellings are
        // flagged individually and excluded from pairs, but the entry's
        // verified status stands on its primary spelling
        const bad = results.filter((r) => r.verdict === 'flagged')
        const primary = results[0]
        if (wasCorrected) {
            e.status = 'corrected'
            delete e.flagReason
            counts.corrected++
        } else if (primary.verdict === 'verified') {
            e.status = 'verified'
            if (bad.length) e.flagReason = `alt-only: ${bad.map((b) => `${b.khmer}: ${b.reason}`).join('; ')}`
            else delete e.flagReason
            counts.verified++
        } else {
            e.status = 'flagged'
            e.flagReason = bad.map((b) => `${b.isAlt ? 'alt ' : ''}${b.khmer}: ${b.reason}`).join('; ')
            counts.flagged++
        }
        for (const r of results) {
            if (r.verdict === 'verified') counts.spellingsVerified++
            const prior = corpus.get(corpusKey(r.khmer))
            rows.push({
                source: label,
                latin: e.latin,
                khmer: r.khmer,
                isAlt: r.isAlt,
                gender: e.gender,
                meaning: e.meaning,
                khmerSource: e.khmerSource,
                status: e.status,
                roundtrip: r.roundtrip,
                sim: r.sim,
                reason: r.reason,
                note: e.note,
                corpus: prior ? (norm(prior.latin) === norm(e.latin) ? `= ${prior.latin}` : `≠ ${prior.latin}`) : null,
            })
        }
    }

    // materialize pairs: one row per verified spelling, bucket "distilled".
    // CORRECTED entries are final by native-reader/second-AI review: the
    // primary spelling enters pairs regardless of round-trip (shape is
    // still required), and shape-passing alts join it. Verified entries
    // keep the full round-trip gate.
    const pairs = []
    const seen = new Set()
    for (const e of data.entries) {
        if (!['verified', 'corrected'].includes(e.status)) continue
        for (const s of spellingsOf(e)) {
            if (seen.has(s.khmer)) continue
            const v = validate(e.latin, s.khmer)
            const corrected = e.status === 'corrected'
            const primary = !s.isAlt
            const admitted = corrected
                ? (primary || !v.reason?.startsWith('shape:'))
                : v.verdict === 'verified'
            if (!admitted) continue
            seen.add(s.khmer)
            pairs.push({ khmer: s.khmer, latin: e.latin, bucket: 'distilled' })
        }
    }
    pairs.sort((a, b) => a.latin.localeCompare(b.latin) || a.khmer.localeCompare(b.khmer))
    data.pairs = pairs
    writeFileSync(fileURLToPath(new URL(path, import.meta.url)), JSON.stringify(data, null, 1) + '\n')
    summary.push({ label, ...counts, pairs: pairs.length })
}

/* ---------------- report: docs/distill-review.md ---------------- */
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|')
const flagged = rows.filter((r) => r.status === 'flagged')
const pending = rows.filter((r) => r.status === 'pending' && !r.khmer)
const verified = rows.filter((r) => r.status === 'verified')
const corrected = rows.filter((r) => r.status === 'corrected')
const dropped = summary.reduce((n, s) => n + (s.dropped ?? 0), 0)

const table = (rs) => rs.map((r, i) =>
    `| ${i + 1} | ${esc(r.latin)} | ${esc(r.khmer)}${r.isAlt ? ' (alt)' : ''} | ${esc(r.gender)} | ${esc(r.roundtrip)} | ${esc(r.sim)} | ${esc(r.reason ?? '')} | ${esc(r.corpus)} | ${esc(r.note ?? '')} |`,
).join('\n')

const md = `# Distill review — 2026-11-08

Round-trip = the bundled romanizer's reading of the Khmer with the CURRENT dictionary
(a miss often means a romanizer gap this data will fix, not a bad spelling — you judge).
"corpus" = the scraped corpus already knows the Khmer key (= agreement, ≠ variant).

## How to review

1. Fix any Khmer spelling you disagree with directly in \`scripts/sources/adoption-com.json\`,
   \`scripts/sources/behindthename-khmer.json\` or \`scripts/sources/ai-common-names.json\`
   (the \`entries\` array — set \`khmer\`, keep or clear \`note\`). Leave a \`note\` if a
   spelling is a real variant.
2. Drop junk entries by setting \`status\`: \`"dropped"\` (they stay in the file for provenance
   but never reach \`pairs\`).
3. Re-run \`npm run validate:distilled\` — this regenerates the report and \`pairs\`
   (only \`verified\` rows materialize).
4. When you are happy: \`npm run scrape:names && npm run split:corpus && npm run mine:tokens\`,
   review \`scripts/mined-tokens.json\`, then \`npm run merge:tokens\` and the evals.

## Summary

| source | entries | verified | corrected | flagged | pending | dropped | verified spellings | pairs |
|---|---|---|---|---|---|---|---|---|
${summary.map((s) => `| ${s.label} | ${s.entries} | ${s.verified} | ${s.corrected} | ${s.flagged} | ${s.pending} | ${s.dropped ?? 0} | ${s.spellingsVerified} | ${s.pairs} |`).join('\n')}

## Corrected by native reader (${corrected.length}) — final

| # | Latin | Khmer | G | Round-trip | Sim | Reason | Corpus | Note |
|---|---|---|---|---|---|---|---|---|
${table(corrected)}

## Flagged — needs your call (${flagged.length})

| # | Latin | Khmer | G | Round-trip | Sim | Reason | Corpus | Note |
|---|---|---|---|---|---|---|---|---|
${table(flagged)}

## Verified — ready for integration (${verified.length})

| # | Latin | Khmer | G | Round-trip | Sim | Reason | Corpus | Note |
|---|---|---|---|---|---|---|---|---|
${table(verified)}

## Pending distillation (${pending.length})

${pending.length ? `| # | Latin | G | Source |\n|---|---|---|---|\n${pending.map((r, i) => `| ${i + 1} | ${esc(r.latin)} | ${esc(r.gender)} | ${esc(r.source)} |`).join('\n')}` : '_none — all entries distilled_'}
`
writeFileSync(fileURLToPath(new URL('../docs/distill-review.md', import.meta.url)), md)

for (const s of summary) {
    console.log(`${s.label}: ${s.verified} verified, ${s.corrected} corrected, ${s.flagged} flagged, ${s.pending} pending -> ${s.pairs} pairs`)
}
console.log(`report: docs/distill-review.md (corrected ${corrected.length}, flagged ${flagged.length}, verified ${verified.length}, pending ${pending.length}${dropped ? `, dropped ${dropped}` : ''})`)
