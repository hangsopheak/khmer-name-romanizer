#!/usr/bin/env node
/**
 * K-fold cross-validated accuracy on the scraped corpus.
 *
 * The shipped eval (`eval:scraped`) scores the bundled dictionary on the
 * whole corpus at once — but that dictionary already contains tokens mined
 * from this corpus (>= 2 attestations merged), so those numbers are partly
 * in-sample. This script measures leakage-free generalization:
 *
 *   for each fold i of the in-domain rows:
 *     1. mine tokens from the OTHER folds only — same strict 1:1
 *        alignment and attestation counting as mine-tokens.mjs
 *     2. build the counterfactual dictionary the package would ship if
 *        fold i had never been scraped:
 *          base  = bundled dictionary minus keys whose corpus
 *                  attestations ALL come from fold i (they would never
 *                  have met the merge threshold)
 *          dict  = base + train-fold merges under the merge-tokens.mjs
 *                  policy (>= min attestations, trusted static lists
 *                  excepted, canonicals never touched)
 *     3. evaluate fold i with that dictionary
 *
 * Known limits, kept honest:
 *   - canonical-level leakage is stripped exactly; variant-level leakage
 *     (a test-fold spelling previously folded into an entry's variants)
 *     is not attributable and remains — top-5 is slightly optimistic
 *   - a removed key might independently be gold/roster-sourced — exact
 *     is then slightly pessimistic
 *
 * Usage: node scripts/eval-kfold.mjs [--k 5] [--min 2]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createDefaultTransliterator, createTransliterator, defaultTokenDict } from '../dist/index.js'

const args = process.argv.slice(2)
const value = (name, fallback) => {
    const i = args.indexOf(name)
    return i !== -1 ? Number(args[i + 1]) : fallback
}
const K = value('--k', 5)
const MIN = value('--min', 2)
const TRUSTED_STATIC = new Set(['static/kname'])

if (!Number.isInteger(K) || K < 2) {
    console.error('--k must be an integer >= 2')
    process.exit(1)
}

/* ------------------------------------------------------------------ */
/* metric helpers (mirrored from eval-scraped.mjs)                     */
/* ------------------------------------------------------------------ */
const levenshtein = (a, b) => {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
    for (let j = 0; j <= b.length; j++) dp[0][j] = j
    for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++)
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            )
    return dp[a.length][b.length]
}
const similarity = (a, b) => 1 - levenshtein(a.toLowerCase(), b.toLowerCase()) / Math.max(a.length, b.length)
const sortedNorm = (s) => s.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean).sort().join(' ')
const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '')

/* ------------------------------------------------------------------ */
/* corpus, hygiene filter, folds (deterministic assignment)            */
/* ------------------------------------------------------------------ */
const pairs = JSON.parse(readFileSync(new URL('./scraped-names.json', import.meta.url), 'utf8'))
const inDomain = pairs.filter((p) => ['cambodian', 'unknown', 'curated'].includes(p.bucket))

const BAD_LATIN_WORDS = new Set(['the', 'of', 'buddha', 'and'])
const evalRows = inDomain.filter((p) => {
    const words = p.latin.toLowerCase().split(/\s+/)
    if (words.some((w) => BAD_LATIN_WORDS.has(w))) return false
    if (p.latin.split(' ').length === 1 && p.khmer.split(' ').length >= 3) return false
    return true
})

// stable order -> fold = index % K: balanced, reproducible, no RNG
const ordered = [...evalRows].sort((a, b) => a.khmer.localeCompare(b.khmer) || a.latin.localeCompare(b.latin))
const foldOf = new Map(ordered.map((p, i) => [p, i % K]))

/* ------------------------------------------------------------------ */
/* mining, mirrored from mine-tokens.mjs                               */
/* ------------------------------------------------------------------ */
const countAttestations = (rows) => {
    /** khmer token -> latin spelling -> { count, sources } */
    const counts = new Map()
    const add = (kt, words, source) => {
        kt.forEach((k, i) => {
            const latin = words[i].charAt(0).toUpperCase() + words[i].slice(1).toLowerCase()
            if (!counts.has(k)) counts.set(k, new Map())
            const m = counts.get(k)
            const hit = m.get(latin) ?? { count: 0, sources: new Set() }
            hit.count += 1
            hit.sources.add(source)
            m.set(latin, hit)
        })
    }
    for (const p of rows) {
        const kt = p.khmer.split(' ')
        const lw = p.latin.split(' ')
        if (kt.length === lw.length) add(kt, lw, p.source ?? 'unknown')
        // en-wikipedia redirect spellings: variant material only
        for (const alt of p.altLatin ?? []) {
            const aw = alt.split(' ')
            if (aw.length === kt.length) add(kt, aw, 'wikipedia/redirects-en')
        }
    }
    return counts
}

const mineTokens = (rows) => {
    const counts = countAttestations(rows)
    const mined = []
    for (const [khmer, spellings] of counts) {
        const ranked = [...spellings.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
        const [canonical, canonicalHit] = ranked[0]
        mined.push({
            khmer,
            latin: canonical,
            count: canonicalHit.count,
            variants: Object.fromEntries(ranked.slice(1).map(([sp, hit]) => [sp, hit.count])),
            sources: [...new Set(ranked.flatMap(([, hit]) => [...hit.sources]))],
        })
    }
    return mined
}

/** total attestations per khmer token, for leakage detection */
const supportOf = (rows) => {
    const counts = countAttestations(rows)
    const support = new Map()
    for (const [khmer, spellings] of counts)
        support.set(khmer, [...spellings.values()].reduce((a, h) => a + h.count, 0))
    return support
}

/* ------------------------------------------------------------------ */
/* merge policy, mirrored from merge-tokens.mjs                        */
/* ------------------------------------------------------------------ */
const titleCase = (w) => w.split(' ').map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase()).join(' ')

const applyMergePolicy = (base, mined) => {
    const merged = { ...base }
    let added = 0
    let enriched = 0
    for (const m of mined) {
        const existing = merged[m.khmer]
        if (existing) {
            const known = () =>
                new Set([titleCase(existing.latin), ...Object.keys(existing.variants ?? {}).map(titleCase)])
            if (titleCase(existing.latin) !== m.latin && m.count >= MIN && !known().has(titleCase(m.latin))) {
                merged[m.khmer] = {
                    ...existing,
                    variants: { ...(existing.variants ?? {}), [m.latin]: m.count },
                }
                enriched++
            }
            const additions = Object.entries(m.variants ?? {}).filter(([sp, n]) => n >= MIN && !known().has(titleCase(sp)))
            if (additions.length) {
                merged[m.khmer] = {
                    ...existing,
                    variants: { ...(existing.variants ?? {}), ...Object.fromEntries(additions) },
                }
                enriched++
            }
            continue
        }
        if (m.count < MIN && !(m.count >= 1 && (m.sources ?? []).some((s) => TRUSTED_STATIC.has(s)))) continue
        const entry = { latin: m.latin, count: m.count }
        const variants = Object.fromEntries(Object.entries(m.variants ?? {}).filter(([, n]) => n >= MIN))
        if (Object.keys(variants).length) entry.variants = variants
        merged[m.khmer] = entry
        added++
    }
    return { dict: merged, added, enriched }
}

/* ------------------------------------------------------------------ */
/* evaluation                                                          */
/* ------------------------------------------------------------------ */
const evaluate = (rows, t) =>
    rows.map((p) => {
        const r = t.transliterate(p.khmer)
        const hit = r.value.toLowerCase() === p.latin.toLowerCase()
        return {
            bucket: p.bucket,
            hit,
            orderOnly: !hit && sortedNorm(r.value) === sortedNorm(p.latin),
            inTop5: r.candidates.some((c) => norm(c) === norm(p.latin)),
            sim: similarity(r.value, p.latin),
        }
    })

const report = (rows) => {
    if (!rows.length) return { n: 0 }
    const exact = rows.filter((r) => r.hit).length
    return {
        n: rows.length,
        exact,
        exactPct: +(100 * (exact / rows.length)).toFixed(1),
        anyOrder: rows.filter((r) => r.hit || r.orderOnly).length,
        top5: rows.filter((r) => r.inTop5).length,
        top5Pct: +(100 * (rows.filter((r) => r.inTop5).length / rows.length)).toFixed(1),
        meanSim: +(rows.reduce((a, r) => a + r.sim, 0) / rows.length).toFixed(3),
    }
}

/* ------------------------------------------------------------------ */
/* k-fold loop                                                         */
/* ------------------------------------------------------------------ */
const fullSupport = supportOf(inDomain) // what the shipped dictionary was mined from
const foldResults = []
const foldMeta = []

for (let f = 0; f < K; f++) {
    const testRows = evalRows.filter((p) => foldOf.get(p) === f)
    const trainRows = inDomain.filter((p) => foldOf.get(p) !== f)

    // strip keys whose corpus support comes entirely from this test fold
    const foldSupport = supportOf(testRows)
    const base = {}
    let removed = 0
    for (const [khmer, entry] of Object.entries(defaultTokenDict)) {
        const total = fullSupport.get(khmer) ?? 0
        const inFold = foldSupport.get(khmer) ?? 0
        if (total > 0 && inFold === total) {
            removed++
            continue
        }
        base[khmer] = entry
    }

    const { dict, added, enriched } = applyMergePolicy(base, mineTokens(trainRows))
    const t = createTransliterator({ tokenDict: dict })
    const results = evaluate(testRows, t)
    foldResults.push(...results)
    foldMeta.push({ fold: f, testRows: testRows.length, dictSize: Object.keys(dict).length, removed, addedByTrain: added, enrichedByTrain: enriched, perFold: report(results) })
}

/* ------------------------------------------------------------------ */
/* side-by-side with the shipped dictionary (partly in-sample)         */
/* ------------------------------------------------------------------ */
const shippedResults = evaluate(evalRows, createDefaultTransliterator())

const bucketize = (rows) => ({
    cambodian: report(rows.filter((r) => r.bucket === 'cambodian')),
    unknown: report(rows.filter((r) => r.bucket === 'unknown')),
    curated: report(rows.filter((r) => r.bucket === 'curated')),
    inDomain: report(rows),
})

const fmt = (label, r) =>
    r.n
        ? `${label.padEnd(34)} n=${String(r.n).padStart(4)}  exact ${String(r.exact).padStart(4)} (${r.exactPct}%)  top-5 ${String(r.top5).padStart(4)} (${r.top5Pct}%)  mean ${r.meanSim}`
        : `${label.padEnd(34)} n=0`

console.log(`K-fold cross-validation (k=${K}, min ${MIN} attestations) on scraped in-domain rows`)
console.log(`eval rows: ${evalRows.length} (of ${inDomain.length} in-domain), deterministic fold assignment\n`)

for (const m of foldMeta)
    console.log(`  fold ${m.fold}: test ${m.testRows}  dict ${m.dictSize} (-${m.removed} test-only, +${m.addedByTrain} train-mined, ~${m.enrichedByTrain} enriched)`)

const kfold = bucketize(foldResults)
const shipped = bucketize(shippedResults)
const perFold = foldMeta.map((m) => m.perFold).filter(Boolean)

console.log('\nSHIPPED dictionary (partly in-sample — what eval:scraped reports):')
console.log(fmt('  in-domain', shipped.inDomain))
console.log(fmt('  cambodian citizens', shipped.cambodian))
console.log(fmt('  unknown (ancient kings etc.)', shipped.unknown))

console.log(`\nK-FOLD (leakage-free counterfactual dictionary per fold):`)
console.log(fmt('  in-domain', kfold.inDomain))
console.log(fmt('  cambodian citizens', kfold.cambodian))
console.log(fmt('  unknown (ancient kings etc.)', kfold.unknown))

const foldRates = perFold.filter((r) => r.n).map((r) => r.exactPct)
if (foldRates.length)
    console.log(`  per-fold in-domain exact: ${foldRates.map((r) => r + '%').join('  ')}  (spread ${Math.min(...foldRates)}–${Math.max(...foldRates)}%)`)

writeFileSync(
    new URL('./eval-kfold-report.json', import.meta.url),
    JSON.stringify(
        {
            generated: new Date().toISOString(),
            k: K,
            min: MIN,
            evalRows: evalRows.length,
            folds: foldMeta,
            perFold,
            shipped,
            kfold,
        },
        null,
        1,
    ),
)
console.log('\nfull report -> scripts/eval-kfold-report.json')
