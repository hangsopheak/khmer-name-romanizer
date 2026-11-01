#!/usr/bin/env node
/**
 * Probe: syllable lexicon + compositor — evaluated 2026-11-01, NOT shipped.
 *
 * Question (Phase 5 in the original plan, "the big one"): can a syllable
 * lexicon learned from attested token pairs plus a product-scoring
 * compositor improve uncovered-token readings over the rule engine?
 *
 * Method (calibration-legal sources only: bundled dict + dev split):
 *   1. Split Khmer tokens into orthographic syllables (base consonant +
 *      coeng cluster + vowel sign + marks; bare base consonant attaches
 *      as coda when not word-initial).
 *   2. Harvest a position-aware syllable lexicon by aligning attested
 *      Latin to per-syllable rule readings (monotonic min-edit-distance
 *      chunking, 870 syllables from dict + dev).
 *   3. Compositor: per-syllable top-3 chunks by count, product scoring,
 *      leave-one-out on dev-uncovered tokens.
 *
 * Findings (2026-11-01):
 *   - Top-1: compositor LOSES to the rules (72 vs 76 exact of 248
 *     composable LOO tokens). The hand-calibrated rule engine is the
 *     better single guess; compositor readings must never become primary.
 *   - Candidate generation: the compositor's top-5 union with the rules
 *     reading reaches 107/248 tokens — real recall value, ONLY in the
 *     unseen-token scenario: against the counterfactual 5-fold pipeline
 *     the name-level top-5 ceiling is +61/726 rows (+8.4pp), with
 *     composition crowd-out likely halving it. Against the shipped
 *     pipeline (FST distill in-sample) the value is near zero.
 *   - Conclusion: T4.2's FST distillation absorbed most of the intended
 *     value (same token population, better readings: FST 88/288 vs rules
 *     67/288 on uncovered citizen tokens). Documented here instead of
 *     shipped (2026-11-01 decision); re-evaluate if the corpus grows
 *     several-fold (composable coverage 248/447 would rise).
 *
 * Usage: npm run build && node scripts/probe-syllable-compositor.mjs
 */
import { readFileSync } from 'node:fs'
import { createTransliterator, defaultTokenDict, defaultFstDistill } from '../dist/index.js'
import { romanizeKhmer } from '../dist/rules.js'
import { counterfactualDict, distillMapFor, isInDomain, passesHygiene, supportOf } from './lib/corpus-tools.mjs'

/* ---- syllable machinery (probe-grade) ---- */
const CONS = new Set('កខគឃងចឆជឈញដឋឌឍណតថទធនបផពភមយរលវសហឡអឝឞ'.split(''))
const COENG = '\u17d2'
const VOWEL_SIGNS = new Set('ាិីឹឺុូួឿៀេែៃោៅ័ើ'.split(''))
const MARKS = new Set(['ំ', '\u17c8', '\u17cb', '\u17cc', '\u17c9', '\u17ca', '\u17cd', '\u17ce', '\u17cf', '\u17d1'])

function splitSyllables(token) {
    const syllables = []
    let i = 0
    const n = token.length
    while (i < n) {
        const ch = token[i]
        if (!CONS.has(ch)) return null
        let j = i + 1
        let sawVowel = false
        while (j < n) {
            const c = token[j]
            if (c === COENG && j + 1 < n && CONS.has(token[j + 1])) { j += 2; continue }
            if (MARKS.has(c)) { j++; continue }
            if (VOWEL_SIGNS.has(c)) { sawVowel = true; j++; continue }
            break
        }
        const nextIsBase = j < n && CONS.has(token[j])
        if (sawVowel || syllables.length === 0 || !nextIsBase) {
            syllables.push(token.slice(i, j))
            i = j
        } else {
            syllables[syllables.length - 1] += token.slice(i, j)
            i = j
        }
    }
    return syllables
}

const ed = (a, b) => {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
    for (let j = 0; j <= b.length; j++) dp[0][j] = j
    for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++)
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    return dp[a.length][b.length]
}

/** Monotonic min-edit-distance chunking of latin over per-syllable rules readings. */
function alignChunks(latin, targets) {
    const L = latin.toLowerCase()
    const n = targets.length
    if (n === 0) return null
    const INF = 1e9
    const dp = Array.from({ length: n + 1 }, () => new Array(L.length + 1).fill(INF))
    const cut = Array.from({ length: n + 1 }, () => new Array(L.length + 1).fill(-1))
    dp[n][L.length] = 0
    for (let k = n - 1; k >= 0; k--) {
        for (let pos = L.length; pos >= 0; pos--) {
            let best = INF
            let bestCut = -1
            const maxLen = Math.min(L.length - pos, Math.max(3, targets[k].length + 2))
            for (let end = pos + 1; end <= L.length - (n - 1 - k) && end <= pos + maxLen; end++) {
                const chunk = L.slice(pos, end)
                const cost = ed(chunk, targets[k]) / Math.max(chunk.length, targets[k].length)
                if (dp[k + 1][end] < INF && cost + dp[k + 1][end] < best) {
                    best = cost + dp[k + 1][end]
                    bestCut = end
                }
            }
            dp[k][pos] = best
            cut[k][pos] = bestCut
        }
    }
    if (dp[0][0] >= INF) return null
    const chunks = []
    let pos = 0
    for (let k = 0; k < n; k++) {
        const end = cut[k][pos]
        chunks.push(L.slice(pos, end))
        pos = end
    }
    return chunks
}

const keyOf = (s, k) => (k === 0 ? '^' : '') + s

const harvest = (syllables, latin, store) => {
    const targets = syllables.map((x) => romanizeKhmer(x).toLowerCase().trim()).filter(Boolean)
    if (targets.length !== syllables.length) return
    const chunks = alignChunks(latin, targets)
    if (!chunks) return
    syllables.forEach((s, k) => {
        const key = keyOf(s, k)
        if (!store.has(key)) store.set(key, new Map())
        const m = store.get(key)
        m.set(chunks[k], (m.get(chunks[k]) ?? 0) + 1)
    })
}

function compositorReadings(khmer, store, K = 3) {
    const syllables = splitSyllables(khmer)
    if (!syllables || !syllables.length) return []
    let combos = [{ words: [], score: 0 }]
    for (const [k, s] of syllables.entries()) {
        const m = store.get(keyOf(s, k))
        if (!m || !m.size) return []
        const norm = [...m.values()].reduce((a, b) => a + b, 0)
        const opts = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, K)
            .map(([chunk, c]) => ({ chunk, score: Math.log((c + 0.25) / (norm + 0.25 * 8)) }))
        const next = []
        for (const c of combos) for (const o of opts) next.push({ words: [...c.words, o.chunk], score: c.score + o.score })
        next.sort((a, b) => b.score - a.score)
        combos = next.slice(0, 20)
    }
    return combos.map((c) => c.words.join(''))
}

/* ---- stage 1: top-1 vs rules, LOO on dev-uncovered tokens ---- */
const dev = JSON.parse(readFileSync(new URL('./dev-split.json', import.meta.url), 'utf8'))
const inDomain = dev.filter(isInDomain)
const evalRows = inDomain.filter(passesHygiene)

const storeAll = new Map()
for (const [kh, entry] of Object.entries(defaultTokenDict)) {
    if (/\s/.test(kh)) continue
    const syl = splitSyllables(kh)
    if (syl) {
        harvest(syl, entry.latin, storeAll)
        for (const [v] of Object.entries(entry.variants ?? {})) harvest(syl, v, storeAll)
    }
}
const devTokens = []
for (const p of evalRows) {
    const kt = p.khmer.split(' ')
    const lw = p.latin.split(' ')
    if (kt.length !== lw.length) continue
    kt.forEach((k, i) => {
        if (defaultTokenDict[k]) return
        const syl = splitSyllables(k)
        if (syl) devTokens.push({ khmer: k, expected: lw[i], syllables: syl })
    })
}
for (const t of devTokens) harvest(t.syllables, t.expected, storeAll)

let composed = 0, compTop1 = 0, compTop5 = 0, rulesTop1 = 0
for (const t of devTokens) {
    harvestRemove(t)
    const readings = compositorReadings(t.khmer, storeAll)
    if (!readings.length) { harvestAdd(t); continue }
    composed++
    const exp = t.expected.toLowerCase()
    if (readings[0] === exp) compTop1++
    if (readings.slice(0, 5).some((r) => r === exp)) compTop5++
    if (romanizeKhmer(t.khmer).toLowerCase() === exp) rulesTop1++
    harvestAdd(t)
}
function harvestRemove(t) {
    const targets = t.syllables.map((x) => romanizeKhmer(x).toLowerCase().trim()).filter(Boolean)
    if (targets.length !== t.syllables.length) return
    const chunks = alignChunks(t.expected, targets)
    if (!chunks) return
    t.syllables.forEach((s, k) => {
        const m = storeAll.get(keyOf(s, k))
        if (m) {
            m.set(chunks[k], (m.get(chunks[k]) ?? 0) - 1)
            if (m.get(chunks[k]) <= 0) m.delete(chunks[k])
        }
    })
}
function harvestAdd(t) {
    harvest(t.syllables, t.expected, storeAll)
}

console.log(`stage 1 — uncovered dev tokens composable (LOO): ${composed}/${devTokens.length}`)
console.log(`  compositor top-1 ${compTop1}  top-5 ${compTop5}`)
console.log(`  rules top-1      ${rulesTop1}`)

/* ---- stage 2: name-level marginal value vs the counterfactual pipeline ---- */
const K_FOLDS = 5
const foldOf = new Map(evalRows.map((p, i) => [p, i % K_FOLDS]))
const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ')
const fullSupport = supportOf(inDomain)

let rows = 0, exact = 0, reach = 0, reachWithComp = 0
for (let f = 0; f < K_FOLDS; f++) {
    const testRows = evalRows.filter((p) => foldOf.get(p) === f)
    const trainRows = inDomain.filter((p) => foldOf.get(p) !== f)
    const { dict } = counterfactualDict({ bundled: defaultTokenDict, trainRows, testRows, fullSupport })
    const distill = distillMapFor(defaultFstDistill, trainRows, dict)
    const t = createTransliterator({ tokenDict: dict, fstResults: distill })

    const store = new Map()
    for (const [kh, entry] of Object.entries(dict)) {
        if (/\s/.test(kh)) continue
        const syl = splitSyllables(kh)
        if (syl) {
            harvest(syl, entry.latin, store)
            for (const [v] of Object.entries(entry.variants ?? {})) harvest(syl, v, store)
        }
    }
    for (const p of trainRows) {
        const kt = p.khmer.split(' ')
        const lw = p.latin.split(' ')
        if (kt.length !== lw.length) continue
        kt.forEach((k, i) => {
            const syl = splitSyllables(k)
            if (syl) harvest(syl, lw[i], store)
        })
    }

    for (const p of testRows) {
        rows++
        const r = t.transliterate(p.khmer)
        const exp = norm(p.latin)
        if (norm(r.value) === exp) { exact++; continue }
        const words = exp.split(' ')
        if (words.length !== r.tokens.length) continue
        // compositor readings join ONLY their own token's options
        const extras = r.tokens.map((tok) =>
            !dict[tok.khmer] && !distill.has(tok.khmer) ? compositorReadings(tok.khmer, store) : [],
        )
        const reachable = (withExtra) =>
            words.every((w, i) => {
                const tok = r.tokens[i]
                return (
                    norm(tok.latin) === w ||
                    tok.alternatives.some((a) => norm(a) === w) ||
                    (withExtra ? extras[i].includes(w) : false)
                )
            })
        if (reachable(false)) { reach++; continue }
        if (reachable(true)) reachWithComp++
    }
}
console.log(`stage 2 — counterfactual 5-fold: ${rows} rows, ${exact} exact`)
console.log(`  official reachable in token options: +${reach} (no compositor) vs +${reach + reachWithComp} (with) — ceiling delta ${reachWithComp} rows`)
