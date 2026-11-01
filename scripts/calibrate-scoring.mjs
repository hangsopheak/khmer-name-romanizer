#!/usr/bin/env node
/**
 * Calibration for the probability-weighted candidate ranking (Phase 3).
 *
 * Sweeps the smoothing constants of src/transliterate.ts:
 *
 *   CANONICAL_MASS_BONUS (kappa) — pseudo-count backing the dictionary's
 *       reviewed canonical spelling against raw corpus variant counts
 *   RULES_PRIOR_MASS / FST_PRIOR_MASS (lambda) — prior-grade trust granted
 *       to rule/FST readings when no dictionary count exists
 *   UNSEEN_OPTION_MASS (epsilon) — floor mass for spellings offered
 *       without evidence (attested alternations)
 *
 * …over a small grid, rebuilding between steps, and reports exact / top-5 /
 * mean similarity on the CALIBRATION sets only:
 *
 *   - dev split (scripts/dev-split.json, in-domain buckets) — the dict is
 *     mined from it, so this is partly in-sample: fine for picking
 *     smoothing constants, not for claiming accuracy
 *   - famous people (scripts/famous-people.json)
 *
 * The frozen test split (scripts/test-split.json) is NEVER read here —
 * it is the lockbox, judged once per improvement round by eval:holdout.
 *
 * Usage: node scripts/calibrate-scoring.mjs
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const GRID = []
for (const kappa of [3, 5, 1000]) {
    for (const lambda of [0.5, 1]) {
        for (const epsilon of [0.1, 0.25]) GRID.push({ kappa, lambda, epsilon })
    }
}

const SRC = fileURLToPath(new URL('../src/transliterate.ts', import.meta.url))
const original = readFileSync(SRC, 'utf8')
const ROOT = fileURLToPath(new URL('..', import.meta.url))

/* Each combo is scored in a fresh subprocess: the module cache would
 * otherwise keep serving the first-built scoring code. */
const MEASURE_FILE = '/private/var/folders/hr/hykhsryj0ql18gs8d0l1lk_w0000gn/T/opencode/knr-measure.mjs'
const PAN_FILE = '/private/var/folders/hr/hykhsryj0ql18gs8d0l1lk_w0000gn/T/opencode/knr-pan.mjs'
import { writeFileSync } from 'node:fs'
writeFileSync(
    MEASURE_FILE,
    `
import { readFileSync } from 'node:fs'
import { createDefaultTransliterator } from '${ROOT}dist/index.js'
import { isInDomain, norm, passesHygiene, similarity } from '${ROOT}scripts/lib/corpus-tools.mjs'
const dev = JSON.parse(readFileSync('${ROOT}scripts/dev-split.json', 'utf8')).filter(isInDomain).filter(passesHygiene)
const famous = JSON.parse(readFileSync('${ROOT}scripts/famous-people.json', 'utf8'))
const t = createDefaultTransliterator()
const score = (rows, key) => {
    let exact = 0, top5 = 0
    const sims = []
    for (const row of rows) {
        const r = t.transliterate(row.khmer)
        const expected = norm(row[key])
        if (norm(r.value) === expected) exact++
        if (r.candidates.some((c) => norm(c) === expected)) top5++
        sims.push(similarity(r.value, row[key]))
    }
    return { exact, top5, mean: +(sims.reduce((a, b) => a + b, 0) / sims.length).toFixed(4) }
}
console.log(JSON.stringify({ dev: score(dev, 'latin'), famous: score(famous, 'expected') }))
`,
)
writeFileSync(
    PAN_FILE,
    `
import { createDefaultTransliterator } from '${ROOT}dist/index.js'
const t = createDefaultTransliterator()
console.log(t.transliterate('ប៉ែន រ៉ន').candidates.some((c) => c.toLowerCase() === 'pan ron') ? 'yes' : 'NO')
`,
)

try {
    console.log('  k  l  e | dev exact  dev top5  dev mean | fam exact fam top5 fam mean | Pan Ron top5')
    console.log('-'.repeat(95))
    for (const { kappa, lambda, epsilon } of GRID) {
        const patched = original
            .replace(/const CANONICAL_MASS_BONUS = [\d.]+/, `const CANONICAL_MASS_BONUS = ${kappa}`)
            .replace(/const RULES_PRIOR_MASS = [\d.]+/, `const RULES_PRIOR_MASS = ${lambda}`)
            .replace(/const FST_PRIOR_MASS = [\d.]+/, `const FST_PRIOR_MASS = ${lambda}`)
            .replace(/const UNSEEN_OPTION_MASS = [\d.]+/, `const UNSEEN_OPTION_MASS = ${epsilon}`)
        if (patched === original && kappa !== 3) throw new Error('constant patterns not found — script out of date')
        execSync(`printf '%s' "${Buffer.from(patched).toString('base64')}" | base64 -d > '${SRC}'`)
        execSync('node node_modules/typescript/bin/tsc -p tsconfig.json', { stdio: 'pipe' })
        const out = JSON.parse(execSync(`node '${MEASURE_FILE}'`))
        const pan = execSync(`node '${PAN_FILE}'`).toString().trim()
        const d = out.dev
        const f = out.famous
        console.log(
            `${String(kappa).padStart(3)} ${String(lambda).padStart(2)} ${String(epsilon).padEnd(3)} | ${String(d.exact).padStart(9)} ${String(d.top5).padStart(9)} ${String(d.mean).padStart(8)} | ${String(f.exact).padStart(9)} ${String(f.top5).padStart(9)} ${String(f.mean).padEnd(8)} | ${pan}`,
        )
    }
} finally {
    execSync(`printf '%s' "${Buffer.from(original).toString('base64')}" | base64 -d > '${SRC}'`)
    execSync('node node_modules/typescript/bin/tsc -p tsconfig.json', { stdio: 'pipe' })
    console.log('\n(src/transliterate.ts restored, dist rebuilt with the committed constants)')
}
