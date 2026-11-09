#!/usr/bin/env node
/**
 * Generates src/learned-alternations-data.ts: the learned rewrite table
 * that turns a rules reading of an unknown word into extra candidates
 * (see src/learned-alternations.ts and scripts/lib/learn-alternations.mjs).
 *
 * Source rows: the DEV split's trainable rows only (scripts/dev-split.json)
 * — never the frozen test split. eval-kfold.mjs relearns the table per
 * fold from the train folds, so the k-fold numbers stay leakage-free.
 *
 * Usage: npm run build && node scripts/learn-alternations.mjs [--check]
 *   --check  exit 1 when the committed table is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { isTrainable } from './lib/corpus-tools.mjs'
import { DEFAULTS, learnRules, trainingPairs } from './lib/learn-alternations.mjs'

const OUT = new URL('../src/learned-alternations-data.ts', import.meta.url)

const pairs = JSON.parse(readFileSync(new URL('./dev-split.json', import.meta.url), 'utf8'))
const training = trainingPairs(pairs.filter(isTrainable))
const rules = learnRules(training)

const body = `/**
 * Generated learned spelling alternations — DO NOT EDIT BY HAND.
 * [left context, from, to, right context, probability]; '^' / '$' mark
 * the word boundary. Learned from ${training.length} distinct (Khmer word,
 * official spelling) pairs of the dev split (scripts/dev-split.json,
 * trainable rows) — never the frozen test split. Settings: alpha
 * ${DEFAULTS.alpha}, min successes ${DEFAULTS.minSuccess}, min p ${DEFAULTS.minP}. Regenerate with:
 *
 *   npm run build && node scripts/learn-alternations.mjs
 */

import type { LearnedRule } from './learned-alternations.js'

export const defaultLearnedAlternations: readonly LearnedRule[] = [
${rules.map((r) => `    ${JSON.stringify(r)},`).join('\n')}
]
`

if (process.argv.includes('--check')) {
    const current = readFileSync(OUT, 'utf8')
    if (current !== body) {
        console.error('src/learned-alternations-data.ts is out of date — run node scripts/learn-alternations.mjs')
        process.exit(1)
    }
    console.log(`learned alternations up to date (${rules.length} rules)`)
} else {
    writeFileSync(OUT, body)
    console.log(`${rules.length} rules from ${training.length} pairs -> src/learned-alternations-data.ts`)
}
