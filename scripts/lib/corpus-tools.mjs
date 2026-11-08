/**
 * Shared corpus tooling for the eval scripts: hygiene filtering, token
 * mining (mirrors mine-tokens.mjs), the dictionary merge policy (mirrors
 * merge-tokens.mjs), and string metrics.
 *
 * Kept in one module so eval-kfold.mjs (per-fold counterfactuals) and
 * eval-holdout.mjs (frozen-split counterfactual) stay in lockstep with the
 * production mining pipeline.
 */

export const IN_DOMAIN_BUCKETS = ['cambodian', 'unknown', 'curated']
export const BAD_LATIN_WORDS = new Set(['the', 'of', 'buddha', 'and'])
export const TRUSTED_STATIC = new Set(['static/kname'])
export const MERGE_MIN = 2

export const isInDomain = (p) => IN_DOMAIN_BUCKETS.includes(p.bucket)

/** Mirrors the eval-scraped.mjs hygiene filter (non-name Latin, shape mismatch). */
export const passesHygiene = (p) => {
    const words = p.latin.toLowerCase().split(/\s+/)
    if (words.some((w) => BAD_LATIN_WORDS.has(w))) return false
    if (p.latin.split(' ').length === 1 && p.khmer.split(' ').length >= 3) return false
    return true
}

export const titleCase = (w) =>
    w.split(' ').map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase()).join(' ')

/* ------------------------------------------------------------------ */
/* shape matchability, intervals, strict matching, miss taxonomy       */
/* ------------------------------------------------------------------ */

import { normalizeName, splitTokens, stripHonorifics } from '../../dist/index.js'

/** Token count of the Khmer side as the engine sees it (normalized,
 *  honorifics stripped, space-split). */
export const khmerTokenCount = (khmer) =>
    splitTokens(stripHonorifics(normalizeName(khmer)).name).length

/**
 * A row is shape-matchable when the expected Latin word count equals the
 * engine's Khmer token count — the only shape the candidate composer can
 * ever produce (one word per token). Mismatched rows (~18% of in-domain
 * corpus: corpus short-forms like គឹមហួន -> "Kim", reversed alignments,
 * title fragments) are structurally unreachable, so top-5 rates counted
 * over matchable rows alone are the fair recall view.
 */
export const isShapeMatchable = (p) =>
    khmerTokenCount(p.khmer) === p.latin.split(/\s+/).filter(Boolean).length

/** Strict, word-aligned comparison: case-insensitive full-string equality
 *  after whitespace collapse — "Sopanha" does NOT match "So Panha" (the
 *  lenient `norm` does). The honest view for passport-style output. */
export const strictEqual = (a, b) =>
    a.toLowerCase().replace(/\s+/g, ' ').trim() === b.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Wilson score interval (95%) for a binomial proportion — small-n rows
 * (the 108-row lockbox) must not be read at face value.
 */
export const wilson = (successes, n, z = 1.96) => {
    if (!n) return { pct: 0, low: 0, high: 0 }
    const p = successes / n
    const denom = 1 + (z * z) / n
    const centre = p + (z * z) / (2 * n)
    const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
    return {
        pct: +(100 * p).toFixed(1),
        low: +(100 * Math.max(0, (centre - spread) / denom)).toFixed(1),
        high: +(100 * Math.min(1, (centre + spread) / denom)).toFixed(1),
    }
}

/**
 * Classify a miss (value != expected, not in top-5) by its cause — the
 * automated miss autopsy:
 *
 *   order-flip          correct words, Khmer vs Western order
 *   unmatchable-shape   expected word count differs from token count —
 *                       no candidate can ever equal it
 *   vocab-gap           some differing expected word is in NO option
 *                       list of its token — the engine does not know the
 *                       spelling (dictionary/FST/rules all miss)
 *   option-not-chosen   every differing word IS an option of its token —
 *                       the spelling is known but ranking/composition did
 *                       not surface it (includes one-to-many walls)
 */
export const classifyMiss = ({ got, tokens, pair }) => {
    if (sortedNorm(got) === sortedNorm(pair.latin)) return 'order-flip'
    if (!isShapeMatchable(pair)) return 'unmatchable-shape'
    const gw = got.split(' ')
    const ww = pair.latin.split(/\s+/).filter(Boolean)
    // shape-matchable ⇒ token i renders word i
    let allKnown = true
    for (let i = 0; i < tokens.length; i++) {
        if (norm(gw[i] ?? '') === norm(ww[i] ?? '')) continue
        const options = [tokens[i].latin, ...tokens[i].alternatives].map(norm)
        if (!options.includes(norm(ww[i] ?? ''))) allKnown = false
    }
    return allKnown ? 'option-not-chosen' : 'vocab-gap'
}

/* ------------------------------------------------------------------ */
/* metrics                                                             */
/* ------------------------------------------------------------------ */
export const levenshtein = (a, b) => {
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

export const similarity = (a, b) =>
    1 - levenshtein(a.toLowerCase(), b.toLowerCase()) / Math.max(a.length, b.length)

export const sortedNorm = (s) =>
    s.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean).sort().join(' ')

export const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '')

/* ------------------------------------------------------------------ */
/* mining (mirrors mine-tokens.mjs)                                    */
/* ------------------------------------------------------------------ */

/** khmer token -> latin spelling -> { count, sources } */
export const countAttestations = (rows) => {
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

export const mineTokens = (rows) => {
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
export const supportOf = (rows) => {
    const counts = countAttestations(rows)
    const support = new Map()
    for (const [khmer, spellings] of counts)
        support.set(khmer, [...spellings.values()].reduce((a, h) => a + h.count, 0))
    return support
}

/* ------------------------------------------------------------------ */
/* merge policy (mirrors merge-tokens.mjs)                             */
/* ------------------------------------------------------------------ */
export const applyMergePolicy = (base, mined, min = MERGE_MIN) => {
    const merged = { ...base }
    let added = 0
    let enriched = 0
    for (const m of mined) {
        const existing = merged[m.khmer]
        if (existing) {
            const known = () =>
                new Set([titleCase(existing.latin), ...Object.keys(existing.variants ?? {}).map(titleCase)])
            if (titleCase(existing.latin) !== m.latin && m.count >= min && !known().has(titleCase(m.latin))) {
                merged[m.khmer] = {
                    ...existing,
                    variants: { ...(existing.variants ?? {}), [m.latin]: m.count },
                }
                enriched++
            }
            const additions = Object.entries(m.variants ?? {}).filter(([sp, n]) => n >= min && !known().has(titleCase(sp)))
            if (additions.length) {
                merged[m.khmer] = {
                    ...existing,
                    variants: { ...(existing.variants ?? {}), ...Object.fromEntries(additions) },
                }
                enriched++
            }
            continue
        }
        if (m.count < min && !(m.count >= 1 && (m.sources ?? []).some((s) => TRUSTED_STATIC.has(s)))) continue
        const entry = { latin: m.latin, count: m.count }
        const variants = Object.fromEntries(Object.entries(m.variants ?? {}).filter(([, n]) => n >= min))
        if (Object.keys(variants).length) entry.variants = variants
        merged[m.khmer] = entry
        added++
    }
    return { dict: merged, added, enriched }
}

/**
 * The counterfactual dictionary the package would ship if the given test
 * rows had never been scraped:
 *   1. strip bundled keys whose corpus support comes ENTIRELY from test rows
 *      (they would never have met the merge threshold)
 *   2. re-merge everything minable from the train rows
 *
 * Known limits, kept honest (same as eval-kfold):
 *   - canonical-level leakage is stripped exactly; variant-level leakage is
 *     not attributable and remains (top-5 slightly optimistic)
 *   - a removed key might independently be gold/roster-sourced (exact then
 *     slightly pessimistic)
 */
export const counterfactualDict = ({ bundled, trainRows, testRows, fullSupport, min = MERGE_MIN }) => {
    const testSupport = supportOf(testRows)
    const base = {}
    let removed = 0
    for (const [khmer, entry] of Object.entries(bundled)) {
        const total = fullSupport.get(khmer) ?? 0
        const inTest = testSupport.get(khmer) ?? 0
        if (total > 0 && inTest === total) {
            removed++
            continue
        }
        base[khmer] = entry
    }
    const { dict, added, enriched } = applyMergePolicy(base, mineTokens(trainRows), min)
    return { dict, removed, added, enriched }
}

/**
 * Khmer tokens eligible for the bundled FST distillation, recomputed from
 * the caller's OWN train rows (1:1-aligned cambodian+curated rows — the
 * same scope scripts/fst-distill.mjs distilled from). Counterfactual
 * evals filter the bundled map down to these keys so a fold's or the
 * frozen split's rows can never ride along as distilled readings.
 */
export const distillCandidates = (rows) => {
    const tokens = new Set()
    for (const p of rows) {
        if (!['cambodian', 'curated'].includes(p.bucket)) continue
        const kt = p.khmer.split(' ')
        const lw = p.latin.split(' ')
        if (kt.length !== lw.length) continue
        for (const k of kt) tokens.add(k)
    }
    return tokens
}

/** Filter a bundled distill map to keys eligible for the given train rows
 *  and not already covered by the caller's (counterfactual) dictionary. */
export const distillMapFor = (bundledMap, trainRows, dict) => {
    const eligible = distillCandidates(trainRows)
    const out = new Map()
    for (const [k, v] of Object.entries(bundledMap)) {
        if (eligible.has(k) && !dict[k]) out.set(k, v)
    }
    return out
}
