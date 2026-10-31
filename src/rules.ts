/**
 * Rule-based Khmer script -> Latin transliteration, tuned for Cambodian
 * personal names (passport/roster style romanization).
 *
 * Calibrated against real Khmer <-> English name pairs from university
 * rosters. Khmer name romanization is inherently one-to-many, so outputs
 * are consistent approximations rather than authoritative spellings.
 */

const CONS: Record<string, string> = {
    'ក': 'k', 'ខ': 'kh', 'គ': 'k', 'ឃ': 'kh', 'ង': 'ng',
    'ច': 'ch', 'ឆ': 'ch', 'ជ': 'ch', 'ឈ': 'chh', 'ញ': 'n',
    'ដ': 'd', 'ឋ': 'th', 'ឌ': 't', 'ឍ': 'th', 'ណ': 'n',
    'ត': 't', 'ថ': 'th', 'ទ': 't', 'ធ': 'th', 'ន': 'n',
    'ប': 'p', 'ផ': 'ph', 'ព': 'p', 'ភ': 'ph', 'ម': 'm',
    'យ': 'y', 'រ': 'r', 'ល': 'l', 'វ': 'v', 'ស': 's',
    // obsolete Sanskrit sibilants used in Angkorian/regnal names
    // (ឝ្រុត Shruta, ឝម្ភុវម៌្ម Shambhuvarman, ហ Shapiro៌ Harshavarman, បុ Shapiro្ករាក្ស Pushkaraksha);
    // ឞ has no corpus attestation — 'sh' by analogy (Sanskrit sa)
    'ឝ': 'sh', 'ឞ': 'sh',
    'ហ': 'h', 'ឡ': 'l', 'អ': ''
}

const VOWELS: Record<string, string> = {
    'ា': 'a', 'ិ': 'i', 'ី': 'i', 'ឹ': 'i', 'ឺ': 'eu',
    'ុ': 'o', 'ូ': 'u', 'ួ': 'uo', 'ឿ': 'oeu', 'ៀ': 'ie',
    'េ': 'e', 'ែ': 'ae', 'ៃ': 'ai', 'ោ': 'o', 'ៅ': 'ov', '័': 'a', 'ើ': 'oeu'
}

const INDEPENDENT_VOWELS: Record<string, string> = {
    'ឥ': 'i', 'ឦ': 'ei', 'ឧ': 'o', 'ឩ': 'ou', 'ឪ': 'ov', 'ឫ': 'rue', 'ឬ': 'rueu',
    'ឭ': 'lue', 'ឮ': 'lueu', 'ឯ': 'e', 'ឰ': 'ai', 'ឱ': 'ao', 'ឳ': 'av'
}

/**
 * Consonants whose bare inherent vowel romanizes as "o" in names. This is
 * an empirical calibration set, NOT the Khmer 2nd series (it contains the
 * 1st-series ស and ហ and omits គ ជ ទ ព ...).
 */
const INHERENT_O_CONSONANTS = new Set(['ង', 'ញ', 'ណ', 'ន', 'ម', 'យ', 'រ', 'ល', 'វ', 'ស', 'ហ', 'ឡ'])
/** Khmer 2nd-series (o-series) consonants: their ា reads "ea" (លាង leang, ភាព pheap, វាសនា veasna). */
const SECOND_SERIES_CONSONANTS = new Set(['គ', 'ឃ', 'ង', 'ជ', 'ឈ', 'ញ', 'ទ', 'ធ', 'ន', 'ព', 'ភ', 'ម', 'យ', 'រ', 'ល', 'វ'])
const SONORANTS = new Set(['ង', 'ញ', 'ន', 'ម', 'យ', 'រ', 'ល', 'វ'])
const KILLING_MARKS = new Set(['\u17cb', '\u17cc', '\u17ce'])
const REGISTER_MARKS = new Set(['\u17c9', '\u17ca', '\u17cd', '\u17cf', '\u17d1'])
/** Both register shifters; they move in opposite directions (see below). */
const SERIES_SHIFT_MARKS = new Set(['\u17c9', '\u17ca'])
/** ៉ muusikatoan: 2nd-series consonant -> 1st series (ម៉ា ma, រ៉ា ra). */
const MUUSIKATOAN = '\u17c9'
/** ៊ triisap: 1st-series consonant -> 2nd series (ប៊ bo, ហ៊ា hea). */
const TRIISAP = '\u17ca'
/** ៈ yuukaleapintu: short vowel + glottal stop, romanized "ak" (រតនៈ -> rotanak). */
const YUUKALEAPINTU = '\u17c8'
const NIKAHIT = 'ំ'
const COENG = '\u17d2'

/**
 * Normalizes source-roster noise: zero-width chars removed, and ASCII ':'
 * mapped to ៈ — rosters type a colon for the look-alike yuukaleapintu
 * (វីរ:បុត្រ is វីរៈបុត្រ "Virakboth", វណ្ណ: is វណ្ណៈ "Vannak").
 */
export function normalizeKhmerText(input: string): string {
    return input.replace(/[\u200b\u200c]/g, '').replace(/:/g, YUUKALEAPINTU)
}

function isConsonant(ch: string): boolean {
    return ch in CONS
}

function isVowelSign(ch: string): boolean {
    return ch in VOWELS
}

function finalSound(consonant: string): string {
    if ('កខគឃ'.includes(consonant)) return 'k'
    if ('តថទធដឋឌឍ'.includes(consonant)) return 't'
    if ('បផពភ'.includes(consonant)) return 'p'
    if ('ជឈចឆ'.includes(consonant)) return 'ch'
    if (consonant === 'ង') return 'ng'
    if (consonant === 'យ') return 'y'
    return CONS[consonant]
}

/**
 * Transliterate a Khmer string to Latin, syllable by syllable.
 * Handles coeng (subscript) clusters, register marks, inherent vowels,
 * and common name-final consonant reductions.
 */
export function romanizeKhmer(input: string): string {
    const s = normalizeKhmerText(input)
    const out: string[] = []
    let i = 0
    const n = s.length

    while (i < n) {
        const ch = s[i]
        if (ch === ' ') {
            if (out.length > 0 && !out[out.length - 1].endsWith(' ')) out.push(' ')
            i++
            continue
        }
        if (ch in INDEPENDENT_VOWELS) {
            let syllable = INDEPENDENT_VOWELS[ch]
            i++
            // A lone word-final consonant closes the syllable (ឯម -> em, ឯក -> ek)
            if (i < n && isConsonant(s[i]) && (i + 1 >= n || s[i + 1] === ' ')) {
                syllable += finalSound(s[i])
                i++
            }
            out.push(syllable)
            continue
        }
        if (!isConsonant(ch)) {
            // Latin letters, digits and name-safe punctuation pass through
            // unchanged: mixed-script input ("សុភ REAL 1987") keeps its
            // Latin part instead of silently losing it.
            if (/[A-Za-z0-9.'-]/.test(ch)) out.push(ch)
            i++
            continue
        }

        let base = CONS[ch]
        i++
        // ប + triisap is the voiced "b" (ប៊ុន -> bun)
        if (ch === 'ប' && s[i] === TRIISAP) base = 'b'

        let cluster = ''
        const clusterConsonants: string[] = []
        while (i < n && s[i] === COENG && i + 1 < n && isConsonant(s[i + 1])) {
            if (ch === 'ហ' && s[i + 1] === 'វ') {
                // ហ្វ reads "f" (ហ្វុង -> fong); ហ is only a carrier
                cluster += 'f'
                base = ''
            } else if (ch === 'ហ' && s[i + 1] === 'ស') {
                // ហ្ស reads "j/zh" (ហ្សង់ -> Jong)
                cluster += 'j'
                base = ''
            } else if (s[i + 1] === ch) {
                // Geminate subscript (ក្ក, ស្ស, ជ្ជ, ណ្ណ ...): Khmer doubles the
                // consonant but names romanize it single. ញ្ញ is the notable
                // exception, read "nh".
                if (ch === 'ញ') cluster += 'h'
            } else {
                cluster += CONS[s[i + 1]]
            }
            clusterConsonants.push(s[i + 1])
            i += 2
        }

        let seriesShift = false
        let muusikatoan = false
        let triisap = false
        while (i < n && REGISTER_MARKS.has(s[i])) {
            if (SERIES_SHIFT_MARKS.has(s[i])) seriesShift = true
            if (s[i] === MUUSIKATOAN) muusikatoan = true
            if (s[i] === TRIISAP) triisap = true
            i++
        }
        // In a cluster the vowel follows the subscript's series unless the
        // subscript is a sonorant (ង ញ ន ម យ រ ល វ), which follows the base.
        const lastSub = clusterConsonants[clusterConsonants.length - 1]
        const seriesOf = lastSub && !SONORANTS.has(lastSub) ? lastSub : ch
        const secondSeries = (SECOND_SERIES_CONSONANTS.has(seriesOf) && !muusikatoan) || triisap
        const wordInitial = out.length === 0 || out[out.length - 1].endsWith(' ')
        const inherentO = INHERENT_O_CONSONANTS.has(ch) || seriesShift


        let vow = ''
        if (i < n && isVowelSign(s[i])) {
            vow = s[i]
            i++
        }

        if (vow === '' && s[i] === YUUKALEAPINTU) {
            // bare consonant + ៈ -> short "a" + glottal "k" (នៈ -> nak)
            out.push(base + cluster + 'ak')
            i++
            continue
        }

        let final = ''
        let killedFinal = false
        let geminateFinal = false
        if (i < n && s[i] === COENG && i + 1 < n && isConsonant(s[i + 1])) {
            final = CONS[s[i + 1]]
            i += 2
            while (i < n && (isVowelSign(s[i]) || KILLING_MARKS.has(s[i]) || s[i] === NIKAHIT || REGISTER_MARKS.has(s[i]))) {
                i++
            }
        } else if (i < n && isConsonant(s[i])) {
            const candidate = s[i]
            let j = i + 1
            while (j < n && (KILLING_MARKS.has(s[j]) || REGISTER_MARKS.has(s[j]) || s[j] === COENG)) {
                if (s[j] === COENG && j + 1 < n && isConsonant(s[j + 1])) j += 2
                else {
                    if (KILLING_MARKS.has(s[j])) killedFinal = true
                    j++
                }
            }
            // A candidate followed by a consonant + coeng opens its own closed
            // syllable (បញ្ញាវន្ត -> panha-voant), so it is not our final.
            const opensClosedSyllable =
                j === i + 1 && j + 1 < n && isConsonant(s[j]) && s[j + 1] === COENG
            // ណ្ណ before a vowel is ambisyllabic: it closes this syllable AND
            // opens the next (វណ្ណា -> vanna, សុវណ្ណារ៉ា -> sovannara)
            const geminateNn = candidate === 'ណ' && s[i + 1] === COENG && s[i + 2] === 'ណ'
            const ambisyllabicNn = geminateNn && j < n && (isVowelSign(s[j]) || s[j] === YUUKALEAPINTU)
            if (ambisyllabicNn) {
                final = 'n'
                geminateFinal = true
            } else if (geminateNn && (j >= n || s[j] === ' ')) {
                // word-final ណ្ណ keeps the double "nn" (សុវណ្ណ -> sovann, វណ្ណ -> vann)
                final = 'nn'
                geminateFinal = true
                i = j
            } else if (j < n && (isVowelSign(s[j]) || s[j] === YUUKALEAPINTU || opensClosedSyllable)) {
                // candidate is the initial of the next syllable, not a final
            } else {
                final = finalSound(candidate)
                // inherent vowel before ណ្ណ is "a" (សុវណ្ណថា -> sovantha)
                if (geminateNn) geminateFinal = true
                if (candidate === 'យ' && vow === 'ុ') final = 'y'
                i = j
            }
        } else if (i < n && s[i] === NIKAHIT) {
            if (vow !== '') {
                final = 'm'
                killedFinal = true
                i++
                if (i < n && s[i] === 'ង') {
                    final = 'ng'
                    i++
                }
            } else {
                const inherent = inherentO ? 'o' : 'a'
                out.push(base + cluster + inherent + 'm')
                i++
                continue
            }
        }

        while (i < n && (KILLING_MARKS.has(s[i]) || REGISTER_MARKS.has(s[i]))) {
            i++
        }

        let syllable: string
        if (vow === '') {
            if (final !== '') {
                // inherent vowel before a final: 2nd-series consonants read "o"
                // before ង (គង់ -> kong, ពង្ស -> pong) while 1st-series ones keep
                // "a" (ហង្ស -> hang); otherwise the regular inherent (ចន -> chan)
                const inherent = final === 'ng'
                    ? (secondSeries ? 'o' : 'a')
                    : geminateFinal ? 'a' : inherentO ? 'o' : 'a'
                syllable = base + cluster + inherent + final
            } else {
                const inherent = inherentO ? 'o' : 'a'
                syllable = base + cluster + inherent
            }
        } else {
            let v = VOWELS[vow]
            if (vow === 'ុ' && (final === 'n' || final === 'm')) v = 'u'
            // open ូ reads "o" in names (សូ so, បូ bo, ហូ ho, សូរិយា soriya)
            // ូ reads "o" when open (សូ so, បូ bo, សូរិយា soriya) and "ou" when
            // closed (ទូច touch, ឡូត lout)
            if (vow === 'ូ') v = final === '' ? 'o' : 'ou'
            if (vow === 'ុ' && final === 'y') v = 'ou'
            // ើ reads "oeu" when closed (កើត Koeut, រើន Roeun, កើស Koeus,
            // ឆ្នើម Chhnoeum — both series) and "eu" when open (កើ Keuky)
            if (vow === 'ើ') v = final === '' ? 'eu' : 'oeu'
            if (vow === '័') v = inherentO ? 'o' : 'a'
            // muusikatoan-shifted ែ reads "e" in names, not "ae": ង៉ែត Nget,
            // ញ៉ែម Nhem, ប៉ែត Pet, យ៉ែម Yem — and e-spellings dominate ប៉ែន
            // attestations too (Penn/Pen vs Pan)
            if (vow === 'ែ' && muusikatoan) v = 'e'
            // ័ + final ក after a 2nd-series consonant reads "eak" (សុភ័ក្ត ->
            // sopheak, ល័ក្ខណ៍ -> leak)
            if (vow === '័' && final === 'k' && secondSeries) v = 'ea'
            if (vow === 'ី' && (cluster.endsWith('r') || cluster.endsWith('m'))) v = 'ey'
            // ា after a 2nd-series consonant reads "ea" in closed syllables and
            // monosyllables (ជា chea, លាង leang, ភាព pheap, ហ៊ាង heang) but
            // stays "a" after 1st-series ones (ណាង nang, ហាង hang, ម៉ា ma),
            // before killed/nikahit finals (តាំង tang) and in open non-initial
            // syllables (ដារា dara, វាសនា veasna)
            const wordFinal = i >= n || s[i] === ' '
            const closed = final !== '' || (wordInitial && wordFinal)
            // ជា is "chea" even in open syllables (សុជាតា, ច័ន្ទវិជ្ជា) — 7/7 in gold
            if (vow === 'ា' && secondSeries && !killedFinal && (closed || seriesOf === 'ជ')) {
                v = 'ea'
            }
            syllable = base + cluster + v + final
        }
        out.push(syllable)
    }

    return out.join('').trim()
}

/**
 * Transliterate a Khmer full name and capitalize each part
 * (e.g. "កែ ប៊ុនឡុង" -> "Kae Bunlong").
 */
export function romanizeKhmerName(name: string): string {
    return romanizeKhmer(name)
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
}
