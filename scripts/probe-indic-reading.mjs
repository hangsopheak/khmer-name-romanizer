#!/usr/bin/env node
/**
 * PROBE — Indic (Sanskrit/Pali) reading for regnal names (leftover F,
 * HANDOFF rounds 2–3). **SHIPPED** as src/indic.ts + the transliterator
 * wiring (2026-11-09): k-fold top-5 314 → 336 (+22/−0, p = 5e-7);
 * folds 0–2 +11/−0, confirm folds 3–4 +11/−0; exact 218 unchanged,
 * zero value changes (the reading only adds lower-ranked candidates);
 * regnal top-5 33 → 48. This file stays as the measurement record.
 *
 * The regnal bucket ("unknown") was the worst on the k-fold (18/186
 * exact, 33/186 top-5 at 0.6.0). Its misses are Sanskrit/Pali compounds
 * the Khmer rules read letter-by-letter (មហេន្ទ្រវម៌្ម → "Mohenvom" vs
 * the official "Mahendravarman"). The reading is a plain (unmarked)
 * Indic transliteration with inherent vowels; the prototype measured
 * 27 of 153 missed regnal rows exactly reachable, the engine wiring
 * realized 22 of them (the rest sit behind the per-token option cap).
 *
 * Run: node scripts/probe-indic-reading.mjs [rows.json]
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const COENG = String.fromCharCode(0x17d2)
const CONS = {
    'ក': 'k', 'ខ': 'kh', 'គ': 'g', 'ឃ': 'gh', 'ង': 'ng',
    'ច': 'ch', 'ឆ': 'ch', 'ជ': 'j', 'ឈ': 'jh', 'ញ': 'n',
    'ដ': 'd', 'ឋ': 'th', 'ឌ': 'd', 'ឍ': 'dh', 'ណ': 'n',
    'ត': 't', 'ថ': 'th', 'ទ': 'd', 'ធ': 'dh', 'ន': 'n',
    'ប': 'p', 'ផ': 'ph', 'ព': 'b', 'ភ': 'bh', 'ម': 'm',
    'យ': 'y', 'រ': 'r', 'ល': 'l', 'វ': 'v', 'ស': 's',
    'ឝ': 's', 'ឞ': 'sh', 'ហ': 'h', 'ឡ': 'l', 'អ': '',
}
const VOW = {
    'ា': 'a', 'ិ': 'i', 'ី': 'i', 'ឹ': 'ri', 'ឺ': 'e',
    'ុ': 'u', 'ូ': 'u', 'ួ': 'ua', 'ឿ': 'oe', 'ៀ': 'ia',
    'េ': 'e', 'ែ': 'e', 'ៃ': 'ai', 'ោ': 'o', 'ៅ': 'au', '័': 'a', 'ើ': 'o',
}
const INDEP = {
    'ឥ': 'i', 'ឦ': 'ai', 'ឧ': 'u', 'ឩ': 'u', 'ឪ': 'o',
    'ឫ': 'ri', 'ឬ': 'ri', 'ឭ': 'li', 'ឮ': 'li', 'ឯ': 'e', 'ឰ': 'ai', 'ឱ': 'o', 'ឳ': 'au',
}
const KILL = new Set(['\u17cb', '\u17cc', '\u17ce']) // ់ ៍ toandakhiat
const VOWEL_LETTER = /[aeiou]$/

/** one Khmer word → plain Indic latin reading */
export const indicReading = (word) => {
    let w = word
    let suffix = ''
    if (w.endsWith('វម៌្ម')) { suffix = 'varman'; w = w.slice(0, -'វម៌្ម'.length) }
    else if (w.endsWith('វរ្ម័ន')) { suffix = 'varman'; w = w.slice(0, -'វរ្ម័ន'.length) }
    const chars = [...w]
    let out = ''
    let bare = false // last consonant still lacks a vowel
    const flush = () => { if (bare) { out += 'a'; bare = false } }
    let i = 0
    while (i < chars.length) {
        const ch = chars[i]
        if (ch === COENG) {
            i++
            if (i >= chars.length) break
            const sub = chars[i]
            const khmer_a = String.fromCharCode(0x1780), khmer_sa = String.fromCharCode(0x179d),
                khmer_va = String.fromCharCode(0x179c), khmer_ri = String.fromCharCode(0x17ab)
            let piece
            if (chars[i - 2] === khmer_a && sub === khmer_sa) piece = 'sh' // ក្ស = Sanskrit kṣ (លក្ឝ្មី → lakshmi)
            else if (sub === khmer_va) piece = 'b' // subscript វ reads 'b' (កម្វុជ → Kambuja)
            else if (sub === khmer_ri) piece = 'ri' // ន្ឫ = vocalic r (Nripatendravarman)
            else if (sub in CONS) piece = CONS[sub]
            else piece = ''
            if (piece) {
                out += piece
                // a cluster member that ends in a vowel satisfies the syllable;
                // a consonantal one is a bare onset still needing a vowel
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
        if (ch in VOW) { out += VOW[ch]; bare = false; i++; continue }
        if (ch in INDEP) {
            // ស្រីឥន្ទ្រ → Srindra: an independent vowel after the same
            // vowel elides; after a consonant it opens a new syllable
            const v = INDEP[ch]
            if (VOWEL_LETTER.test(out)) { if (!out.endsWith(v)) out += v }
            else { flush(); out += v }
            i++
            continue
        }
        if (KILL.has(ch)) { bare = false; i++; continue } // inherent vowel killed
        if (ch === 'ៈ' || ch === 'ះ') { out += 'a'; bare = false; i++; continue }
        if (ch === 'ំ') { out += 'm'; bare = false; i++; continue }
        if (ch === 'ៈ') { out += 'a'; bare = false; i++; continue }
        i++ // register marks, robat (handled by the varman idiom), others
    }
    flush()
    return out + suffix
}

/* --- evaluate on missed regnal rows -------------------------------- */

const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '')
const file = resolve(process.cwd(), process.argv[2] ?? 'base.json')
const rows = JSON.parse(readFileSync(file, 'utf8'))
const missed = rows.filter((r) => !r.hit && !r.inTop5 && r.bucket === 'unknown')
let reach = 0
const lines = []
for (const r of missed) {
    const got = r.khmer.split(/\s+/).filter((w) => /^[\u1780-\u17ff]+$/.test(w)).map(indicReading).join('')
    const ok = norm(got) === norm(r.gold)
    if (ok) reach++
    if (lines.length < 60) lines.push(`${ok ? ' ✓' : '  '} ${r.khmer} → ${got}${ok ? '' : '   (gold ' + r.gold + ')'}`)
}
console.log(`regnal misses: ${missed.length} · covered exactly by prototype: ${reach}`)
console.log(lines.join('\n'))
