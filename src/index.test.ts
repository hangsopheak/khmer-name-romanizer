import { describe, it, expect } from 'vitest'
import {
    transliterateName,
    createDefaultTransliterator,
    createTransliterator,
    createLearnedAlternator,
    romanizeKhmerName,
    defaultLearnedAlternations,
} from '.'
import type { LearnedRule } from '.'

describe('khmer-name-romanizer', () => {
    it('one-shot transliteration uses the bundled dictionary', () => {
        expect(transliterateName('តាំង លាងខៃ')).toBe('Taing Leangkhai')
    })

    it('segments unspaced names', () => {
        expect(transliterateName('តាំងលាងខៃ')).toBe('Taing Leangkhai')
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
        expect(romanizeKhmerName('កើត', { plain: true })).toBe('Koeut') // attested Koeut Rith (French default: Koeuth)
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

    it('strips His/Her Excellency in both orthographies (senate.gov.kh attestations)', () => {
        // ឯកឧត្តម (modern) and ឯកឧត្ដម (classic coeng ត្ដ) prefix 173 of 217
        // unique senator names on the official Senate roster — the engine
        // used to render them as a name token.
        const a = createDefaultTransliterator().transliterate('ឯកឧត្តម លី គឹមហាន')
        expect(a.honorifics).toEqual(['ឯកឧត្តម'])
        expect(a.value).toBe('Ly Kimhan')
        const b = createDefaultTransliterator().transliterate('ឯកឧត្ដម ស៊ិន ពិនសេន')
        expect(b.honorifics).toEqual(['ឯកឧត្ដម'])
        expect(b.value).not.toMatch(/Ekodom|Ekat/i) // title never renders as a word
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
        expect(plain.value).toBe('Taing Dara')
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

    it('applies the round-6 conventions a native reader confirmed', () => {
        expect(romanizeKhmerName('ខុន')).toBe('Khon') // a-series ុ + ន
        expect(romanizeKhmerName('ហ៊ុល')).toBe('Hul') // ៊ ុ + final
        expect(romanizeKhmerName('ឈន់')).toBe('Chhon') // o-series + ន់
        expect(romanizeKhmerName('ព្រំ')).toBe('Prom') // o-series + ំ
        expect(romanizeKhmerName('ពល')).toBe('Pol') // o-series + ល
        expect(romanizeKhmerName('រ៉ន')).toBe('Rorn') // ៉ + ន
        expect(romanizeKhmerName('ដាញ់')).toBe('Danh') // final ញ
        expect(romanizeKhmerName('ម៉ី')).toBe('Mey') // final ី after a-series
        expect(romanizeKhmerName('បូរី')).toBe('Borey') // final ី after រ
        expect(romanizeKhmerName('ហុកហ៊ី')).toBe('Hokhy') // final ី after ៊
        expect(romanizeKhmerName('ឡូវ')).toBe('Lov') // final ូវ
        expect(romanizeKhmerName('គឹង')).toBe('Koeng') // ឹ + final ង
        expect(romanizeKhmerName('យុទ្ធី')).toBe('Yutthy') // o-series ុ before a cluster; ី after ធ
        expect(romanizeKhmerName('សុទ្ធ')).toBe('Soth') // a-series keeps "o"
        expect(romanizeKhmerName('មាលី')).toBe('Meali') // open ា after ម; final ី after o-series ល stays "i"
        // the plain reading keeps the 0.5.0 spellings
        expect(romanizeKhmerName('ខុន', { plain: true })).toBe('Khun')
        expect(romanizeKhmerName('ឈន់', { plain: true })).toBe('Chhan')
    })

    it('keeps native-reader dictionary fixes (stale aliases removed)', () => {
        expect(transliterateName('ឃុន នារី')).toBe('Khun Neary')
        expect(transliterateName('ហេង បញ្ចពណ៍')).toBe('Heng Panhchapor')
        expect(transliterateName('សោភ័ណ')).toBe('Soaphoan')
    })

    it('reads muusikatoan-shifted ែ as "e" (attested spellings)', () => {
        expect(romanizeKhmerName('ប៉ែត', { plain: true })).toBe('Pet') // attested (French default: Peth)
        expect(romanizeKhmerName('ង៉ែត', { plain: true })).toBe('Nget') // attested
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
        expect(r.value).toBe('Chan Both') // single space, was "Chan␣␣Pot"
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
        // one-word names gain nothing (an unspaced name such as តាំងលាងខៃ
        // segments into two words, so it does get flips)
        const one = t.transliterate('សុខា')
        expect(one.tokens).toHaveLength(1)
        expect(one.candidates).toEqual(createDefaultTransliterator().transliterate('សុខា').candidates)
    })

    it('extends the bundled dictionary with caller tokenDict entries', () => {
        const t = createDefaultTransliterator({ tokenDict: { ដារា: { latin: 'Dara', count: 1 } } })
        const result = t.transliterate('តាំង ដារា')
        expect(result.value).toBe('Taing Dara')
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

    it('romanizes well-known names (king, prime minister)', () => {
        expect(transliterateName('នរោត្តម សីហមុនី')).toBe('Norodom Sihamoni')
        expect(transliterateName('ហ៊ុន ម៉ាណែត')).toBe('Hun Manet')
        expect(transliterateName('ហ៊ុន សែន')).toBe('Hun Sen')
    })

    describe('French-style conventions (0.5.0)', () => {
        it('reads the French-style spelling first', () => {
            expect(romanizeKhmerName('សារ៉េត')).toBe('Sareth') // word-final dental -> th
            expect(romanizeKhmerName('ចៅ')).toBe('Chao') // ៅ -> ao
            expect(romanizeKhmerName('លៀង')).toBe('Leang') // ៀ -> ea
            expect(romanizeKhmerName('កែវ')).toBe('Keo') // ែវ -> eo
            expect(romanizeKhmerName('កែ')).toBe('Ke') // open ែ -> e
            expect(romanizeKhmerName('កែក')).toBe('Kaek') // ែ before another final keeps ae
            expect(romanizeKhmerName('ញឹម')).toBe('Nhim') // initial ញ -> nh
            expect(romanizeKhmerName('បញ្ញា', { plain: true })).toBe('Panha') // ញ្ញ stays nh
            expect(romanizeKhmerName('បញ្ញា')).toBe('Banha') // not "Bnhha" (ញ + ញ្ញ)
            expect(createDefaultTransliterator().transliterate('បញ្ញា').value).toBe('Panha') // dictionary wins
        })

        it('applies the round-2 consonant and vowel rules', () => {
            expect(romanizeKhmerName('ឆាក')).toBe('Chhak') // ឆ -> chh
            expect(romanizeKhmerName('ឌីណា')).toBe('Dina') // ឌ -> d
            expect(romanizeKhmerName('បូរ៉ា')).toBe('Bora') // word-initial ប -> b
            expect(romanizeKhmerName('ប៉ុក')).toBe('Pok') // ប៉ is /p/
            expect(romanizeKhmerName('ប្រាក់')).toBe('Prak') // ប + subscript keeps p
            expect(romanizeKhmerName('កែប')).toBe('Kaeb') // word-final ប -> b
            expect(romanizeKhmerName('ចន្ធា')).toBe('Chanthea') // final open ា after ធ -> ea
            expect(romanizeKhmerName('ខឹម')).toBe('Khim') // ឹ stays i (e measured worse)
        })

        it('applies the round-3 rules', () => {
            expect(romanizeKhmerName('សំណាង')).toBe('Samnang') // សំ -> sam
            expect(romanizeKhmerName('ធារ៉ា')).toBe('Theara') // inner ា after ធ -> ea
            expect(romanizeKhmerName('ឆៃ')).toBe('Chhay') // final ៃ -> ay
            expect(romanizeKhmerName('តាំង')).toBe('Taing') // ាំង -> aing
            expect(romanizeKhmerName('កុយ')).toBe('Koy') // ុយ -> oy
            expect(romanizeKhmerName('ណូយ')).toBe('Nouy') // ូយ stays ouy
            expect(romanizeKhmerName('ជិន')).toBe('Chin') // ិ stays i (e measured worse)
        })

        it('applies the round-4 rules', () => {
            expect(romanizeKhmerName('វិចិត្រ')).toBe('Vichet') // ិត្រ -> et (no -th)
            expect(romanizeKhmerName('សុចិត្រា')).toBe('Sochetra')
            expect(romanizeKhmerName('វឌ្ឍនៈ')).toBe('Vathanak') // ឌ្ឍ inside a word -> tha
            expect(romanizeKhmerName('សុភា')).toBe('Sophea') // word-final ភា -> phea
            expect(romanizeKhmerName('ជូ')).toBe('Chou') // open ូ after o-series -> ou
            expect(romanizeKhmerName('សូ')).toBe('So') // ... after a-series stays o
            expect(romanizeKhmerName('សែន')).toBe('Sen') // ែ before ន -> e
            expect(createTransliterator().transliterate('ហ៊ុន សែន').candidates).toContain('Hun Saen') // ae kept
        })

        it('keeps the plain reading available', () => {
            expect(romanizeKhmerName('សារ៉េត កែវ ចៅ', { plain: true })).toBe('Saret Kaev Chov')
            const r = createTransliterator().transliterate('សារ៉េត')
            expect(r.value).toBe('Sareth')
            expect(r.candidates).toContain('Saret')
        })

        it('offers final "ou" for final "o"', () => {
            expect(createTransliterator().transliterate('សូ').candidates).toContain('Sou')
        })
    })

    describe('learned alternations', () => {
        // ឡាវ / កង read "Lav" / "Kang" by the rules (no dictionary here)
        const table: LearnedRule[] = [
            ['', 'v', 'o', '$', 0.6],
            ['', 'a', 'or', 'n', 0.4],
            ['k', 'a', '', '', 0.3],
            ['', 'a', 'e', '', 0.1],
        ]

        it('ranks rewrites by learned probability, deterministically', () => {
            const alt = createLearnedAlternator(table)
            expect(alt.alternates('lav', 5)).toEqual([
                { value: 'lao', p: 0.6 },
                { value: 'lev', p: 0.1 },
                { value: 'leo', p: 0.06 },
            ])
            expect(alt.alternates('kang', 5).map((a) => a.value)).toEqual(['korng', 'keng'])
            expect(createLearnedAlternator(table).alternates('kang', 5)).toEqual(alt.alternates('kang', 5))
        })

        it('never offers the input, a vowelless word, or rewrites of an empty reading', () => {
            const alt = createLearnedAlternator(table)
            expect(alt.alternates('kang', 10).map((a) => a.value)).not.toContain('kng')
            expect(alt.alternates('kang', 10).map((a) => a.value)).not.toContain('kang')
            expect(createLearnedAlternator([['^', '', 'h', '$', 0.9]]).alternates('', 5)).toEqual([])
        })

        it('adds learned spellings below the rules reading without changing value', () => {
            const plain = createTransliterator().transliterate('ឡាវ កង')
            const learned = createTransliterator({ learnedAlternations: table }).transliterate('ឡាវ កង')
            expect(learned.value).toBe(plain.value)
            expect(learned.value).toBe('Lav Kang')
            expect(learned.tokens[0].alternatives[0]).toBe('Lao')
            expect(learned.candidates).toEqual(expect.arrayContaining(['Lao Kang', 'Lav Korng']))
        })

        it('respects the per-token cap', () => {
            const count = (n: number) =>
                createTransliterator({ learnedAlternations: table, maxLearnedAlternates: n })
                    .transliterate('ឡាវ')
                    .tokens[0].alternatives.length
            expect(count(0)).toBe(0)
            expect(count(1)).toBe(1)
            expect(count(2)).toBe(2)
        })

        it('ships a table the default transliterator uses', () => {
            expect(defaultLearnedAlternations.length).toBeGreaterThan(0)
            expect(defaultLearnedAlternations.every(([, , , , p]) => p > 0 && p < 1)).toBe(true)
            const plain = createTransliterator({})
            const name = 'ឡាវ កង'
            const withTable = createDefaultTransliterator().transliterate(name)
            expect(withTable.candidates.length).toBeGreaterThan(plain.transliterate(name).candidates.length)
            expect(createDefaultTransliterator({ maxLearnedAlternates: 0 }).transliterate(name).candidates)
                .toEqual(createDefaultTransliterator({ learnedAlternations: [] }).transliterate(name).candidates)
        })
    })
})
