/**
 * Convenience wrappers using the bundled token dictionary.
 */

import { defaultLearnedAlternations } from './learned-alternations-data.js'
import { defaultTokenDict } from './token-data.js'
import { createTransliterator, Transliterator } from './transliterate.js'
import { TokenDictionaryData, TransliteratorOptions } from './types.js'

/** Transliterator pre-loaded with the bundled token dictionary and the
 *  learned alternation table (extra candidates for rules-only words — see
 *  scripts/learn-alternations.mjs). Caller-supplied `tokenDict` entries
 *  win per key; a caller-supplied `learnedAlternations` replaces the table. */
export function createDefaultTransliterator(
    options: Omit<TransliteratorOptions, 'tokenDict'> & { tokenDict?: TokenDictionaryData } = {}
): Transliterator {
    const { tokenDict, ...rest } = options
    return createTransliterator({
        learnedAlternations: defaultLearnedAlternations,
        ...rest,
        tokenDict: { ...defaultTokenDict, ...tokenDict },
    })
}

let defaultChain: Transliterator | null = null

/** One-shot transliteration with the bundled dictionary. */
export function transliterateName(nameKh: string): string {
    if (!defaultChain) defaultChain = createDefaultTransliterator()
    return defaultChain.transliterate(nameKh).value
}
