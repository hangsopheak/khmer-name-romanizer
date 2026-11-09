/**
 * Plain Indic (Sanskrit/Pali) reading for regnal names — the second
 * reading for the rules tier, beside the French-style one.
 *
 * Angkorian/regnal names (bucket "unknown") are Sanskrit or Pali
 * compounds whose official romanizations transliterate the SANSKRIT
 * form, not the Khmer pronunciation: មហេន្ទ្រវម៌្ម is Mahendravarman,
 * not the Khmer reading "Mohenvom". The grapheme mapping is systematic:
 *
 *   - voiced series kept voiced: ទ→d គ→g ជ→j ព→b (Khmer readings
 *     devoice: ទ→t in Taing...)
 *   - inherent "a" between adjacent consonants and word-finally
 *     (មហេន្ទ្រ → mahendra, កៅណ្ឌិន្យ → kaundinya)
 *   - វម៌្ម / វរ្ម័ន suffix → "varman"
 *   - ឝ→s (Srindravarman), ក្ឝ (ក + subscript ឝ) = kṣ → "ksh"
 *     (លក្ឝ្មី → lakshmi), subscript វ → b (កម្វុជ → Kambuja),
 *     ន្ឫ → nri
 *   - ឧ→u ឥ→i (Khmer reads o/e: ឧទ័យ → Outey / Udaya)
 *
 * The reading is emitted as one extra candidate for tokens that look
 * Indic (`looksIndic`), always below the Khmer readings: a modern name
 * keeps its Khmer spellings first, and the Indic spelling only competes
 * for the lower candidate slots.
 *
 * All characters are built from code points verified against
 * src/rules.ts and the corpus: literal combining marks do not survive
 * every editor round-trip (COENG once landed as U+17B4 — the tests
 * catch it).
 */

const CH = (hex: number) => String.fromCodePoint(hex)
const COENG = CH(0x17d2) // subscript marker
const SHA = CH(0x179d) // ឝ obsolete sibilant (data layout: ស is 17a0+; see rules.ts)
const SSHA = CH(0x179e) // ឞ
const ROBAT = CH(0x17cc) // ៌
const K = CH(0x1780) // ក
const VA = CH(0x179c) // វ
const N = CH(0x1793) // ន
const IRU = CH(0x17ab) // ឫ
const VARMAN_OLD = CH(0x179c) + CH(0x1798) + CH(0x17cc) + COENG + CH(0x1798) // វម៌្ម
const VARMAN_NEW = CH(0x179c) + CH(0x179a) + COENG + CH(0x1798) + CH(0x17d0) + CH(0x1793) // វរ្ម័ន

const CONS: Record<string, string> = {
    [CH(0x1780)]: 'k', [CH(0x1781)]: 'kh', [CH(0x1782)]: 'g', [CH(0x1783)]: 'gh', [CH(0x1784)]: 'ng',
    [CH(0x1785)]: 'ch', [CH(0x1786)]: 'ch', [CH(0x1787)]: 'j', [CH(0x1788)]: 'jh', [CH(0x1789)]: 'n',
    [CH(0x178a)]: 'd', [CH(0x178b)]: 'th', [CH(0x178c)]: 'd', [CH(0x178d)]: 'dh', [CH(0x178e)]: 'n',
    [CH(0x178f)]: 't', [CH(0x1790)]: 'th', [CH(0x1791)]: 'd', [CH(0x1792)]: 'dh', [CH(0x1793)]: 'n',
    [CH(0x1794)]: 'p', [CH(0x1795)]: 'ph', [CH(0x1796)]: 'b', [CH(0x1797)]: 'bh', [CH(0x1798)]: 'm',
    [CH(0x1799)]: 'y', [CH(0x179a)]: 'r', [CH(0x179b)]: 'l', [CH(0x179c)]: 'v', [CH(0x179f)]: 's',
    [CH(0x179d)]: 's', [CH(0x179e)]: 'sh', [CH(0x17a0)]: 'h', [CH(0x17a1)]: 'l', [CH(0x17a2)]: '',
}

const VOW: Record<string, string> = {
    [CH(0x17b6)]: 'a', [CH(0x17b7)]: 'i', [CH(0x17b8)]: 'i', [CH(0x17b9)]: 'ri', [CH(0x17ba)]: 'e',
    [CH(0x17bb)]: 'u', [CH(0x17bc)]: 'u', [CH(0x17bd)]: 'ua', [CH(0x17be)]: 'o', [CH(0x17bf)]: 'oe',
    [CH(0x17c0)]: 'ia', [CH(0x17c1)]: 'e', [CH(0x17c2)]: 'e', [CH(0x17c3)]: 'ai', [CH(0x17c4)]: 'o',
    [CH(0x17c5)]: 'au', [CH(0x17d0)]: 'a',
}

const INDEP: Record<string, string> = {
    [CH(0x17a5)]: 'i', [CH(0x17a6)]: 'ai', [CH(0x17a7)]: 'u', [CH(0x17a9)]: 'u', [CH(0x17aa)]: 'o',
    [CH(0x17ab)]: 'ri', [CH(0x17ac)]: 'ri', [CH(0x17ad)]: 'li', [CH(0x17ae)]: 'li', [CH(0x17af)]: 'e',
    [CH(0x17b0)]: 'ai', [CH(0x17b1)]: 'o', [CH(0x17b3)]: 'au',
}

const KILL = new Set([CH(0x17cb), CH(0x17cd), CH(0x17ce)]) // ់ ៍ toandakhiat
const VOWEL_LETTER = /[aeiou]$/

/**
 * Tokens that get the Indic reading as a candidate. The markers are
 * letters modern names do not carry (obsolete sibilants, robat, the
 * varman suffixes, the kṣ and vocalic-r clusters) or an
 * independent-vowel word onset (ឧបាលិ Upali, ឧទ័យ Udaya). Measured
 * on the dev split: ~120 words, almost all regnal or Pali.
 */
export function looksIndic(word: string): boolean {
    if (!word) return false
    if (word.includes(SHA) || word.includes(SSHA) || word.includes(ROBAT)) return true
    if (word.endsWith(VARMAN_OLD) || word.endsWith(VARMAN_NEW)) return true
    if (word.includes(K + COENG + SHA)) return true // ក្ឝ = kṣ
    if (word.includes(N + COENG + IRU)) return true // ន្ឫ = nri
    const first = [...word][0]
    return first !== undefined && first in INDEP
}

/** One Khmer word → plain Indic latin reading (unmarked). */
export function indicReading(word: string): string {
    let w = word
    let suffix = ''
    if (w.endsWith(VARMAN_OLD)) {
        suffix = 'varman'
        w = w.slice(0, -VARMAN_OLD.length)
    } else if (w.endsWith(VARMAN_NEW)) {
        suffix = 'varman'
        w = w.slice(0, -VARMAN_NEW.length)
    }
    const chars = [...w]
    let out = ''
    let bare = false // last consonant still lacks a vowel
    const flush = () => {
        if (bare) {
            out += 'a'
            bare = false
        }
    }
    let i = 0
    while (i < chars.length) {
        const ch = chars[i]
        if (ch === COENG) {
            i++
            if (i >= chars.length) break
            const sub = chars[i]
            let piece = ''
            if (chars[i - 2] === K && sub === SHA) piece = 'sh' // ក្ឝ = kṣ
            else if (sub === VA) piece = 'b' // subscript វ reads 'b'
            else if (sub === IRU) piece = 'ri' // ន្ឫ = vocalic r
            else if (sub in CONS) piece = CONS[sub]
            if (piece) {
                out += piece
                // a cluster member ending in a vowel satisfies the
                // syllable; a consonantal one is a bare onset
                bare = !VOWEL_LETTER.test(piece)
            }
            i++
            continue
        }
        if (ch in CONS) {
            flush()
            out += CONS[ch]
            bare = CONS[ch] !== ''
            i++
            continue
        }
        if (ch in VOW) {
            out += VOW[ch]
            bare = false
            i++
            continue
        }
        if (ch in INDEP) {
            const v = INDEP[ch]
            if (VOWEL_LETTER.test(out)) {
                // ស្រីឥន្ទ្រ → Srindra: the same independent vowel
                // after a vowel elides
                if (!out.endsWith(v)) out += v
            } else {
                flush()
                out += v
            }
            i++
            continue
        }
        if (KILL.has(ch)) {
            bare = false
            i++
            continue
        }
        if (ch === CH(0x17c8) || ch === CH(0x17c7)) {
            // ៈ ះ read "a"
            out += 'a'
            bare = false
            i++
            continue
        }
        if (ch === CH(0x17c6)) {
            out += 'm'
            bare = false
            i++
            continue
        }
        i++ // register marks, leftovers
    }
    flush()
    return out + suffix
}
