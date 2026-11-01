/**
 * Shared types for the Khmer -> Latin transliteration module.
 */

/** How an individual name token was resolved. */
export type TokenSource = 'tokenDict' | 'fst' | 'rules'

/** How a full name was resolved. */
export type NameSource = 'tokens' | 'fst' | 'rules'

export interface TranslitToken {
    /** Original Khmer token (or segmented sub-tokens rendered as one). */
    khmer: string
    /** Latin rendering (title-cased single word). */
    latin: string
    source: TokenSource
    /**
     * Other plausible spellings of this token, best first (dictionary
     * variants, FST/rule readings, attested spelling alternations).
     */
    alternatives: string[]
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
    /**
     * Pre-computed FST results keyed by input string (full names or single
     * tokens). The pynini FST runs out-of-process; callers batch it and
     * inject the map. Missing keys simply fall through to the rules.
     */
    fstResults?: Map<string, string>
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
}
