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

    let maxKeyLen = 0
    for (const key of dict.keys()) {
        if (key.length < minKeyLen) continue
        maxKeyLen = Math.max(maxKeyLen, key.length)
    }
    if (maxKeyLen === 0) return null
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
