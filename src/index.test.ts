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

    it('romanizes the vowel ើ (U+17BE) instead of dropping it', () => {
        expect(romanizeKhmerName('ត្រើន')).toBe('Troeun') // was "Trano" — vowel dropped
        expect(romanizeKhmerName('កើត')).toBe('Koeut') // attested Koeut Rith
        expect(romanizeKhmerName('រើន')).toBe('Roeun') // attested
        expect(romanizeKhmerName('កើស')).toBe('Koeus') // attested Ieu Koeus
        expect(romanizeKhmerName('កើ')).toBe('Keu') // open syllable (Keuky)
    })

    it('extends the bundled dictionary with caller tokenDict entries', () => {
        const t = createDefaultTransliterator({ tokenDict: { ដារា: { latin: 'Dara', count: 1 } } })
        const result = t.transliterate('តាំង ដារា')
        expect(result.value).toBe('Tang Dara')
        expect(result.source).toBe('tokens')
    })

    it('romanizes well-known names (king, prime minister)', () => {
        expect(transliterateName('នរោត្តម សីហមុនី')).toBe('Norodom Sihamoni')
        expect(transliterateName('ហ៊ុន ម៉ាណែត')).toBe('Hun Manet')
        expect(transliterateName('ហ៊ុន សែន')).toBe('Hun Sen')
    })
})
