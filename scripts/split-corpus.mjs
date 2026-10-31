#!/usr/bin/env node
/**
 * Freezes a held-out test split of the scraped corpus.
 *
 * Assignment is a pure function of the row itself:
 *
 *   isTest = fnv1a(khmer + '\t' + latin) % 1000 < 150   (~15%)
 *
 * so re-running on the same corpus always yields the identical split, and a
 * corpus refresh (new rows scraped) never moves an existing row's assignment
 * the way a seeded shuffle would. Test rows are the project's lockbox:
 *
 *   - NEVER mined into the dictionary  (mine-tokens.mjs reads dev-split.json)
 *   - NEVER used to tune rules or thresholds
 *   - only scored by eval-holdout.mjs to measure real generalization
 *
 * Outputs scripts/dev-split.json + scripts/test-split.json (plain row arrays,
 * same shape as scraped-names.json, original corpus order).
 *
 * Usage:
 *   node scripts/split-corpus.mjs            # (re)generate both splits
 *   node scripts/split-corpus.mjs --check    # verify on-disk files still
 *                                            # match the corpus; exit 1 on drift
 */
import { readFileSync, writeFileSync } from 'node:fs'

const PERMILLE = 150 // 150‰ ≈ 15% held out for testing
const CHECK = process.argv.includes('--check')

const fnv1a = (s) => {
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
        h ^= s.codePointAt(i)
        h = Math.imul(h, 0x01000193)
    }
    return h >>> 0
}

/** Pure assignment: a row's split membership depends only on the row itself. */
const isTest = (row) => fnv1a(`${row.khmer}\t${row.latin}`) % 1000 < PERMILLE

const pairs = JSON.parse(readFileSync(new URL('./scraped-names.json', import.meta.url), 'utf8'))

const key = (row) => `${row.khmer}\t${row.latin}`
const byKey = (rows) => new Map(rows.map((row) => [key(row), row]))

const dev = pairs.filter((row) => !isTest(row))
const test = pairs.filter(isTest)

const counts = (rows) => {
    const c = {}
    for (const row of rows) c[row.bucket] = (c[row.bucket] ?? 0) + 1
    return c
}

const fmtCounts = (c) =>
    Object.entries(c)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([b, n]) => `${b}:${n}`)
        .join('  ')

/* --- sanity: disjoint, complete, deterministic ----------------------- */
const devKeys = byKey(dev)
const testKeys = byKey(test)
const overlap = [...devKeys.keys()].filter((k) => testKeys.has(k))
const unionSize = devKeys.size + testKeys.size
// determinism is structural (pure function), but verify the invariant anyway
const rerun = pairs.filter(isTest)
const stable = rerun.length === test.length && rerun.every((row, i) => key(row) === key(test[i]))

if (overlap.length || unionSize !== pairs.length || !stable) {
    console.error('split invariant violated:', { overlap: overlap.length, unionSize, corpus: pairs.length, stable })
    process.exit(1)
}

/* --- --check: do the frozen files still match the corpus? ------------ */
if (CHECK) {
    const onDisk = (name) => {
        try {
            return byKey(JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')))
        } catch {
            return null
        }
    }
    const diskTest = onDisk('test-split.json')
    const diskDev = onDisk('dev-split.json')
    if (!diskTest || !diskDev) {
        console.error('missing dev-split.json / test-split.json — run `npm run split:corpus` first')
        process.exit(1)
    }
    const drift = (label, disk, expected) => {
        const missing = [...expected.keys()].filter((k) => !disk.has(k))
        const extra = [...disk.keys()].filter((k) => !expected.has(k))
        if (missing.length || extra.length) {
            console.error(`${label} drifted: ${missing.length} rows missing, ${extra.length} unexpected`)
            missing.slice(0, 5).forEach((k) => console.error(`   missing: ${k}`))
            extra.slice(0, 5).forEach((k) => console.error(`   extra:   ${k}`))
        }
        return missing.length + extra.length
    }
    const bad = drift('test-split.json', diskTest, testKeys) + drift('dev-split.json', diskDev, devKeys)
    if (bad) {
        console.error(`\n${bad} row(s) drifted — regenerate with \`npm run split:corpus\`.`)
        console.error('(If the corpus was re-scraped, note that earlier holdout numbers are no longer comparable.)')
        process.exit(1)
    }
    console.log(`split files match the corpus (dev ${diskDev.size}, test ${diskTest.size}) — no drift`)
    process.exit(0)
}

/* --- write ----------------------------------------------------------- */
writeFileSync(new URL('./dev-split.json', import.meta.url), JSON.stringify(dev, null, 1))
writeFileSync(new URL('./test-split.json', import.meta.url), JSON.stringify(test, null, 1))

console.log(`corpus: ${pairs.length} rows → dev ${dev.length} / test ${test.length} (${PERMILLE}‰ held out)`)
console.log(`  dev:  ${fmtCounts(counts(dev))}`)
console.log(`  test: ${fmtCounts(counts(test))}`)
console.log('\ninvariants: disjoint ✓  union = corpus ✓  deterministic ✓')
console.log('test-split.json is FROZEN: never mined into the dict, never used for tuning.')
