/**
 * Token-level transliteration chain:
 *
 *   per-token dictionary (with segmentation for unspaced names)
 *     -> rule-based fallback
 *
 * The core is pure and synchronous, with no runtime dependencies.
 *
 * Besides the best spelling, every result carries ranked `candidates`:
 * Khmer names have several official romanizations, so callers can offer
 * the alternatives (dictionary variants, rule readings, learned and
 * attested spelling alternations) as choices.
 */

import { spellingAlternates } from './alternatives.js'
import { indicReading, looksIndic } from './indic.js'
import { createLearnedAlternator } from './learned-alternations.js'
import { romanizeKhmerName } from './rules.js'
import { normalizeName, segmentToken, splitTokens, stripHonorifics } from './tokenizer.js'
import type { Segment } from './tokenizer.js'
import { TokenEntry, TokenSource, TranslitResult, TranslitToken, TransliteratorOptions, ScoredCandidate } from './types.js'

export interface Transliterator {
    transliterate: (nameKh: string) => TranslitResult
}

/** Keys this short may only drive segmentation of a fully covered unspaced
 *  name (2-unit surnames such as លី ជា ធា); single consonants never do. */
const FULL_SEGMENT_MIN_KEY_LEN = 2

/** Minimum length of an unknown chunk for partial segmentation to be trusted. */
const MIN_REMAINDER_LEN = 3

const DEFAULT_MAX_CANDIDATES = 5

/** Per-token options considered when composing full-name candidates. */
const OPTIONS_PER_TOKEN = 4

/* Probability model for candidate ranking: every per-token spelling option
 * carries a positive "mass" — corpus attestations from the dictionary, one
 * attestation's worth of trust for rule readings, and a small floor for
 * spellings offered without evidence (attested alternations). A full-name
 * candidate scores Σ log P(option | token), options normalized per token.
 *
 * The dictionary's canonical spelling is a reviewed decision (merge-tokens
 * never lets corpus counts override it), so it carries a pseudo-count on
 * top of its attestations: raw corpus variant counts promote a variant
 * only when they outweigh the canonical decisively.
 */
const RULES_PRIOR_MASS = 0.5
/** The Indic reading of a regnal name ranks below both Khmer readings
 *  (rules/plain, 0.5) but above unattested mass (0.25). */
const INDIC_PRIOR_MASS = 0.35
const UNSEEN_OPTION_MASS = 0.25
/** Canonical pseudo-count, calibrated on dev + famous (scripts/calibrate-scoring.mjs):
 *  3 keeps every reviewed canonical on the famous set (70/72) while still
 *  letting a variant with ~3+ more attestations than the canonical win. */
const CANONICAL_MASS_BONUS = 3
/** Learned rewrites of a rules-only reading offered per token (more
 *  crowd correct spellings of other tokens out of the top-5). */
const DEFAULT_MAX_LEARNED = 2
/** A learned rewrite's mass is its learned probability times the rules
 *  prior, capped below the rules reading so `value` never changes
 *  (promoting p >= 0.5 rewrites to `value` measured +12/-8 exact rows in
 *  the k-fold, sign test p = 0.5: not shipped). */
const LEARNED_P_CAP = 0.99

interface ScoredOption {
    value: string
    mass: number
}

const massKey = (value: string): string => value.toLowerCase()

/**
 * Ranked full names from per-token option lists: the sum of option
 * log-probabilities orders the combinations (ties keep earlier tokens'
 * first choices — sort is stable and options are listed best-first).
 */
function composeScored(
    optionLists: ScoredOption[][],
    limit: number,
    separator = ' ',
): { value: string; score: number }[] {
    // Per-token normalizers turn option masses into a distribution.
    const norms = optionLists.map((options) => options.reduce((sum, o) => sum + o.mass, 0))
    let combos: { words: string[]; score: number }[] = [{ words: [], score: 0 }]
    optionLists.forEach((options, t) => {
        const next: { words: string[]; score: number }[] = []
        for (const combo of combos) {
            options.slice(0, OPTIONS_PER_TOKEN).forEach((option) => {
                next.push({ words: [...combo.words, option.value], score: combo.score + Math.log(option.mass / norms[t]) })
            })
        }
        next.sort((a, b) => b.score - a.score)
        combos = next.slice(0, Math.max(limit * 4, 16))
    })
    return combos.map((combo) => ({ value: combo.words.join(separator), score: combo.score }))
}

/** One resolved token: public shape plus the probability mass of every
 *  spelling option it offered (keyed lowercase, merged across sources). */
interface ScoredToken {
    token: TranslitToken
    masses: Map<string, number>
}

/**
 * Options in display order (primary first, then the alternatives the token
 * tier produced). A spelling offered by several sources keeps only its
 * STRONGEST evidence: an attestation count and a rule prior are the same
 * fact seen twice (variants arise from rule readings), so summing masses
 * would double-count and outvote stronger single evidence. Alternation
 * spellings of the tier primary (`alternateOf`) join with floor mass.
 * The top-mass spelling becomes `latin` (ties keep listed order), so
 * joining the tokens' `latin` values reproduces the best full-name
 * candidate.
 */
function scoredToken(
    khmer: string,
    source: TokenSource,
    options: ScoredOption[],
    alternateOf: string,
): ScoredToken {
    const withAlts = [
        ...options,
        ...spellingAlternates(alternateOf).map((value) => ({ value, mass: UNSEEN_OPTION_MASS })),
    ]
    const order: string[] = []
    const masses = new Map<string, number>()
    for (const { value, mass } of withAlts) {
        if (!value) continue
        const key = massKey(value)
        if (!masses.has(key)) order.push(value)
        masses.set(key, Math.max(masses.get(key) ?? 0, mass))
    }
    let best = 0
    for (let i = 1; i < order.length; i++) {
        if (masses.get(massKey(order[i]))! > masses.get(massKey(order[best]))!) best = i
    }
    const latin = order[best] ?? ''
    const token: TranslitToken = {
        khmer,
        latin,
        source,
        alternatives: order.filter((_, i) => i !== best),
    }
    return { token, masses }
}

const SOURCE_RANK: Record<TokenSource, number> = { tokenDict: 0, rules: 1 }

/** The least reliable source among the parts ("weakest link"). */
function weakestSource(sources: TokenSource[]): TokenSource {
    return sources.reduce<TokenSource>(
        (worst, source) => (SOURCE_RANK[source] > SOURCE_RANK[worst] ? source : worst),
        'tokenDict'
    )
}

function titleCaseWords(value: string): string {
    return value
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
}

/**
 * Collapse syllable spaces inside one token reading (dictionary entries
 * may carry multi-word runs like "Pol Pot" with their own internal
 * spaces — they must be preserved, see joinSyllables' callers).
 */
function joinSyllables(value: string): string {
    return value.split(/ +/).join('')
}

/** given<->surname swap: first and last word exchange (Ung Loung -> Loung Ung). */
function flipOrder(candidate: string): string {
    const words = candidate.split(' ')
    if (words.length < 2) return ''
    return [words[words.length - 1], ...words.slice(1, -1), words[0]].join(' ')
}

/** Dictionary variants as mass-carrying options, most attestations first. */
function variantOptions(entry: TokenEntry): ScoredOption[] {
    return Object.entries(entry.variants ?? {})
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([latin, count]) => ({ value: titleCaseWords(latin), mass: count }))
}

export function createTransliterator(options: TransliteratorOptions = {}): Transliterator {
    const tokenDict = new Map<string, TokenEntry>(Object.entries(options.tokenDict ?? {}))
    const maxCandidates = Math.max(1, options.maxCandidates ?? DEFAULT_MAX_CANDIDATES)
    const flipOrderCandidates = options.flipOrderCandidates ?? false
    const learned = createLearnedAlternator(options.learnedAlternations ?? [])
    const maxLearned = Math.max(0, options.maxLearnedAlternates ?? DEFAULT_MAX_LEARNED)
    /** Learned rewrites of a rules reading, as options below it. */
    const learnedOptions = (rules: string): ScoredOption[] =>
        learned.alternates(rules, maxLearned).map((a) => ({
            value: titleCaseWords(a.value),
            mass: RULES_PRIOR_MASS * Math.min(a.p, LEARNED_P_CAP),
        }))

    // Longest dictionary key, computed once: segmentation calls reuse it
    // instead of rescanning every key per call.
    let maxDictKeyLen = 0
    for (const key of tokenDict.keys()) maxDictKeyLen = Math.max(maxDictKeyLen, key.length)

    // Segmentation and rule readings are pure per instance, and roster
    // batches repeat the same tokens heavily — memoize them (bounded).
    const MEMO_LIMIT = 5000
    const segCache = new Map<string, Segment[] | null>()
    const rulesCache = new Map<string, string>()
    const plainCache = new Map<string, string>()
    const cachedSegment = (key: string, compute: () => Segment[] | null): Segment[] | null => {
        if (segCache.has(key)) return segCache.get(key) ?? null
        if (segCache.size >= MEMO_LIMIT) segCache.clear()
        const value = compute()
        segCache.set(key, value)
        return value
    }

    /**
     * Partial segmentation of a token, or null when it is not trustworthy:
     * orphan vowel signs (មិនា -> មិន + ា) would be shredded by the rules.
     */
    const partialSegments = (token: string) => {
        if (tokenDict.size === 0) return null
        const segments = cachedSegment(`p|${token}`, () =>
            segmentToken(token, tokenDict, { maxKeyLen: maxDictKeyLen })
        )
        if (!segments) return null
        return segments.every((seg) => seg.inDict || seg.text.length >= MIN_REMAINDER_LEN) ? segments : null
    }

    const readingWith = (cache: Map<string, string>, plain: boolean) => (text: string): string => {
        const hit = cache.get(text)
        if (hit !== undefined) return hit
        if (cache.size >= MEMO_LIMIT) cache.clear()
        const value = titleCaseWords(joinSyllables(romanizeKhmerName(text, { plain })))
        cache.set(text, value)
        return value
    }
    /** French-style rules reading (the first guess). */
    const rulesReading = readingWith(rulesCache, false)
    /** Plain rules reading: the alternative to the French one, and the
     *  base the learned table rewrites (it is learned on plain readings). */
    const plainReading = readingWith(plainCache, true)

    /** Best reading + alternatives for one Khmer token, with the
     *  probability mass of every option (for full-name scoring). */
    const resolveToken = (token: string): ScoredToken => {
        const direct = tokenDict.get(token)
        const rules = rulesReading(token)
        if (direct) {
            const latin = titleCaseWords(direct.latin)
            return scoredToken(token, 'tokenDict', [
                { value: latin, mass: direct.count + CANONICAL_MASS_BONUS },
                ...variantOptions(direct),
                { value: rules, mass: RULES_PRIOR_MASS },
            ], latin)
        }

        const segments = partialSegments(token)
        if (segments) {
            // Per-segment options, best first: the first option of each
            // segment forms the primary reading. Segment masses are dict
            // attestations (or prior mass for rule readings), so a
            // composed reading's mass is the product of its segments'.
            const segmentOptions: ScoredOption[][] = []
            const sources: TokenSource[] = []
            for (const seg of segments) {
                const entry = seg.inDict ? tokenDict.get(seg.text) : undefined
                if (entry) {
                    segmentOptions.push([
                        { value: titleCaseWords(entry.latin), mass: entry.count + CANONICAL_MASS_BONUS },
                        ...variantOptions(entry),
                    ])
                    sources.push('tokenDict')
                } else {
                    segmentOptions.push([{ value: rulesReading(seg.text), mass: RULES_PRIOR_MASS }])
                    sources.push('rules')
                }
            }
            const source = weakestSource(sources)
            // One Khmer token renders as ONE Latin word (multi-word
            // dictionary entries carry their own internal spaces).
            const readings = composeScored(segmentOptions, DEFAULT_MAX_CANDIDATES, '').map((r) => ({
                value: titleCaseWords(r.value),
                mass: Math.exp(r.score),
            }))
            const composed = readings[0]?.value ?? ''
            // A regnal token also carries its whole-word Indic reading
            // (ឧទយាទិត្យវម៌្ម segments, but Udayadityavarman is one
            // word). It sits at slot 2: inside the per-token option cap,
            // below the composed Khmer reading.
            const indic = looksIndic(token) ? titleCaseWords(indicReading(token)) : ''
            const indicOption =
                indic && indic !== composed && !readings.some((r) => r.value === indic)
                    ? [{ value: indic, mass: INDIC_PRIOR_MASS }]
                    : []
            return scoredToken(token, source, [
                ...readings.slice(0, 1),
                ...indicOption,
                ...readings.slice(1, 3),
                { value: rules, mass: RULES_PRIOR_MASS },
                ...readings.slice(3),
            ], composed)
        }

        // French-style first guess; the plain reading stays an equal-mass
        // alternative (both spellings are in use: Sareth / Saret, Keo / Kaev)
        const plain = plainReading(token)
        // Regnal/Sanskrit tokens also carry their plain Indic reading
        // (Mahendravarman, Kaundinya) below both Khmer readings
        const indic = looksIndic(token) ? titleCaseWords(indicReading(token)) : ''
        const indicOption =
            indic && indic !== rules && indic !== plain ? [{ value: indic, mass: INDIC_PRIOR_MASS }] : []
        return scoredToken(token, 'rules', [
            { value: rules, mass: RULES_PRIOR_MASS },
            { value: plain, mass: RULES_PRIOR_MASS },
            ...indicOption,
            ...learnedOptions(plain),
        ], rules)
    }

    /** Ranked full-name candidates with scores, best first. */
    const candidatesFor = (resolved: ScoredToken[]): ScoredCandidate[] => {
        const optionLists = resolved.map(({ token, masses }) =>
            [token.latin, ...token.alternatives]
                .slice(0, OPTIONS_PER_TOKEN)
                .map((value) => ({ value, mass: masses.get(massKey(value)) ?? UNSEEN_OPTION_MASS })),
        )
        const composed = composeScored(optionLists, maxCandidates)
        // The per-token cap discards tail options: once a token offers
        // variants plus rule readings, its attested spelling
        // alternations sit beyond it (alternates always join last), so an
        // official spelling one alternation away from the primary ("Sin"
        // -> "Sinn") can never compose into a full-name candidate. Inject
        // those spellings as single-substitution variants of the leader:
        // per token, its top discarded option replaces that token's word,
        // scored with the same mass maps (the per-token normalizer
        // cancels, so the swap's score is the leader's plus the mass
        // ratio). A swap trades the leader's top-mass option for a
        // lighter one, so it can never outscore the leader — equal-mass
        // ties keep the composed spelling ahead — it only competes for
        // the lower candidate slots.
        const leader = composed[0]
        const swaps: ScoredCandidate[] = []
        if (leader) {
            const leaderWords = optionLists.map((options) => options[0].value)
            resolved.forEach(({ token, masses }, t) => {
                const swappedIn = token.alternatives[OPTIONS_PER_TOKEN - 1]
                if (!swappedIn) return
                const mass = masses.get(massKey(swappedIn)) ?? UNSEEN_OPTION_MASS
                swaps.push({
                    value: [...leaderWords.slice(0, t), swappedIn, ...leaderWords.slice(t + 1)].join(' '),
                    score: leader.score + Math.log(mass / optionLists[t][0].mass),
                })
            })
            swaps.sort((a, b) => b.score - a.score)
        }
        // Stable sort keeps composed candidates ahead of equal-scored swaps.
        const ranked = swaps.length ? [...composed, ...swaps].sort((a, b) => b.score - a.score) : composed
        // Case-insensitive dedupe keeps the first (best-scored) spelling.
        const seen = new Set<string>()
        return ranked.filter((c) => {
            if (!c.value) return false
            const key = c.value.toLowerCase()
            if (seen.has(key)) return false
            seen.add(key)
            return true
        }).slice(0, maxCandidates)
    }

    const transliterate = (nameKh: string): TranslitResult => {
        const normalized = normalizeName(nameKh)
        // Leading honorifics/titles are not part of a personal name: strip
        // them before resolving (they are reported in `honorifics`).
        const { name, honorifics } = stripHonorifics(normalized)
        const tokens = splitTokens(name)

        // A completely unspaced name: if it fully segments into dictionary
        // words, those words are the name components -> join with spaces.
        let resolved: ScoredToken[] | null = null
        if (tokens.length === 1 && tokenDict.size > 0) {
            const segs = cachedSegment(`f|${tokens[0]}`, () =>
                segmentToken(tokens[0], tokenDict, {
                    minKeyLen: FULL_SEGMENT_MIN_KEY_LEN,
                    maxKeyLen: maxDictKeyLen,
                })
            )
            if (segs && segs.every((seg) => seg.inDict)) {
                resolved = segs.map((seg) => resolveToken(seg.text))
            }
        }
        resolved ??= tokens.map(resolveToken)
        // Tokens that render empty (stray marks, e.g. a lone ៈ left by a
        // roster typo) are noise: drop them so value/candidates never get
        // double spaces.
        resolved = resolved.filter(({ token }) => token.latin.length > 0)

        // Name-level source is the weakest token source: 'tokens' only when
        // every token came from the dictionary.
        const weakest = weakestSource(resolved.map(({ token }) => token.source))
        const scored = candidatesFor(resolved)
        // The best full-name spelling is the top-scored candidate; it is
        // the join of each token's top-mass option by construction.
        const value = scored[0]?.value ?? ''
        const candidates = scored.map((c) => c.value)
        // Order-flipped spellings ride along AFTER the regular candidates
        // (match-mode aid): capped at 2x maxCandidates, value untouched.
        // Flips keep their source candidate's score (same spelling, other
        // word order — the probability model does not model order).
        if (flipOrderCandidates) {
            const flippedList = [
                ...scored,
                ...scored.map((c) => ({ value: flipOrder(c.value), score: c.score })).filter((c) => Boolean(c.value)),
            ]
            const seen = new Set<string>()
            const deduped = flippedList.filter((c) => {
                if (!c.value || seen.has(c.value.toLowerCase())) return false
                seen.add(c.value.toLowerCase())
                return true
            })
            return {
                value,
                source: weakest === 'tokenDict' ? 'tokens' : weakest,
                tokens: resolved.map(({ token }) => token),
                candidates: deduped.slice(0, maxCandidates * 2).map((c) => c.value),
                scoredCandidates: deduped.slice(0, maxCandidates * 2),
                ...(honorifics.length ? { honorifics } : {}),
            }
        }
        return {
            value,
            source: weakest === 'tokenDict' ? 'tokens' : weakest,
            tokens: resolved.map(({ token }) => token),
            candidates,
            scoredCandidates: scored,
            ...(honorifics.length ? { honorifics } : {}),
        }
    }

    return { transliterate }
}
