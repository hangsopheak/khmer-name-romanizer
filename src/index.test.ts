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

    it('maps the obsolete sibilants ឝ/ឞ instead of dropping them', () => {
        expect(romanizeKhmerName('ឝ្រី')).toBe('Shrey') // ii-after-r-cluster reads ey (pre-existing); the letter itself is no longer dropped
        expect(romanizeKhmerName('ហឝ')).toBe('Hosh') // ha carries inherent o; the sibilant is no longer dropped
        expect(romanizeKhmerName('ឞ')).toBe('Sha') // unattested; Sanskrit sa analogy
    })

    it('covers every Khmer consonant letter — none is silently dropped', () => {
        for (let cp = 0x1780; cp <= 0x17a2; cp++) {
            const ch = String.fromCodePoint(cp)
            const out = romanizeKhmerName(ch + 'ា')
            expect(out.length, `letter U+${cp.toString(16)} ${ch} produced no output`).toBeGreaterThan(0)
        }
    })

    it('strips leading honorifics from the value and reports them', () => {
        const r = createDefaultTransliterator().transliterate('សម្តេច ហ៊ុន សេន')
        expect(r.value).toBe('Hun Sen')
        expect(r.honorifics).toEqual(['សម្តេច'])
    })

    it('strips royal titles glued to the name', () => {
        const r = createDefaultTransliterator().transliterate('ព្រះបាទសម្តេចព្រះនរោត្ដម បរមរាមាទេវតា')
        expect(r.value.startsWith('Norodom')).toBe(true)
        expect(r.honorifics).toEqual(['ព្រះបាទ', 'សម្តេច', 'ព្រះ'])
    })

    it('never strips a bare title into nothing and leaves title-free names untouched', () => {
        const bare = createDefaultTransliterator().transliterate('សម្តេច')
        expect(bare.value.length).toBeGreaterThan(0)
        expect(bare.honorifics).toBeUndefined()
        const plain = createDefaultTransliterator().transliterate('តាំង ដារា')
        expect(plain.value).toBe('Tang Dara')
        expect(plain.honorifics).toBeUndefined()
    })

    it('does not over-strip names that merely start like titles', () => {
        // ចៅ is a title only in compounds (ចៅពញា); real names start with it
        const r = createDefaultTransliterator().transliterate('ចៅ សុវណ្ណរាជ')
        expect(r.honorifics ?? []).toEqual([])
        expect(r.value).toContain('Chao')
        // សម្បត្តិ is a name, not សម្តេច
        const s = createDefaultTransliterator().transliterate('សម្បត្តិ មេថៈនី')
        expect(s.honorifics ?? []).toEqual([])
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
