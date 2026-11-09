/**
 * Shared corpus tooling for the eval scripts: hygiene filtering, token
 * mining (mirrors mine-tokens.mjs), the dictionary merge policy (mirrors
 * merge-tokens.mjs), and string metrics.
 *
 * Kept in one module so eval-kfold.mjs (per-fold counterfactuals) and
 * eval-holdout.mjs (frozen-split counterfactual) stay in lockstep with the
 * production mining pipeline.
 */

import { readFileSync } from 'node:fs'

export const IN_DOMAIN_BUCKETS = ['cambodian', 'unknown', 'curated']
export const BAD_LATIN_WORDS = new Set(['the', 'of', 'buddha', 'and'])
export const TRUSTED_STATIC = new Set(['static/kname', 'static/manual', 'static/distill-verified'])
export const MERGE_MIN = 2

export const isInDomain = (p) => IN_DOMAIN_BUCKETS.includes(p.bucket)

/** Buckets the production miner learns from (mirrors mine-tokens.mjs). */
export const TRAIN_BUCKETS = [...IN_DOMAIN_BUCKETS, 'distilled']
export const isTrainable = (p) => TRAIN_BUCKETS.includes(p.bucket)

/**
 * Sources written by the same person who pins dictionary canonicals
 * (native-reader correction rounds). Their labels are not independent of
 * the dictionary, so they are TRAINING data only: never scored by an eval,
 * never placed in the lockbox, and never enough on their own to keep a
 * key the test rows also attest (see counterfactualDict).
 */
export const HAND_AUTHORED_SOURCES = new Set(['static/manual'])
export const isHandAuthored = (p) => HAND_AUTHORED_SOURCES.has(p.source)

/**
 * Blind native vocabulary (scripts/sources/native-vocab.json): words picked
 * from an independent roster and spelled without seeing any engine guess or
 * corpus answer. Independent of every eval row, so — like the verified gold
 * base — the counterfactual never strips these keys.
 */
export const loadNativeVocab = () => {
    try {
        const doc = JSON.parse(readFileSync(new URL('../sources/native-vocab.json', import.meta.url), 'utf8'))
        return doc.rounds.flatMap((r) => r.entries).filter((e) => e.spellings?.length)
    } catch {
        return []
    }
}
export const NATIVE_VOCAB_KEYS = new Set(loadNativeVocab().map((e) => e.khmer))

/** Mirrors the eval-scraped.mjs hygiene filter (non-name Latin, shape mismatch). */
export const passesHygiene = (p) => {
    const words = p.latin.toLowerCase().split(/\s+/)
    if (words.some((w) => BAD_LATIN_WORDS.has(w))) return false
    if (p.latin.split(' ').length === 1 && p.khmer.split(' ').length >= 3) return false
    return true
}

/** Rows an eval may score: in-domain, hygiene-clean, not hand-authored. */
export const isEvalRow = (p) => isInDomain(p) && passesHygiene(p) && !isHandAuthored(p)

export const titleCase = (w) =>
    w.split(' ').map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase()).join(' ')

/* ------------------------------------------------------------------ */
/* shape matchability, intervals, strict matching, miss taxonomy       */
/* ------------------------------------------------------------------ */

import { normalizeName, romanizeKhmer, splitTokens, stripHonorifics } from '../../dist/index.js'

/** Token count of the Khmer side as the engine sees it (normalized,
 *  honorifics stripped, space-split). */
export const khmerTokenCount = (khmer) =>
    splitTokens(stripHonorifics(normalizeName(khmer)).name).length

/**
 * Pair layouts the corpus exhibits, and what the engine can produce:
 *
 *   kt == lw                     straight 1:1 (token i renders word i)
 *   0 < lw - kt <= 2  tail-run   Khmer spellings often run syllables
 *                                together; the standard romanization
 *                                splits them (រស់ សេរីសុទ្ធា -> "Ros
 *                                Serey Sothea", ប៉ុលពត -> "Pol Pot").
 *                                Prefix tokens zip 1:1; the LAST token
 *                                absorbs the remaining words. Multi-word
 *                                dictionary variants carry internal
 *                                spaces that pass straight into
 *                                candidates, so the engine CAN produce
 *                                these — given tail-run variants exist.
 *   kt > lw                      Latin side truncated/junk — unreachable.
 *
 * The tail-run absorb cap is 2: longer runs observed in the corpus are
 * Western-order or middle-name artifacts, not the solid-given-name
 * pattern the feature targets.
 */
export const alignRow = (kt, lw) => {
    if (kt === lw) return { runon: false, prefix: kt - 1 }
    const absorb = lw - kt
    if (absorb > 0 && absorb <= 2) return { runon: true, prefix: kt - 2 }
    return null
}

/* ------------------------------------------------------------------ */
/* person grouping: the unit every split and fold must respect         */
/* ------------------------------------------------------------------ */

export const fnv1a = (s) => {
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
        h ^= s.codePointAt(i)
        h = Math.imul(h, 0x01000193)
    }
    return h >>> 0
}

/** The name as the engine sees it: normalized, honorifics stripped,
 *  spaces removed — អ្នកអង្គម្ចាស់ នរោត្តម កន្តុល == នរោត្តម កន្តុល. */
export const nameKey = (khmer) => splitTokens(stripHonorifics(normalizeName(khmer)).name).join('')

/**
 * Groups corpus rows that describe the same name or person, so a split
 * can never put one spelling of a person in train and another in test.
 * Rows are linked when they share any of:
 *   - nameKey (same Khmer name after normalization/honorific stripping)
 *   - Wikidata QID (same person, different Khmer spelling: ជូ ស៊ិនទី / ជូ ស៊ីនទី)
 *   - a multi-word Latin name (ញ៉ែម / ព្រំ ញ៉ែម, both "Prom Nhem")
 * Returns Map<row, groupId>; groupId is the smallest nameKey in the group,
 * so it only changes when the group's membership changes.
 */
export const groupRows = (rows) => {
    const parent = rows.map((_, i) => i)
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
    const firstSeen = new Map()
    const link = (key, i) => {
        if (!firstSeen.has(key)) return firstSeen.set(key, i)
        const a = find(i), b = find(firstSeen.get(key))
        if (a !== b) parent[a] = b
    }
    const keys = rows.map((r) => nameKey(r.khmer))
    rows.forEach((r, i) => {
        link(`k:${keys[i]}`, i)
        if (/^Q\d+$/.test(r.qid ?? '')) link(`q:${r.qid}`, i)
        const latin = r.latin.trim().toLowerCase().replace(/\s+/g, ' ')
        if (latin.includes(' ')) link(`l:${latin}`, i)
    })
    const label = new Map()
    rows.forEach((_, i) => {
        const root = find(i)
        const cur = label.get(root)
        if (cur === undefined || keys[i] < cur) label.set(root, keys[i])
    })
    return new Map(rows.map((r, i) => [r, label.get(find(i))]))
}

export const isShapeMatchable = (p) =>
    alignRow(khmerTokenCount(p.khmer), p.latin.split(/\s+/).filter(Boolean).length) !== null

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
 *                       spelling (dictionary/rules all miss)
 *   option-not-chosen   every differing word IS an option of its token —
 *                       the spelling is known but ranking/composition did
 *                       not surface it (includes one-to-many walls)
 */
export const classifyMiss = ({ got, tokens, pair }) => {
    if (sortedNorm(got) === sortedNorm(pair.latin)) return 'order-flip'
    if (!isShapeMatchable(pair)) return 'unmatchable-shape'
    const a = alignRow(tokens.length, pair.latin.split(/\s+/).filter(Boolean).length)
        ?? { runon: false, prefix: tokens.length - 1 }
    const gw = got.split(' ')
    // alignment like the miner: prefix tokens render word i; a run-on
    // tail token renders the whole absorbed run (compared space-
    // insensitive, since candidates may or may not carry the split).
    const ww = pair.latin.split(/\s+/).filter(Boolean)
    let allKnown = true
    for (let i = 0; i < tokens.length; i++) {
        const expWords = i <= a.prefix ? [ww[i]] : ww.slice(a.prefix + 1)
        const gotPiece = gw.length === tokens.length ? gw[i] : expWords.join(' ')
        if (norm(gotPiece ?? '') === norm(expWords.join(''))) continue
        const options = [tokens[i].latin, ...tokens[i].alternatives].map(norm)
        if (!options.includes(norm(expWords.join('')))) allKnown = false
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
    // Capitalize each word of a (possibly multi-word) romanization.
    const cap = (s) => s.split(' ').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
    const add = (kt, lw, source) => {
        // alignment: prefix tokens zip 1:1, tail token absorbs the run-on
        const a = alignRow(kt.length, lw.length)
        if (!a) return
        for (let i = 0; i <= a.prefix; i++) {
            addHit(kt[i], lw[i], source)
        }
        if (a.runon) addHit(kt[a.prefix + 1], lw.slice(a.prefix + 1).join(' '), source, true)
    }
    // Tail-run spellings are marked separately: their evidence is the
    // in-row alignment, not corpus multiplicity, so the merge policy
    // treats them as their own review-gated class.
    const addHit = (k, w, source, tail) => {
        const latin = cap(w)
        if (!counts.has(k)) counts.set(k, new Map())
        const m = counts.get(k)
        const hit = m.get(latin) ?? { count: 0, sources: new Set(), tail: false }
        hit.count += 1
        hit.sources.add(source)
        if (tail) hit.tail = true
        m.set(latin, hit)
    }
    const cleaned = (p) => splitTokens(stripHonorifics(normalizeName(p.khmer)).name)
    for (const p of rows) {
        const kt = cleaned(p)
        const lw = p.latin.split(/\s+/).filter(Boolean)
        if (alignRow(kt.length, lw.length)) add(kt, lw, p.source ?? 'unknown')
        // en-wikipedia redirect spellings: variant material only
        for (const alt of p.altLatin ?? []) {
            const aw = alt.split(/\s+/).filter(Boolean)
            if (alignRow(kt.length, aw.length)) add(kt, aw, 'wikipedia/redirects-en')
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
        // tail-run spellings: evidence class of their own (in-row
        // alignment instead of corpus multiplicity)
        const Tail = ([, hit]) => hit.tail
        const variants = Object.fromEntries(ranked.filter((sp) => !Tail(sp)).slice(1).map(([sp, hit]) => [sp, hit.count]))
        const tailVariants = Object.fromEntries(ranked.filter(Tail).map(([sp, hit]) => [sp, hit.count]))
        mined.push({
            khmer,
            latin: canonical,
            count: canonicalHit.count,
            canonicalTail: canonicalHit.tail || undefined,
            variants,
            tailVariants: Object.keys(tailVariants).length ? tailVariants : undefined,
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
/** Mechanical spelling guard (mirrors merge-tokens.mjs). */
export const isJunkSpelling = (sp) =>
    /^(of|the|and)(\s|$)/i.test(sp) || /\b[A-Za-z]\.(\s|$)/.test(sp)

/**
 * Singleton gate: a NEW token attested once is admitted only when its
 * spelling is plausibly a romanization of the Khmer — the rule engine's
 * reading is at least SINGLETON_SIM similar. One-shot label
 * mis-alignments (ខាន់ -> "Jessa") fail it; regular romanizations pass.
 */
export const SINGLETON_SIM = 0.55 // same round-trip bar as compile-trusted.mjs
export const singletonOk = (khmer, latin, threshold = SINGLETON_SIM) =>
    !isJunkSpelling(latin) && similarity(romanizeKhmer(khmer), latin) >= threshold

/** Sources whose one-shot spellings are not trusted as singletons. */
// sigpwned's Khmer side is machine-translated from Latin surnames — not an
// attestation of a real person's spelling (it produced ចន្ទ -> "Chhan")
export const SINGLETON_SKIP_SOURCES = new Set(['static/sigpwned'])

export const applyMergePolicy = (base, mined, min = MERGE_MIN, { singletons = true } = {}) => {
    // Tail-run spellings enter at min 1 (blocklist-gated in the production
    // merge; the eval counterfactuals mirror the mechanics, not the list).
    const TAIL_MIN = 1
    const merged = { ...base }
    let added = 0
    let enriched = 0
    for (const m of mined) {
        const existing = merged[m.khmer]
        if (existing) {
            const known = () =>
                new Set([titleCase(existing.latin), ...Object.keys(existing.variants ?? {}).map(titleCase)])
            if (titleCase(existing.latin) !== m.latin && (m.count >= min || m.canonicalTail) && !known().has(titleCase(m.latin))) {
                merged[m.khmer] = {
                    ...existing,
                    variants: { ...(existing.variants ?? {}), [m.latin]: m.count },
                }
                enriched++
            }
            const additions = [
                ...Object.entries(m.variants ?? {}).filter(([sp, n]) => n >= min && !known().has(titleCase(sp))),
                ...Object.entries(m.tailVariants ?? {}).filter(([sp, n]) => n >= TAIL_MIN),
            ].filter(([sp]) => !known().has(titleCase(sp)))
            if (additions.length) {
                merged[m.khmer] = {
                    ...existing,
                    variants: { ...(existing.variants ?? {}), ...Object.fromEntries(additions) },
                }
                enriched++
            }
            continue
        }
        const tailCanonical = !!m.canonicalTail && m.count >= 1
        const singleton = singletons && m.count >= 1 && !m.canonicalTail
            && !(m.sources ?? []).every((src) => SINGLETON_SKIP_SOURCES.has(src))
            && singletonOk(m.khmer, m.latin)
        if (m.count < min && !(m.count >= 1 && (m.sources ?? []).some((s) => TRUSTED_STATIC.has(s))) && !tailCanonical && !singleton) continue
        const entry = { latin: m.latin, count: m.count }
        // spellings equal to the canonical are redundant, tail or not
        const variants = Object.fromEntries([
            ...Object.entries(m.variants ?? {}).filter(([, n]) => n >= min),
            ...Object.entries(m.tailVariants ?? {}),
        ].filter(([sp]) => titleCase(sp) !== titleCase(m.latin)))
        if (Object.keys(variants).length) entry.variants = variants
        merged[m.khmer] = entry
        added++
    }
    return { dict: merged, added, enriched }
}

/**
 * The counterfactual dictionary the package would ship if the given test
 * rows had never been scraped. A bundled key the test rows attest survives
 * only if the train rows alone would have admitted it:
 *   1. strip it when the train rows do not attest it at all
 *   2. strip it when its only train evidence is hand-authored (a
 *      native-review pair cannot be shown independent of the test rows —
 *      វេជ្ជរ៉ា → Vichara had no evidence but the lockbox row "Norodom
 *      Vichara")
 *   3. strip it when train support is below the merge threshold and no
 *      trusted static list vouches for it (the test rows were what lifted
 *      it past min-2)
 * then re-merge everything minable from the train rows.
 *
 * Keys the test rows do not attest (verified gold/roster entries with no
 * corpus rows) and blind native-vocabulary keys are untouched.
 *
 * Known limits, kept honest:
 *   - variant-level leakage is not attributable and remains (top-5
 *     slightly optimistic)
 *   - a stripped key might independently be gold/roster-sourced (exact
 *     then slightly pessimistic)
 *
 * `fullSupport` is accepted for backward compatibility and ignored.
 */
export const counterfactualDict = ({ bundled, trainRows, testRows, min = MERGE_MIN }) => {
    const testSupport = supportOf(testRows)
    const trainCounts = countAttestations(trainRows)
    const independentSupport = supportOf(trainRows.filter((p) => !isHandAuthored(p)))
    const trainSources = (khmer) =>
        [...(trainCounts.get(khmer)?.values() ?? [])].flatMap((hit) => [...hit.sources])
    const base = {}
    let removed = 0
    for (const [khmer, entry] of Object.entries(bundled)) {
        if ((testSupport.get(khmer) ?? 0) > 0 && !NATIVE_VOCAB_KEYS.has(khmer)) {
            const independent = independentSupport.get(khmer) ?? 0
            const trusted = trainSources(khmer).some((s) => TRUSTED_STATIC.has(s) && !HAND_AUTHORED_SOURCES.has(s))
            if (independent === 0 || (independent < min && !trusted)) {
                removed++
                continue
            }
        }
        base[khmer] = entry
    }
    const { dict, added, enriched } = applyMergePolicy(base, mineTokens(trainRows), min)
    return { dict, removed, added, enriched }
}
