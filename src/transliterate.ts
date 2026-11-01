/**
 * Token-level transliteration chain:
 *
 *   per-token dictionary (with segmentation for unspaced names)
 *     -> injected FST results
 *     -> rule-based fallback
 *
 * The core is pure and synchronous; the optional pynini FST tier runs
 * out-of-process, so callers batch it beforehand and inject a lookup map.
 *
 * Besides the best spelling, every result carries ranked `candidates`:
 * Khmer names have several official romanizations, so callers can offer
 * the alternatives (dictionary variants, FST/rule readings, attested
 * spelling alternations, whole-name FST) as choices.
 */

import { spellingAlternates } from './alternatives.js'
import { romanizeKhmerName } from './rules.js'
import { normalizeName, segmentToken, splitTokens, stripHonorifics } from './tokenizer.js'
import type { Segment } from './tokenizer.js'
import { TokenEntry, TokenSource, TranslitResult, TranslitToken, TransliteratorOptions } from './types.js'

export interface Transliterator {
    transliterate: (nameKh: string) => TranslitResult
    /**
     * All strings the caller should feed to the FST batch: full names, their
     * tokens, and the non-dictionary chunks left over by segmentation.
     */
    fstInputs: (names: string[]) => string[]
}

/** Keys this short may only drive segmentation of a fully covered unspaced
 *  name (2-unit surnames such as លី ជា ធា); single consonants never do. */
const FULL_SEGMENT_MIN_KEY_LEN = 2

/** Minimum length of an unknown chunk for partial segmentation to be trusted. */
const MIN_REMAINDER_LEN = 3

const DEFAULT_MAX_CANDIDATES = 5

/** A whole-name FST reading shorter than this share of the best reading lost syllables. */
const MIN_WHOLE_FST_LENGTH_RATIO = 0.8

/** Per-token options considered when composing full-name candidates. */
const OPTIONS_PER_TOKEN = 4

const SOURCE_RANK: Record<TokenSource, number> = { tokenDict: 0, fst: 1, rules: 2 }

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

/** A Khmer token renders as one Latin word; the FST emits syllable spaces. */
function joinSyllables(value: string): string {
    return value.split(/\s+/).join('')
}

/** Case-insensitive, order-preserving dedupe; drops empty strings. */
function uniqueSpellings(values: string[]): string[] {
    const seen = new Set<string>()
    const out: string[] = []
    for (const value of values) {
        const key = value.toLowerCase()
        if (!value || seen.has(key)) continue
        seen.add(key)
        out.push(value)
    }
    return out
}

/** given<->surname swap: first and last word exchange (Ung Loung -> Loung Ung). */
function flipOrder(candidate: string): string {
    const words = candidate.split(' ')
    if (words.length < 2) return ''
    return [words[words.length - 1], ...words.slice(1, -1), words[0]].join(' ')
}

function variantsByCount(entry: TokenEntry | undefined): string[] {
    if (!entry?.variants) return []
    return Object.entries(entry.variants)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([latin]) => titleCaseWords(latin))
}

/**
 * Ranked full names from per-token option lists: the sum of option ranks
 * orders the combinations (ties keep earlier tokens' first choices).
 */
function composeCandidates(optionLists: string[][], limit: number, separator = ' '): string[] {
    let combos: { words: string[]; cost: number }[] = [{ words: [], cost: 0 }]
    for (const options of optionLists) {
        const next: { words: string[]; cost: number }[] = []
        for (const combo of combos) {
            options.slice(0, OPTIONS_PER_TOKEN).forEach((option, rank) => {
                next.push({ words: [...combo.words, option], cost: combo.cost + rank })
            })
        }
        next.sort((a, b) => a.cost - b.cost)
        combos = next.slice(0, Math.max(limit * 4, 16))
    }
    return combos.map((combo) => combo.words.join(separator))
}

export function createTransliterator(options: TransliteratorOptions = {}): Transliterator {
    const tokenDict = new Map<string, TokenEntry>(Object.entries(options.tokenDict ?? {}))
    const fst = options.fstResults
    const maxCandidates = Math.max(1, options.maxCandidates ?? DEFAULT_MAX_CANDIDATES)
    const flipOrderCandidates = options.flipOrderCandidates ?? false

    // Longest dictionary key, computed once: segmentation calls reuse it
    // instead of rescanning every key per call.
    let maxDictKeyLen = 0
    for (const key of tokenDict.keys()) maxDictKeyLen = Math.max(maxDictKeyLen, key.length)

    // Segmentation and rule readings are pure per instance, and roster
    // batches repeat the same tokens heavily — memoize them (bounded).
    const MEMO_LIMIT = 5000
    const segCache = new Map<string, Segment[] | null>()
    const rulesCache = new Map<string, string>()
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

    const fstReading = (text: string): string => {
        const value = fst?.get(text)
        return value ? titleCaseWords(joinSyllables(value)) : ''
    }

    const rulesReading = (text: string): string => {
        const hit = rulesCache.get(text)
        if (hit !== undefined) return hit
        if (rulesCache.size >= MEMO_LIMIT) rulesCache.clear()
        const value = titleCaseWords(joinSyllables(romanizeKhmerName(text)))
        rulesCache.set(text, value)
        return value
    }

    /** Best reading + alternatives for one Khmer token. */
    const resolveToken = (token: string): TranslitToken => {
        const direct = tokenDict.get(token)
        const wholeTokenFst = fstReading(token)
        const rules = rulesReading(token)
        const withAlternates = (best: string, others: string[]) => {
            const all = uniqueSpellings([best, ...others, ...spellingAlternates(best)])
            return all.slice(1)
        }

        if (direct) {
            const latin = titleCaseWords(direct.latin)
            return {
                khmer: token,
                latin,
                source: 'tokenDict',
                alternatives: withAlternates(latin, [...variantsByCount(direct), wholeTokenFst, rules]),
            }
        }

        const segments = partialSegments(token)
        if (segments) {
            // Per-segment options, best first: the first option of each
            // segment forms the primary reading.
            const segmentOptions: string[][] = []
            const sources: TokenSource[] = []
            for (const seg of segments) {
                const entry = seg.inDict ? tokenDict.get(seg.text) : undefined
                const segFst = entry ? '' : fstReading(seg.text)
                if (entry) {
                    segmentOptions.push([entry.latin, ...variantsByCount(entry)])
                    sources.push('tokenDict')
                } else if (segFst) {
                    segmentOptions.push(uniqueSpellings([segFst, rulesReading(seg.text)]))
                    sources.push('fst')
                } else {
                    segmentOptions.push([rulesReading(seg.text)])
                    sources.push('rules')
                }
            }
            const source = weakestSource(sources)
            // One Khmer token renders as ONE Latin word (multi-word
            // dictionary entries carry their own internal spaces).
            const readings = composeCandidates(segmentOptions, DEFAULT_MAX_CANDIDATES, '').map(titleCaseWords)
            const composed = readings[0]
            // A rules-only remainder is weaker than the FST reading the whole
            // token's syllable stream, so let the whole-token FST win then.
            if (source !== 'rules' || !wholeTokenFst) {
                return {
                    khmer: token,
                    latin: composed,
                    source,
                    alternatives: withAlternates(composed, [...readings.slice(1, 3), wholeTokenFst, rules, ...readings.slice(3)]),
                }
            }
            return {
                khmer: token,
                latin: wholeTokenFst,
                source: 'fst',
                alternatives: withAlternates(wholeTokenFst, [...readings, rules]),
            }
        }

        if (wholeTokenFst) {
            return {
                khmer: token,
                latin: wholeTokenFst,
                source: 'fst',
                alternatives: withAlternates(wholeTokenFst, [rules]),
            }
        }
        return { khmer: token, latin: rules, source: 'rules', alternatives: withAlternates(rules, []) }
    }

    const candidatesFor = (resolved: TranslitToken[], wholeFstValue: string): string[] => {
        const composed = composeCandidates(
            resolved.map((t) => [t.latin, ...t.alternatives]),
            maxCandidates
        )
        // The whole-name FST (a different segmentation of the syllable
        // stream) goes right after the best composed reading, unless it
        // dropped syllables (ហង្ស ចាន់វត្តី -> "Hang Vatey").
        const letters = (value: string) => value.replace(/\s/g, '').length
        const keepFst = wholeFstValue !== '' && letters(wholeFstValue) >= MIN_WHOLE_FST_LENGTH_RATIO * letters(composed[0])
        return uniqueSpellings([composed[0], ...(keepFst ? [wholeFstValue] : []), ...composed.slice(1)]).slice(0, maxCandidates)
    }

    const transliterate = (nameKh: string): TranslitResult => {
        const normalized = normalizeName(nameKh)
        // Leading honorifics/titles are not part of a personal name: strip
        // them before resolving (they are reported in `honorifics`).
        const { name, honorifics } = stripHonorifics(normalized)
        const tokens = splitTokens(name)
        const wholeFst = fst?.get(name)
        const wholeFstValue = wholeFst ? wholeFst.split(/\s+/).map(titleCaseWords).join(' ') : ''

        // A completely unspaced name: if it fully segments into dictionary
        // words, those words are the name components -> join with spaces.
        let resolved: TranslitToken[] | null = null
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
        resolved = resolved.filter((t) => t.latin.length > 0)

        // Name-level source is the weakest token source: 'tokens' only when
        // every token came from the dictionary. Per-token composition beats
        // the whole-name FST even when no token is known (leave-one-out
        // 153 vs 149 exact), so the whole-name FST is only a candidate.
        const weakest = weakestSource(resolved.map((t) => t.source))
        const value = resolved.map((t) => titleCaseWords(t.latin)).join(' ')
        const candidates = candidatesFor(resolved, wholeFstValue)
        // Order-flipped spellings ride along AFTER the regular candidates
        // (match-mode aid): capped at 2x maxCandidates, value untouched.
        const flipped = flipOrderCandidates
            ? uniqueSpellings([...candidates, ...candidates.map(flipOrder).filter(Boolean)]).slice(
                  0,
                  maxCandidates * 2,
              )
            : candidates
        return {
            value,
            source: weakest === 'tokenDict' ? 'tokens' : weakest,
            tokens: resolved,
            candidates: flipped,
            ...(honorifics.length ? { honorifics } : {}),
        }
    }

    const fstInputs = (names: string[]): string[] => {
        const inputs = new Set<string>()
        for (const raw of names) {
            const { name } = stripHonorifics(normalizeName(raw))
            if (!name) continue
            inputs.add(name)
            for (const token of splitTokens(name)) {
                inputs.add(token)
                if (tokenDict.has(token)) continue
                for (const seg of partialSegments(token) ?? []) {
                    if (!seg.inDict) inputs.add(seg.text)
                }
            }
        }
        return [...inputs]
    }

    return { transliterate, fstInputs }
}
