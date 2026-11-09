/**
 * Learns local rewrite rules from (rules reading -> official spelling)
 * pairs. Used per fold by eval-kfold.mjs (train folds only) and once by
 * learn-alternations.mjs for the shipped table (whole dev split).
 *
 * For each 1:1-aligned (Khmer word, official Latin word) pair:
 *   1. guess = the engine's rules reading of the word
 *   2. Levenshtein-align guess -> official; each maximal run of
 *      non-matching ops is one edit (from -> to)
 *   3. the edit yields up to four rules, one per context level:
 *      left+right char, left only, right only, none ('^'/'$' mark the
 *      word boundary)
 * A rule's probability is successes / (opportunities + ALPHA): how often
 * the official spelling makes this rewrite where the pattern occurs in a
 * training guess. Every distinct (Khmer word, spelling) pair counts once,
 * so a frequent name cannot dominate the table.
 */
import { romanizeKhmerName } from '../../dist/index.js'
import { countAttestations } from './corpus-tools.mjs'

export const DEFAULTS = { alpha: 1, minSuccess: 2, minP: 0.05 }

/** The engine's PLAIN rules reading of one token (what the learned table
 *  rewrites — see transliterate.ts), lower-case, syllables joined. */
export const rulesGuess = (token) => romanizeKhmerName(token, { plain: true }).split(/ +/).join('').toLowerCase()

/** Distinct 1:1 (khmer token, lower-case latin word) pairs, tail-runs excluded. */
export const trainingPairs = (rows) => {
    const out = []
    for (const [khmer, spellings] of countAttestations(rows)) {
        for (const [latin, hit] of spellings) {
            if (hit.tail) continue
            const word = latin.toLowerCase()
            if (!/^[a-z]+$/.test(word)) continue
            out.push({ khmer, latin: word })
        }
    }
    return out.sort((a, b) => (a.khmer + a.latin).localeCompare(b.khmer + b.latin))
}

/** Maximal non-matching runs of a Levenshtein alignment: [{ start, end, to }]
 *  over `src` positions. Ties prefer substitution, then deletion. */
export const alignEdits = (src, tgt) => {
    const n = src.length
    const m = tgt.length
    const d = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
    for (let i = 0; i <= n; i++) d[i][0] = i
    for (let j = 0; j <= m; j++) d[0][j] = j
    for (let i = 1; i <= n; i++)
        for (let j = 1; j <= m; j++)
            d[i][j] = Math.min(d[i - 1][j - 1] + (src[i - 1] === tgt[j - 1] ? 0 : 1), d[i - 1][j] + 1, d[i][j - 1] + 1)
    // backtrace into ops, last to first
    const ops = []
    let i = n
    let j = m
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (src[i - 1] === tgt[j - 1] ? 0 : 1)) {
            ops.push({ i: i - 1, from: src[i - 1], to: tgt[j - 1], same: src[i - 1] === tgt[j - 1] })
            i--, j--
        } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
            ops.push({ i: i - 1, from: src[i - 1], to: '', same: false })
            i--
        } else {
            ops.push({ i, from: '', to: tgt[j - 1], same: false })
            j--
        }
    }
    ops.reverse()
    const edits = []
    let cur = null
    for (const op of ops) {
        if (op.same) {
            cur = null
            continue
        }
        if (!cur) {
            cur = { start: op.i, end: op.i, to: '' }
            edits.push(cur)
        }
        cur.end = op.i + op.from.length
        cur.to += op.to
    }
    return edits
}

const contexts = (padded, s, e) => {
    const L = padded[s - 1]
    const R = padded[e]
    const from = padded.slice(s, e)
    const out = [[L, R], [L, ''], ['', R]]
    if (from) out.push(['', ''])
    return out.map(([l, r]) => [l, from, r])
}

/**
 * Learn a rule table from training pairs.
 * Returns [[left, from, to, right, p], ...] sorted for stable output.
 */
export const learnRules = (pairs, opts = {}) => {
    const { alpha, minSuccess, minP } = { ...DEFAULTS, ...opts }
    const success = new Map() // key l|from|to|r -> count
    const guesses = []
    for (const { khmer, latin } of pairs) {
        const guess = rulesGuess(khmer)
        if (!guess || !/^[a-z]+$/.test(guess)) continue
        const padded = `^${guess}$`
        guesses.push(padded)
        if (guess === latin) continue
        const seen = new Set()
        for (const ed of alignEdits(guess, latin)) {
            for (const [l, from, r] of contexts(padded, ed.start + 1, ed.end + 1)) {
                const key = `${l}|${from}|${ed.to}|${r}`
                if (seen.has(key)) continue
                seen.add(key)
                success.set(key, (success.get(key) ?? 0) + 1)
            }
        }
    }
    // opportunities: every occurrence of left+from+right in a guess
    const patterns = new Map()
    for (const key of success.keys()) {
        const [l, from, , r] = key.split('|')
        patterns.set(l + from + r, 0)
    }
    for (const padded of guesses) {
        for (const pattern of patterns.keys()) {
            let at = padded.indexOf(pattern)
            while (at !== -1) {
                patterns.set(pattern, patterns.get(pattern) + 1)
                at = padded.indexOf(pattern, at + 1)
            }
        }
    }
    const rules = []
    for (const [key, s] of success) {
        if (s < minSuccess) continue
        const [l, from, to, r] = key.split('|')
        const p = s / (patterns.get(l + from + r) + alpha)
        if (p < minP) continue
        rules.push([l, from, to, r, +p.toFixed(3)])
    }
    return rules.sort((a, b) => a.slice(0, 4).join('|').localeCompare(b.slice(0, 4).join('|')))
}
