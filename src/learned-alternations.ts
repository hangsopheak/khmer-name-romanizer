/**
 * Learned spelling alternations for words the dictionary does not know.
 *
 * The rule engine's reading of an unknown word is often a few letters
 * away from the official spelling (Lav -> Lao, Kang -> Korng). A learned
 * table of local rewrites, each with the probability that the official
 * spelling makes that rewrite where the pattern occurs in a rules
 * reading, turns that reading into ranked extra candidates.
 *
 * A rule is [left, from, to, right, p]: in the reading padded as
 * `^word$`, an occurrence of `from` with `left` just before it and
 * `right` just after it becomes `to` (left/right are context, kept as
 * is; '' means any context). The table is produced by
 * scripts/learn-alternations.mjs from aligned corpus pairs.
 */

/** [left context, from, to, right context, probability] */
export type LearnedRule = readonly [string, string, string, string, number]

export interface LearnedAlternate {
    value: string
    /** Product of the applied rules' probabilities. */
    p: number
}

interface Edit {
    start: number
    end: number
    to: string
    p: number
}

export interface LearnedAlternator {
    /** Up to `limit` rewrites of a lower-case rules reading, best first
     *  (never includes the input). */
    alternates: (word: string, limit: number) => LearnedAlternate[]
}

/** Two-edit candidates multiply probabilities; this floor drops the
 *  long tail before ranking. */
const MIN_CANDIDATE_P = 0.02

export function createLearnedAlternator(rules: readonly LearnedRule[]): LearnedAlternator {
    // Index by the full pattern (left + from + right) so a lookup per
    // substring of the padded word finds every rule that can fire there.
    const byPattern = new Map<string, LearnedRule[]>()
    let maxLen = 0
    for (const rule of rules) {
        const pattern = rule[0] + rule[1] + rule[3]
        if (!pattern) continue
        const list = byPattern.get(pattern)
        if (list) list.push(rule)
        else byPattern.set(pattern, [rule])
        maxLen = Math.max(maxLen, pattern.length)
    }

    const editsOf = (padded: string): Edit[] => {
        // Same edit (span + replacement) reached through several contexts:
        // keep its best-supported probability.
        const best = new Map<string, Edit>()
        for (let i = 0; i < padded.length; i++) {
            for (let len = 1; len <= maxLen && i + len <= padded.length; len++) {
                const matches = byPattern.get(padded.slice(i, i + len))
                if (!matches) continue
                for (const [left, from, to, , p] of matches) {
                    const start = i + left.length
                    const edit = { start, end: start + from.length, to, p }
                    const key = `${edit.start}:${edit.end}:${to}`
                    if ((best.get(key)?.p ?? 0) < p) best.set(key, edit)
                }
            }
        }
        // Edits may not touch the ^ / $ boundary markers themselves.
        return [...best.values()].filter((e) => e.start >= 1 && e.end <= padded.length - 1)
    }

    const apply = (padded: string, edits: Edit[]): string => {
        let out = padded
        for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.to + out.slice(e.end)
        return out.slice(1, -1)
    }

    const cache = new Map<string, LearnedAlternate[]>()

    const all = (word: string): LearnedAlternate[] => {
        const hit = cache.get(word)
        if (hit) return hit
        const padded = `^${word}$`
        const edits = editsOf(padded)
        const scored = new Map<string, number>()
        const offer = (value: string, p: number) => {
            // A name word always keeps a vowel letter ("Kang" -> "Kng" is junk).
            if (value === word || !/[aeiouy]/.test(value) || p < MIN_CANDIDATE_P) return
            if ((scored.get(value) ?? 0) < p) scored.set(value, p)
        }
        for (const e of edits) offer(apply(padded, [e]), e.p)
        for (let a = 0; a < edits.length; a++) {
            for (let b = a + 1; b < edits.length; b++) {
                const [x, y] = edits[a].start <= edits[b].start ? [edits[a], edits[b]] : [edits[b], edits[a]]
                // Disjoint spans only; two insertions at one point are ambiguous.
                if (x.end > y.start || (x.start === y.start && x.end === y.end)) continue
                offer(apply(padded, [x, y]), x.p * y.p)
            }
        }
        const ranked = [...scored.entries()]
            .map(([value, p]) => ({ value, p }))
            .sort((a, b) => b.p - a.p || a.value.localeCompare(b.value))
        if (cache.size >= 5000) cache.clear()
        cache.set(word, ranked)
        return ranked
    }

    return {
        // An empty reading (a stray mark) is no word: nothing to rewrite.
        alternates: (word, limit) => (word && limit > 0 && byPattern.size ? all(word.toLowerCase()).slice(0, limit) : []),
    }
}
