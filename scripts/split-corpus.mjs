#!/usr/bin/env node
/**
 * Freezes a held-out test split of the scraped corpus — the lockbox.
 *
 * Assignment is by PERSON GROUP, not by row (groupRows in
 * scripts/lib/corpus-tools.mjs): rows sharing a normalized Khmer name, a
 * Wikidata QID, or a multi-word Latin name always land on the same side,
 * so a test name can never have a second spelling of itself in dev.
 *
 *   isTest = fnv1a(groupId) % 1000 < 150   (~15% of groups)
 *            && the group holds no hand-authored row
 *
 * Hand-authored rows (native-review pairs, source static/manual) are never
 * lockbox material: their labels come from the same person who pins the
 * dictionary, so they — and every row of their group — stay in dev.
 *
 * The assignment is a pure function of the corpus: re-running yields the
 * identical split, and a refresh only moves rows whose group changed.
 * Test rows are the project's lockbox:
 *
 *   - NEVER mined into the dictionary  (mine-tokens.mjs reads dev-split.json)
 *   - NEVER used to tune rules, thresholds or correction rounds
 *   - only scored by eval-holdout.mjs, once per release
 *
 * Lockbox v2 (2026-11-09): switched from per-row hashing (khmer\tlatin) to
 * person groups. Numbers from the v1 lockbox are not comparable.
 *
 * Outputs scripts/dev-split.json + scripts/test-split.json (plain row arrays,
 * same shape as scraped-names.json, original corpus order).
 *
 * Usage (needs a fresh `npm run build` — grouping uses the engine's
 * normalizer):
 *   node scripts/split-corpus.mjs            # (re)generate both splits
 *   node scripts/split-corpus.mjs --check    # verify on-disk files still
 *                                            # match the corpus; exit 1 on drift
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fnv1a, groupRows, isHandAuthored } from './lib/corpus-tools.mjs'

const PERMILLE = 150 // 150‰ ≈ 15% of person groups held out for testing
const CHECK = process.argv.includes('--check')

const pairs = JSON.parse(readFileSync(new URL('./scraped-names.json', import.meta.url), 'utf8'))

const key = (row) => `${row.khmer}\t${row.latin}`
const byKey = (rows) => new Map(rows.map((row) => [key(row), row]))

/** Pure assignment: a row's side depends only on its person group. */
const assign = (rows) => {
    const groupOf = groupRows(rows)
    const handGroups = new Set(rows.filter(isHandAuthored).map((row) => groupOf.get(row)))
    const testGroup = (g) => !handGroups.has(g) && fnv1a(g) % 1000 < PERMILLE
    return (row) => testGroup(groupOf.get(row))
}
const isTest = assign(pairs)

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
const rerun = pairs.filter(assign(pairs))
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

console.log(`corpus: ${pairs.length} rows → dev ${dev.length} / test ${test.length} (${PERMILLE}‰ of person groups held out)`)
console.log(`  dev:  ${fmtCounts(counts(dev))}`)
console.log(`  test: ${fmtCounts(counts(test))}`)
console.log('\ninvariants: disjoint ✓  union = corpus ✓  deterministic ✓')
console.log('test-split.json is FROZEN: never mined into the dict, never used for tuning, read once per release.')
