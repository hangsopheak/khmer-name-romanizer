import { describe, it, expect } from 'vitest'
import { transliterateName, createDefaultTransliterator, createTransliterator, romanizeKhmerName } from '.'

describe('khmer-name-romanizer', () => {
    it('one-shot transliteration uses the bundled dictionary', () => {
        expect(transliterateName('តាំង លាងខៃ')).toBe('Tang Leangkhai')
    })

    it('segments unspaced names', () => {
        expect(transliterateName('តាំងលាងខៃ')).toBe('Tang Leangkhai')
    })

    it('falls back to the rule engine when no dictionary knows the tokens', () => {
        const t = createTransliterator()
        const result = t.transliterate('កែ ប៊ុនឡុង')
        expect(result.source).toBe('rules')
        expect(result.value).toBe(romanizeKhmerName('កែ ប៊ុនឡុង'))
    })

    it('offers ranked alternative spellings', () => {
        const result = createDefaultTransliterator().transliterate('សូ បញ្ញា')
        expect(result.candidates[0]).toBe(result.value)
        expect(result.candidates).toEqual(expect.arrayContaining(['So Panha', 'So Pagna']))
    })

    it('supports extra dictionaries (e.g. official spellings)', () => {
        const t = createDefaultTransliterator({
            wholeNameDict: { តាំងលាងខៃ: 'Taing Leangkhai' },
        })
        expect(t.transliterate('តាំង លាងខៃ').value).toBe('Taing Leangkhai')
    })
})
