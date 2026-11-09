/**
 * Shared types for the Khmer -> Latin transliteration module.
 */

import type { LearnedRule } from './learned-alternations.js'

/** How an individual name token was resolved. */
export type TokenSource = 'tokenDict' | 'rules'

/** How a full name was resolved. */
export type NameSource = 'tokens' | 'rules'

export interface TranslitToken {
    /** Original Khmer token (or segmented sub-tokens rendered as one). */
    khmer: string
    /** Latin rendering (title-cased single word). */
    latin: string
    source: TokenSource
    /**
     * Other plausible spellings of this token, best first (dictionary
     * variants, rule readings, learned and attested spelling alternations).
     */
    alternatives: string[]
}

/** A full-name candidate spelling with its probability score. */
export interface ScoredCandidate {
    value: string
    /**
     * Σ log P(spelling | khmer token) across the name's tokens — always
     * ≤ 0; closer to 0 means more probable. Masses come from dictionary
     * attestation counts; rule readings act as a smoothing prior, and
     * unattested spellings get a small floor, so scores are comparable
     * across names (useful for confidence thresholds in match workflows).
     */
    score: number
}

export interface TranslitResult {
    /** Full transliterated name, e.g. "Tang Leangkhai". */
    value: string
    source: NameSource
    tokens: TranslitToken[]
    /**
     * Ranked full-name spellings, `value` first. Khmer names are officially
     * romanized several ways (សូ បញ្ញា -> "So Panha" / "So Pagna"), so offer
     * these as choices when the official spelling is unknown.
     */
    candidates: string[]
    /**
     * `candidates` with their scores — same values, same order (`value` is
     * `scoredCandidates[0].value`). Each score is the summed log-probability
     * of that spelling given the Khmer tokens; present whenever candidates
     * are produced.
     */
    scoredCandidates?: ScoredCandidate[]
    /**
     * Leading honorifics/titles stripped from the input (outermost first),
     * e.g. ["សម្តេច"] — present only when something was stripped. The
     * passport-style `value`/`candidates` never contain them.
     */
    honorifics?: string[]
}

/** Entry in the token dictionary JSON (canonical spelling + variants). */
export interface TokenEntry {
    latin: string
    count: number
    variants?: Record<string, number>
}

export type TokenDictionaryData = Record<string, TokenEntry>

export interface TransliteratorOptions {
    /** Token-level dictionary (Khmer word -> canonical Latin word). */
    tokenDict?: TokenDictionaryData
    /** Maximum number of full-name `candidates` returned (default 5). */
    maxCandidates?: number
    /**
     * Matching workflows only (KYC/dedup): also append given<->surname
     * order-swapped spellings to `candidates` (Khmer writes the surname
     * first; Latin records often put it last, e.g. Ung Loung / Loung Ung).
     * `value` is never affected — passport-style output stays untouched.
     * Default false.
     */
    flipOrderCandidates?: boolean
    /**
     * Learned rewrite table for words the dictionary does not know (see
     * learned-alternations.ts). Rules-only tokens get up to
     * `maxLearnedAlternates` extra spellings, ranked below the rules
     * reading — `value` is never changed by them.
     * createDefaultTransliterator passes the bundled table.
     */
    learnedAlternations?: readonly LearnedRule[]
    /** Learned rewrites offered per rules-only token (default 2; 0 = off). */
    maxLearnedAlternates?: number
}
