#!/usr/bin/env node
/**
 * Generate an injectable FST-results map for the optional FST tier (T4.1).
 *
 *   echo '["ហង្ស សុភ័ក្រ្ត", "តាំងលាងខៃ"]' | npm run fst:readings
 *
 * Takes a JSON array of Khmer names on stdin, expands it with
 * `transliterator.fstInputs()` (whole names, tokens, and the segmentation
 * remainders the resolver would need), runs them through the pynini
 * transformer via scripts/khmer_to_latin.py (one batch — the model loads
 * once), and writes a flat `{ khmer: latin }` JSON map:
 *
 *   scripts/fst-results.json
 *
 * Inject it at runtime:
 *
 *   import fst from './fst-results.json' with { type: 'json' }
 *   const t = createDefaultTransliterator({
 *       fstResults: new Map(Object.entries(fst)),
 *   })
 *
 * The pynini side is optional machinery, not a dependency of this package;
 * see the header of scripts/khmer_to_latin.py for installation. Override
 * the interpreter with KHMER_TRANLIT_PYTHON (e.g. a venv's python).
 *
 * Usage: node scripts/fst-readings.mjs [--out scripts/fst-results.json]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createDefaultTransliterator } from '../dist/index.js'

const args = process.argv.slice(2)
const outIdx = args.indexOf('--out')
const OUT = outIdx >= 0 ? args[outIdx + 1] : fileURLToPath(new URL('./fst-results.json', import.meta.url))
const SCRIPT = fileURLToPath(new URL('./khmer_to_latin.py', import.meta.url))
const PYTHON = process.env.KHMER_TRANLIT_PYTHON || 'python3'

const names = JSON.parse(readFileSync(process.stdin.fd, 'utf8'))
if (!Array.isArray(names) || names.some((n) => typeof n !== 'string')) {
    console.error('stdin must be a JSON array of Khmer strings')
    process.exit(1)
}

// Everything the resolver would ever ask the FST for these names.
const inputs = createDefaultTransliterator().fstInputs(names)

console.error(`fst: ${names.length} name(s) -> ${inputs.length} input(s); running ${PYTHON} ${SCRIPT}`)
const result = spawnSync(PYTHON, [SCRIPT], {
    input: JSON.stringify(inputs),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
})
if (result.status !== 0 || !result.stdout) {
    console.error(result.stderr?.trim() || 'fst bridge failed')
    process.exit(1)
}

const readings = JSON.parse(result.stdout)
const map = {}
let ok = 0
inputs.forEach((input, i) => {
    const value = readings[i]
    if (value) {
        map[input] = value
        ok++
    }
})

writeFileSync(OUT, JSON.stringify(map, null, 1) + '\n')
console.error(`fst: ${ok}/${inputs.length} readings -> ${OUT}`)
