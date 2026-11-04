#!/usr/bin/env node
/**
 * Distill the pynini FST into bundled data (T4.2): readings for Khmer
 * name tokens the shipped dictionary does not cover.
 *
 * Scope (calibrated on dev evidence, 2026-11-01 — FST vs rules on the
 * 466 uncovered dev tokens):
 *
 *   cambodian citizens  FST 88/288 exact, 0.694 sim  vs rules 67, 0.667
 *   curated name lists  FST 17/24  exact, 0.885 sim  vs rules 12, 0.811
 *   regnal/unknown      FST 23/143 exact, 0.541 sim  vs rules 18, 0.552
 *
 * → distill cambodian + curated only (regnal is out of scope for this
 * package and the FST drops syllables there: ឥន្ទ្រវរ្ម័ន -> "Vrm").
 * A length guard drops any reading that lost syllables anyway.
 *
 * The map ships as src/fst-distill-data.ts and is injected by
 * createDefaultTransliterator as prior-grade `fstResults` — NOT as
 * dictionary canonicals: distilled readings never carry the reviewed
 * canonical's trust bonus, corpus attestations still outrank them, and
 * callers can still override per key.
 *
 * Source rows: scripts/dev-split.json (buckets cambodian+curated,
 * 1:1-aligned Khmer/Latin rows — same alignment as mine-tokens) plus the
 * Khmer-only tokens of scripts/sources/kh_parliament.json (official
 * parliamentary rosters; no official Latin exists for them, so they are
 * distill-scope only). The frozen test split is never read: tokens held
 * only by test rows are never distilled, and eval-holdout/eval-kfold
 * re-filter the bundled map by eligibility recomputed from their own
 * train rows, keeping the counterfactual arms leakage-free.
 *
 * Readings are deterministic, so evals never need Python: they filter
 * the bundled map; only this generator runs the FST.
 *
 * Usage: npm run build && node scripts/fst-distill.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defaultTokenDict, normalizeName, splitTokens, stripHonorifics } from '../dist/index.js'

/** Latin letters shorter than this share of the Khmer token dropped
 *  syllables (FST regnal garbage: ឥន្ទ្រវរ្ម័ន -> "Vrm"). */
const MIN_LENGTH_RATIO = 0.5

const dev = JSON.parse(readFileSync(new URL('./dev-split.json', import.meta.url), 'utf8'))
const rows = dev.filter((p) => ['cambodian', 'curated'].includes(p.bucket))

// 1:1 alignment (same rule as mine-tokens) — corpus Latin is used only
// to decide WHICH tokens are name tokens worth distilling; the readings
// themselves come from the FST alone.
const tokens = new Map() // khmer -> bucket (first seen)
for (const p of rows) {
    const kt = p.khmer.split(' ')
    const lw = p.latin.split(' ')
    if (kt.length !== lw.length) continue
    kt.forEach((k) => {
        if (!tokens.has(k)) tokens.set(k, p.bucket)
    })
}

// Official parliamentary rosters (scripts/sources/kh_parliament.json):
// Khmer-only names harvested from senate.gov.kh (live AJAX endpoint) and
// archived nac.org.kh rosters. The sites publish no official Latin, so
// these names never enter the corpus or the dictionary — but they are
// verified person-name tokens of high-lookup (political) names, so they
// join the DISTILL SCOPE and get prior-grade FST readings. Leakage-free
// by construction: counterfactual evals filter the bundled map by their
// own train rows (distillMapFor), so corpus-independent keys like these
// are inert in kfold/holdout and active only in the default chain.
try {
    const parliament = JSON.parse(readFileSync(new URL('./sources/kh_parliament.json', import.meta.url), 'utf8'))
    let added = 0
    for (const entry of parliament.members ?? []) {
        const bare = stripHonorifics(normalizeName(entry.name)).name
        for (const token of splitTokens(bare)) {
            if (!token || tokens.has(token)) continue
            tokens.set(token, 'parliament')
            added++
        }
    }
    console.log(`parliament roster tokens joining distill scope: ${added}`)
} catch {
    console.log('no scripts/sources/kh_parliament.json — parliament distill scope skipped')
}

const uncovered = [...tokens.keys()].filter((k) => !defaultTokenDict[k])

const result = spawnSync(
    process.env.KHMER_TRANLIT_PYTHON || 'python3',
    [fileURLToPath(new URL('./khmer_to_latin.py', import.meta.url))],
    { input: JSON.stringify(uncovered), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
)
if (result.status !== 0 || !result.stdout) {
    console.error(result.stderr?.trim() || 'fst bridge failed — see scripts/khmer_to_latin.py header for install')
    process.exit(1)
}
const readings = JSON.parse(result.stdout)

const distill = {}
const stats = { considered: uncovered.length, kept: 0, empty: 0, droppedSyllables: 0, nonLatin: 0 }
uncovered.forEach((khmer, i) => {
    const raw = readings[i]
    if (!raw) {
        stats.empty++
        return
    }
    const latin = raw.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
    const letters = latin.replace(/[^A-Za-z]/g, '').length
    if (letters === 0 || /[^A-Za-z\s'-]/.test(latin)) {
        stats.nonLatin++
        return
    }
    if (letters < Math.ceil((khmer.length * MIN_LENGTH_RATIO)) && khmer.length > 2) {
        stats.droppedSyllables++
        return
    }
    distill[khmer] = latin
    stats.kept++
})

const OUT = fileURLToPath(new URL('../src/fst-distill-data.ts', import.meta.url))
const entries = Object.entries(distill)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join('\n')
writeFileSync(
    OUT,
    `/**
 * Generated FST distillation — DO NOT EDIT BY HAND.
 * Prior-grade readings for Khmer name tokens the bundled dictionary does
 * not cover; injected as fstResults by createDefaultTransliterator.
 * Source rows: dev split (cambodian + curated buckets) plus the official
 * parliamentary rosters (scripts/sources/kh_parliament.json, Khmer-only
 * tokens) — never the frozen test split. Regenerate with the pynini
 * packages installed:
 *
 *   npm run build && node scripts/fst-distill.mjs
 */

export const defaultFstDistill: Record<string, string> = {
${entries}
}
`,
)
console.log(
    `fst-distill: ${stats.kept}/${stats.considered} tokens distilled ` +
        `(empty ${stats.empty}, dropped syllables ${stats.droppedSyllables}, non-latin ${stats.nonLatin}) -> ${OUT}`,
)
