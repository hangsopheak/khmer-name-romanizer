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

    it('reads muusikatoan-shifted ែ as "e" (attested spellings)', () => {
        expect(romanizeKhmerName('ប៉ែត')).toBe('Pet') // attested
        expect(romanizeKhmerName('ង៉ែត')).toBe('Nget') // attested
        expect(romanizeKhmerName('ប៉ែន')).toBe('Pen') // Penn/Pen dominate attestations
    })

    it('passes Latin letters and digits through instead of dropping them', () => {
        expect(romanizeKhmerName('សុភ REAL 1987')).toContain('REAL 1987')
        const r = createDefaultTransliterator().transliterate('សុភ REAL 1987')
        expect(r.value).toContain('Real 1987') // name pipeline normalizes case
        expect(r.value).not.toContain('REAL REAL') // sanity
    })

    it('drops tokens that render empty instead of double-spacing', () => {
        const r = createDefaultTransliterator().transliterate('ចន្ទ ៈ បុត្រ')
        expect(r.value).toBe('Chan Pot') // single space, was "Chan␣␣Pot"
        expect(r.candidates.every((c) => !/\s{2,}/.test(c))).toBe(true)
    })

    it('appends order-flipped candidates when opted in; value stays untouched', () => {
        const t = createDefaultTransliterator({ flipOrderCandidates: true })
        const r = t.transliterate('អ៊ឹង លឿង')
        expect(r.value).toBe('Ung Loung') // passport-style value unchanged
        expect(r.candidates).toContain('Ung Loung')
        expect(r.candidates).toContain('Loung Ung') // the other famous-miss spelling
        // default stays byte-identical: no flip, no extra candidates
        const plain = createDefaultTransliterator().transliterate('អ៊ឹង លឿង')
        const plainFlip = createDefaultTransliterator({ flipOrderCandidates: false }).transliterate('អ៊ឹង លឿង')
        expect(plain.candidates).not.toContain('Loung Ung')
        expect(plainFlip.candidates).toEqual(plain.candidates)
        // single-token names gain nothing
        const one = t.transliterate('តាំងលាងខៃ')
        expect(one.candidates.length).toBeLessThanOrEqual(5)
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
