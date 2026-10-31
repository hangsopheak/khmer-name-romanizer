#!/usr/bin/env node
/**
 * khmer-name-romanizer CLI
 *
 * Usage:
 *   khmer-name-romanizer "តាំង លាងខៃ"
 *   echo "តាំងលាងខៃ" | khmer-name-romanizer
 *   khmer-name-romanizer --all "សូ បញ្ញា"     # ranked alternative spellings
 */

import { createDefaultTransliterator } from '../dist/index.js'
import * as readline from 'node:readline'

const rawArgs = process.argv.slice(2)
const showAll = rawArgs.includes('--all')
const args = rawArgs.filter((arg) => arg !== '--all')
const translit = createDefaultTransliterator()

async function readStdin() {
    const rl = readline.createInterface({ input: process.stdin })
    const lines = []
    for await (const line of rl) lines.push(line)
    return lines.join('\n')
}

async function main() {
    const input = args.length > 0 ? args.join(' ') : (await readStdin()).trim()
    if (!input) {
        console.error('Usage: khmer-name-romanizer [--all] "<khmer name>"  (or pipe names via stdin, one per line)')
        process.exit(1)
    }
    for (const line of input.split('\n')) {
        const name = line.trim()
        if (!name) continue
        const result = translit.transliterate(name)
        console.log(`${name}\t${showAll ? result.candidates.join(' | ') : result.value}`)
    }
}

void main()
