/**
 * Convenience wrappers using the bundled token dictionary.
 */

import { defaultTokenDict } from './token-data.js'
import { createTransliterator, Transliterator } from './transliterate.js'
import { TokenDictionaryData, TransliteratorOptions } from './types.js'

/** Transliterator pre-loaded with the bundled token dictionary. */
export function createDefaultTransliterator(
    options: Omit<TransliteratorOptions, 'tokenDict'> & { tokenDict?: TokenDictionaryData } = {}
): Transliterator {
    const { tokenDict, ...rest } = options
    return createTransliterator({
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
