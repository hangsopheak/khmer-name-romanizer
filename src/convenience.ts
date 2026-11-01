/**
 * Convenience wrappers using the bundled token dictionary.
 */

import { defaultFstDistill } from './fst-distill-data.js'
import { defaultTokenDict } from './token-data.js'
import { createTransliterator, Transliterator } from './transliterate.js'
import { TokenDictionaryData, TransliteratorOptions } from './types.js'

/** Transliterator pre-loaded with the bundled token dictionary and the
 *  distilled FST map (prior-grade readings for tokens the dictionary
 *  does not cover — see scripts/fst-distill.mjs). Caller-supplied
 *  `fstResults` win per key. */
export function createDefaultTransliterator(
    options: Omit<TransliteratorOptions, 'tokenDict'> & { tokenDict?: TokenDictionaryData } = {}
): Transliterator {
    const { tokenDict, fstResults, ...rest } = options
    const merged = new Map([...Object.entries(defaultFstDistill), ...(fstResults ?? [])])
    return createTransliterator({
        ...rest,
        tokenDict: { ...defaultTokenDict, ...tokenDict },
        fstResults: merged,
    })
}

let defaultChain: Transliterator | null = null

/** One-shot transliteration with the bundled dictionary. */
export function transliterateName(nameKh: string): string {
    if (!defaultChain) defaultChain = createDefaultTransliterator()
    return defaultChain.transliterate(nameKh).value
}
