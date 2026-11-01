import { describe, it, expect } from 'vitest'
import { transliterateName, createDefaultTransliterator, createTransliterator, romanizeKhmerName, defaultFstDistill } from '.'

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

    it('scores candidates as log-probabilities mirroring the candidate list', () => {
        const r = createDefaultTransliterator().transliterate('ប៉ែន នុត')
        expect(r.scoredCandidates).toBeDefined()
        expect(r.scoredCandidates!.map((c) => c.value)).toEqual(r.candidates)
        expect(r.scoredCandidates![0].value).toBe(r.value)
        // probabilities: every score ≤ 0, strictly decreasing down the list
        const scores = r.scoredCandidates!.map((c) => c.score)
        expect(scores.every((s) => s <= 0)).toBe(true)
        expect(scores.every((s, i) => i === 0 || scores[i - 1] >= s)).toBe(true)
    })

    it('keeps a reviewed canonical ahead of higher-count corpus variants', () => {
        // ស is bundled as Sar (count 1) with variant Sor (count 2): the
        // canonical is a reviewed decision, raw corpus counts do not
        // outvote it (calibrated CANONICAL_MASS_BONUS).
        const r = createDefaultTransliterator().transliterate('ស ខេង')
        expect(r.value).toBe('Sar Kheng')
        expect(r.candidates).toContain('Sor Kheng')
    })

    it('injects official alternates the per-token option cap discards', () => {
        // ស៊ីន carries the canonical plus three variant readings, so its
        // official doubled spelling "Sinn" (attested final-n alternation)
        // sits past the OPTIONS_PER_TOKEN cap and can never compose into
        // a full-name candidate. The single-substitution swap injects it,
        // ranked below the leader — never displacing the value.
        const t = createTransliterator({
            tokenDict: { ស៊ីន: { latin: 'Sin', count: 9, variants: { Syn: 3, Seng: 2, Sen: 2 } } },
        })
        const r = t.transliterate('ស៊ីន ដារា')
        expect(r.value).toBe('Sin Dara') // swaps cannot outscore the leader
        expect(r.candidates).toContain('Sinn Dara')
        expect(r.candidates).toContain('Syn Dara') // within-cap options still compose
        expect(r.scoredCandidates![0].value).toBe('Sin Dara')
        const scores = r.scoredCandidates!.map((c) => c.score)
        expect(scores.every((s, i) => i === 0 || scores[i - 1] >= scores[i])).toBe(true)
        expect(r.candidates.length).toBeLessThanOrEqual(5)
    })

    it('promotes a variant only when it decisively out-attests the canonical', () => {
        const t = createDefaultTransliterator({
            tokenDict: { ដារា: { latin: 'Dara', count: 1, variants: { Tara: 6 } } },
        })
        expect(t.transliterate('ដារា').value).toBe('Tara')
    })

    it('scores order-flipped candidates alongside their source spelling', () => {
        const t = createDefaultTransliterator({ flipOrderCandidates: true })
        const r = t.transliterate('អ៊ឹង លឿង')
        expect(r.scoredCandidates!.map((c) => c.value)).toEqual(r.candidates)
        const ung = r.scoredCandidates!.find((c) => c.value === 'Loung Ung')!
        const source = r.scoredCandidates!.find((c) => c.value === 'Ung Loung')!
        expect(ung.score).toBe(source.score) // same spelling, other word order
    })

    it('injects the distilled FST map into the default transliterator only', () => {
        // កាង is not in the dictionary; its distilled FST reading leads
        // the default chain, the pure chain still uses the rules.
        expect(createDefaultTransliterator().transliterate('កាង ដារា').value).toBe('Kaing Dara')
        expect(createTransliterator({}).transliterate('កាង ដារា').value).toBe('Kang Dara')
    })

    it('lets caller fstResults override distilled readings per key', () => {
        const t = createDefaultTransliterator({ fstResults: new Map([['កាង', 'Kiang']]) })
        expect(t.transliterate('កាង ដារា').value).toBe('Kiang Dara')
    })

    it('ships no distilled reading that dropped syllables', () => {
        // guards the generator's length rule: a reading at least half the
        // Khmer token's length, or it lost syllables (regnal garbage).
        for (const [khmer, latin] of Object.entries(defaultFstDistill)) {
            const letters = latin.replace(/[^A-Za-z]/g, '').length
            expect(letters).toBeGreaterThanOrEqual(khmer.length > 2 ? Math.ceil(khmer.length / 2) : 1)
        }
        expect(Object.keys(defaultFstDistill).length).toBeGreaterThan(250)
    })

    it('romanizes well-known names (king, prime minister)', () => {
        expect(transliterateName('នរោត្តម សីហមុនី')).toBe('Norodom Sihamoni')
        expect(transliterateName('ហ៊ុន ម៉ាណែត')).toBe('Hun Manet')
        expect(transliterateName('ហ៊ុន សែន')).toBe('Hun Sen')
    })
})
