#!/usr/bin/env node
/**
 * Probe: dictionary segmentation upgrades — evaluated 2026-11-01, none shipped.
 *
 * Phase 6 of the original plan ("segmentation upgrades on the T5.1 parser
 * refactor") predates the Phase 3–4 work; this probe measures whether any
 * segmentation upgrade still has value. Counterfactual 5-fold scenario
 * (dict without fold support + fold-filtered distill), dev split only.
 *
 * Findings (2026-11-01):
 *   - Segmentation already works: on 126 trusted-split tokens it beats
 *     the whole-token rules reading (18 vs 13 exact, meanSim 0.558 vs
 *     0.557). The DP is not the problem.
 *   - Trust thresholds leave nothing on the table: 0 of 87 untrusted
 *     tokens had a fully-dict-coverable segmentation — relaxing the
 *     remainder>=3 rule gains nothing and only risks shredding.
 *   - n-best segmentations (enumerating every trusted split, shipped
 *     dict): rescues 3/102 of the sim<0.9 misses — and all 3 depend on
 *     shipped-dict keys the counterfactual folds lack (in-sample
 *     flattery), so the honest rescue rate is ~0. The remaining misses
 *     are corpus short-forms (គឹមហួន -> "Kim" drops a component),
 *     out-of-scope regnal/foreign names, and unfixable split noise.
 *   - The dominant bucket is nosegment (560 tokens with NO dictionary
 *     prefix): a vocabulary problem (scrape -> mine -> merge + distill),
 *     not a segmentation-algorithm problem.
 *
 * Conclusion: no segmentation upgrade is worth shipping. Vocabulary
 * growth moves every number here; the algorithm does not.
 *
 * Usage: npm run build && node scripts/probe-segmentation.mjs
 */
import { readFileSync } from 'node:fs'
import { createTransliterator, defaultTokenDict } from '../dist/index.js'
import { segmentToken } from '../dist/tokenizer.js'
import { romanizeKhmer } from '../dist/rules.js'
import { counterfactualDict, isInDomain, passesHygiene, supportOf } from './lib/corpus-tools.mjs'

const dev = JSON.parse(readFileSync(new URL('./dev-split.json', import.meta.url), 'utf8'))
const inDomain = dev.filter(isInDomain)
const evalRows = inDomain.filter(passesHygiene)
const fullSupport = supportOf(inDomain)
const norm = (s) => s.toLowerCase()
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

const ed = (a, b) => {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
    for (let j = 0; j <= b.length; j++) dp[0][j] = j
    for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++)
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    return dp[a.length][b.length]
}
const sim = (a, b) => 1 - ed(norm(a), norm(b)) / Math.max(a.length, b.length)

/** Every trusted segmentation of a token (bounded, depth<=4): each piece
 *  is a dict key (>=3 units) or an unknown remainder >=3 units. */
function allSegs(token, dict, minKeyLen = 3) {
    const out = []
    const walk = (i, acc) => {
        if (acc.length > 4) return
        if (i === token.length) {
            out.push(acc)
            return
        }
        for (let len = Math.min(12, token.length - i); len >= 1; len--) {
            const piece = token.slice(i, i + len)
            const inDict = len >= minKeyLen && Boolean(dict[piece])
            if (inDict) walk(i + len, [...acc, [piece, true]])
            if (len >= 3 && !inDict && token.length - (i + len) >= (acc.length ? 1 : 2))
                walk(i + len, [...acc, [piece, false]])
        }
    }
    walk(0, [])
    return out
}

const K_FOLDS = 5
const foldOf = new Map(evalRows.map((p, i) => [p, i % K_FOLDS]))
const buckets = { direct: 0, seg: 0, untrusted: 0, nosegment: 0 }
const segOutcome = { segExact: 0, segTotal: 0, segSim: 0, rulesExact: 0, rulesSim: 0 }
let untrustedFullCover = 0
const segMisses = []

for (let f = 0; f < K_FOLDS; f++) {
    const testRows = evalRows.filter((p) => foldOf.get(p) === f)
    const trainRows = inDomain.filter((p) => foldOf.get(p) !== f)
    const { dict } = counterfactualDict({ bundled: defaultTokenDict, trainRows, testRows, fullSupport })
    const t = createTransliterator({ tokenDict: dict })
    const dictMap = new Map(Object.entries(dict))

    for (const p of testRows) {
        const r = t.transliterate(p.khmer)
        const words = p.latin.split(' ')
        r.tokens.forEach((tok, i) => {
            const expected = words[i]
            if (!expected) return
            if (dict[tok.khmer]) {
                buckets.direct++
                return
            }
            const segs = segmentToken(tok.khmer, dictMap, {})
            if (!segs) {
                buckets.nosegment++
                return
            }
            const trusted = segs.every((s) => s.inDict || s.text.length >= 3)
            if (!trusted) {
                buckets.untrusted++
                if (segs.every((s) => s.inDict)) untrustedFullCover++
                return
            }
            buckets.seg++
            segOutcome.segTotal++
            const reading = segs
                .map((s) => (s.inDict ? dict[s.text].latin : cap(romanizeKhmer(s.text))))
                .join('')
            if (norm(reading) === norm(expected)) segOutcome.segExact++
            segOutcome.segSim += sim(reading, expected)
            const rules = romanizeKhmer(tok.khmer)
            if (norm(rules) === norm(expected)) segOutcome.rulesExact++
            segOutcome.rulesSim += sim(rules, expected)
            if (norm(reading) !== norm(expected) && sim(reading, expected) < 0.9)
                segMisses.push({ khmer: tok.khmer, expected })
        })
    }
}

console.log('token buckets:', JSON.stringify(buckets))
console.log(
    `trusted-seg tokens ${segOutcome.segTotal}: seg ${segOutcome.segExact} exact / ${(segOutcome.segSim / segOutcome.segTotal).toFixed(3)} sim` +
    ` vs rules ${segOutcome.rulesExact} / ${(segOutcome.rulesSim / segOutcome.segTotal).toFixed(3)}`,
)
console.log(`untrusted tokens with a fully-dict-coverable split: ${untrustedFullCover}`)

// n-best rescue check against the SHIPPED dict (upper bound; counterfactual is weaker)
let altRescued = 0
for (const m of segMisses) {
    const readings = allSegs(m.khmer, defaultTokenDict).map((ss) =>
        titleCase(ss.map(([piece, d]) => (d ? defaultTokenDict[piece].latin : romanizeKhmer(piece))).join('')),
    )
    if (readings.some((r2) => norm(r2) === norm(m.expected))) altRescued++
}
console.log(`n-best alternative splits (shipped dict, upper bound) rescue ${altRescued}/${segMisses.length} seg misses`)
console.log(`nosegment bucket (no dict prefix at all): ${buckets.nosegment} tokens — vocabulary, not algorithm`)
