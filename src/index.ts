/**
 * khmer-name-romanizer — Khmer script -> Latin transliteration for
 * Cambodian personal names (passport/roster style romanization).
 *
 * Chain: token dictionary (with segmentation for unspaced names)
 * -> optional injected FST results -> rule-based fallback.
 */

export { romanizeKhmer, romanizeKhmerName, normalizeKhmerText } from './rules.js'
export { normalizeName, normalizeKhmerKey, splitTokens, segmentToken } from './tokenizer.js'
export type { Segment, SegmentOptions } from './tokenizer.js'
export { createTransliterator } from './transliterate.js'
export { spellingAlternates } from './alternatives.js'
export type { Transliterator } from './transliterate.js'
export { defaultTokenDict } from './token-data.js'
export { transliterateName, createDefaultTransliterator } from './convenience.js'
export type {
    NameSource,
    TokenSource,
    TokenEntry,
    TokenDictionaryData,
    TranslitToken,
    TranslitResult,
    TransliteratorOptions,
} from './types.js'
