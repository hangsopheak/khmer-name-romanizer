/**
 * Name tokenization and dictionary-based segmentation for Khmer names.
 *
 * Khmer personal names are written as space-separated components
 * (surname givenName), but the components themselves contain no spaces.
 * When a component is missing from the dictionary, we try to segment it
 * into known dictionary words (longest-match DP) so that unspaced full
 * names such as "តាំងលាងខៃ" still resolve via the token dictionary.
 */

import { normalizeKhmerText } from './rules.js'
import { TokenEntry } from './types.js'

/** Strips zero-width characters, maps typo colons to ៈ and collapses whitespace. */
export function normalizeName(name: string): string {
    return normalizeKhmerText(name).replace(/\s+/g, ' ').trim()
}

/** Key for whole-name dictionary lookups: normalized, with all spaces removed. */
export function normalizeKhmerKey(name: string): string {
    return normalizeKhmerText(name).replace(/\s/g, '')
}

export function splitTokens(name: string): string[] {
    return normalizeName(name).split(' ').filter(Boolean)
}

/**
 * Royal/noble/religious titles: safe to strip even when glued directly to
 * the name (ព្រះបាទសម្តេចព្រះនរោត្ដម), guarded by requiring a plausible
 * name remainder. Sorted longest-first at module load.
 *
 * Extends the scraper's list (scrape_names.py KHMER_TITLES) with forms the
 * corpus shows it missed: the សម្ដេច (ដ) spelling variant, អ្នកម្នាង,
 * អ្នកអង្គម្ចាស់, ឱកញា, and bare ពញា — all attested with title-less Latin.
 */
const PREFIX_TITLES = [
    'សម្តេចព្រះ', 'សម្ដេចព្រះ', 'សម្តេចអគ្គ', 'សម្តេច', 'សម្ដេច',
    'ព្រះករុណា', 'ព្រះបាទ', 'ព្រះអង្គ', 'ព្រះអរហន្ត', 'ព្រះថេរ', 'ព្រះនាង', 'ព្រះ',
    'ចៅចមមាតាអ្នក', 'ចៅចមមាតា', 'ចៅពញា',
    'អ្នកអង្គម្ចាស់', 'អ្នកឧកញ៉ា', 'អ្នកម្នាង', 'អ្នកនាង', 'អ្នកស្រី',
    'ឧកញ៉ា', 'ឱកញា', 'ពញា',
].sort((a, b) => b.length - a.length)

/**
 * Courtesy/profession titles: stripped only as whole leading tokens (with a
 * following space). Glued forms could be real names, so they stay. Bare ចៅ
 * is never a title: real names (ចៅ សុភា) start with it.
 *
 * ឯកឧត្តម / ឯកឧត្ដម ("His/Her Excellency", both orthographies): the
 * workhorse honorific of official Cambodian documents — 173 of 217 unique
 * senator names on senate.gov.kh carry one of the two spellings.
 */
const TOKEN_TITLES = [
    'លោកនាង', 'លោកស្រី', 'លោកជំទាវ', 'លោកគ្រូ', 'លោក',
    'ឯកឧត្តម', 'ឯកឧត្ដម',
    'ម៉ែស', 'មិសស', 'ដុកតឺរ', 'ប្រធាន',
].sort((a, b) => b.length - a.length)

const KHMER_LETTER = /[\u1780-\u17b2]/

export interface StrippedHonorifics {
    /** Name with leading titles removed (unchanged if nothing was stripped). */
    name: string
    /** Titles removed, outermost first (e.g. ['ព្រះបាទ', 'សម្តេចព្រះ']). */
    honorifics: string[]
}

/**
 * Strips leading honorifics/titles — repeatedly, because they stack
 * (សម្តេចព្រះ ...), and royal titles also when written without a space
 * before the name. Never strips the whole string: a bare title reverts.
 */
export function stripHonorifics(name: string): StrippedHonorifics {
    const stripped: string[] = []
    let text = name
    let changed = true
    while (changed) {
        changed = false
        for (const title of TOKEN_TITLES) {
            if (text === title || text.startsWith(title + ' ')) {
                text = text.slice(title.length).trim()
                stripped.push(title)
                changed = true
            }
        }
        for (const title of PREFIX_TITLES) {
            const rest = text.slice(title.length).trimStart()
            if (text.startsWith(title) && rest.replace(/ /g, '').length >= 2 && KHMER_LETTER.test(rest)) {
                text = rest
                stripped.push(title)
                changed = true
            }
        }
    }
    if (!stripped.length || !text.replace(/ /g, '').length) return { name, honorifics: [] }
    return { name: text, honorifics: stripped }
}

export interface Segment {
    text: string
    inDict: boolean
}

interface DPCell {
    covered: number
    segs: number
    from: number
    inDict: boolean
    valid: boolean
}

/** Dict keys shorter than this (UTF-16 code units) never drive partial
 *  segmentation (single consonants like ខ/ន are surname tokens in their own
 *  right and would shred words). */
export const MIN_SEGMENT_KEY_LEN = 3

export interface SegmentOptions {
    /** Minimum dictionary key length allowed as a segment (default 3). */
    minKeyLen?: number
    /**
     * Precomputed maximum dictionary key length (any minKeyLen): skips the
     * per-call scan of every key. The len >= minKeyLen loop guard subsumes
     * the per-minimum refinement, so one value serves all callers.
     */
    maxKeyLen?: number
}

/**
 * Segments a Khmer token into dictionary and non-dictionary chunks.
 * Maximizes covered characters first, then minimizes segment count.
 * Returns null when no prefix of the token is in the dictionary.
 */
export function segmentToken(
    token: string,
    dict: Map<string, TokenEntry>,
    options: SegmentOptions = {}
): Segment[] | null {
    if (token.length === 0 || dict.size === 0) return null
    const minKeyLen = Math.max(1, options.minKeyLen ?? MIN_SEGMENT_KEY_LEN)

    let maxKeyLen = options.maxKeyLen ?? 0
    if (maxKeyLen <= 0) for (const key of dict.keys()) maxKeyLen = Math.max(maxKeyLen, key.length)
    if (maxKeyLen < minKeyLen) return null
    const isSegmentKey = (text: string): boolean =>
        text.length >= minKeyLen && dict.has(text)

    const n = token.length
    const dp: DPCell[] = Array.from({ length: n + 1 }, () => ({
        covered: 0, segs: 0, from: -1, inDict: false, valid: false,
    }))
    dp[n] = { covered: 0, segs: 0, from: -1, inDict: false, valid: true }

    for (let i = n - 1; i >= 0; i--) {
        let best: DPCell | null = null
        // dictionary word starting at i
        const limit = Math.min(maxKeyLen, n - i)
        for (let len = limit; len >= minKeyLen; len--) {
            if (!isSegmentKey(token.slice(i, i + len))) continue
            const next = dp[i + len]
            if (!next.valid) continue
            const candidate: DPCell = {
                covered: next.covered + len,
                segs: next.segs + 1,
                from: i + len,
                inDict: true,
                valid: true,
            }
            if (
                best === null ||
                candidate.covered > best.covered ||
                (candidate.covered === best.covered && candidate.segs < best.segs)
            ) {
                best = candidate
            }
        }
        // skip one character as non-dictionary chunk
        const skip = dp[i + 1]
        if (skip.valid) {
            const candidate: DPCell = {
                covered: skip.covered,
                segs: skip.segs + 1,
                from: i + 1,
                inDict: false,
                valid: true,
            }
            if (
                best === null ||
                candidate.covered > best.covered ||
                (candidate.covered === best.covered && candidate.segs < best.segs)
            ) {
                best = candidate
            }
        }
        if (best) dp[i] = best
    }

    if (!dp[0].valid || dp[0].covered === 0) return null

    const segments: Segment[] = []
    let i = 0
    while (i < n) {
        const cell = dp[i]
        const text = token.slice(i, cell.from)
        const last = segments[segments.length - 1]
        if (last && !last.inDict && !cell.inDict) {
            last.text += text
        } else {
            segments.push({ text, inDict: cell.inDict })
        }
        i = cell.from
    }
    return segments
}
