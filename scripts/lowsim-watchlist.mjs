#!/usr/bin/env node
/**
 * Low-similarity watchlist for the distillation sources.
 *
 * The user reviewed corrected rows but not every verified row: this lists
 * every distilled pair whose round-trip similarity sits below --threshold
 * (default 0.70), grouped by review tier so the unreviewed tiers stand
 * out:
 *
 *   llm-verified   — GLM spelling, round-trip gate only, NO human eye
 *   btn-verified   — behindthename submitter spelling, no human eye
 *   corrected      — reviewed (listed for completeness; a low sim there is
 *                    a romanizer gap, not a spelling doubt)
 *
 * These pairs still enter the corpus/dictionary per policy — this is a
 * review surface, not a gate.
 *
 * Usage: npm run build && node scripts/lowsim-watchlist.mjs [--threshold 0.7]
 */
import { readFileSync } from 'node:fs'
import { createDefaultTransliterator } from '../dist/index.js'
import { similarity } from './lib/corpus-tools.mjs'

const args = process.argv.slice(2)
const threshold = args.includes('--threshold')
    ? Number(args[args.indexOf('--threshold') + 1])
    : 0.7

const t = createDefaultTransliterator()
const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '')

const rows = []
for (const path of ['sources/adoption-com.json', 'sources/behindthename-khmer.json']) {
    const data = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
    for (const e of data.entries) {
        if (!['verified', 'corrected'].includes(e.status) || !e.khmer) continue
        const tier = e.status === 'corrected' ? 'corrected'
            : e.khmerSource === 'btn' ? 'btn-verified' : 'llm-verified'
        const spellings = [e.khmer, ...(e.altKhmer ?? [])]
        for (const khmer of spellings) {
            const r = t.transliterate(khmer)
            const exact = norm(r.value) === norm(e.latin)
            const inCandidates = r.candidates.some((c) => norm(c) === norm(e.latin))
            const sim = +similarity(r.value, e.latin).toFixed(3)
            if (!exact && !inCandidates && sim < threshold) {
                rows.push({ tier, latin: e.latin, khmer, got: r.value, sim, source: path.includes('adoption') ? 'adoption' : 'btn' })
            }
        }
    }
}
rows.sort((a, b) => a.sim - b.sim)
const byTier = rows.reduce((acc, r) => ((acc[r.tier] ??= []).push(r), acc), {})

for (const tier of ['llm-verified', 'btn-verified', 'corrected']) {
    const list = byTier[tier] ?? []
    console.log(`\n== ${tier} (${list.length}) ==`)
    for (const r of list) {
        console.log(`  ${String(r.sim).padEnd(6)} ${r.latin} [${r.source}]  ${r.khmer}  ->  "${r.got}"`)
    }
}
console.log(`\ntotal below ${threshold}: ${rows.length} (of all verified+corrected spellings)`)
