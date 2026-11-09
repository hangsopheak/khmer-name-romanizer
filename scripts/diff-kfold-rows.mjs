#!/usr/bin/env node
/**
 * Paired comparison of two k-fold runs, row by row.
 *
 *   node scripts/eval-kfold.mjs --rows before.json
 *   (change something, rebuild)
 *   node scripts/eval-kfold.mjs --rows after.json
 *   node scripts/diff-kfold-rows.mjs before.json after.json [--list]
 *
 * Reports, for exact, top-5 and match mode: rows newly right, rows newly
 * wrong, and the exact two-sided sign-test p-value on the discordant
 * pairs. A gain only counts when gains clearly exceed losses.
 * --list prints every changed row (khmer, gold, before -> after).
 */
import { readFileSync } from 'node:fs'

const [beforeFile, afterFile] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const list = process.argv.includes('--list')
if (!beforeFile || !afterFile) {
    console.error('usage: node scripts/diff-kfold-rows.mjs <before.json> <after.json> [--list]')
    process.exit(1)
}
const before = JSON.parse(readFileSync(beforeFile, 'utf8'))
const after = JSON.parse(readFileSync(afterFile, 'utf8'))
if (before.length !== after.length) {
    console.error(`row count differs: ${before.length} vs ${after.length} — not the same eval rows`)
    process.exit(1)
}
before.forEach((b, i) => {
    const a = after[i]
    if (b.fold !== a.fold || b.khmer !== a.khmer || b.gold !== a.gold) {
        console.error(`row ${i} differs (${b.khmer} / ${a.khmer}) — not the same eval rows`)
        process.exit(1)
    }
})

/** Exact two-sided binomial sign test on discordant pairs. */
const signTest = (gains, losses) => {
    const n = gains + losses
    if (!n) return 1
    const k = Math.min(gains, losses)
    let logC = 0
    let tail = 0
    for (let i = 0; i <= k; i++) {
        if (i > 0) logC += Math.log(n - i + 1) - Math.log(i)
        tail += Math.exp(logC - n * Math.LN2)
    }
    return Math.min(1, 2 * tail)
}

const metrics = [
    ['exact', 'hit'],
    ['top-5', 'inTop5'],
    ['match', 'matched'],
]
console.log(`paired rows: ${before.length}\n`)
console.log('metric   before  after   newly right  newly wrong  net   sign-test p')
for (const [label, key] of metrics) {
    const b = before.filter((r) => r[key]).length
    const a = after.filter((r) => r[key]).length
    const gains = before.filter((r, i) => !r[key] && after[i][key]).length
    const losses = before.filter((r, i) => r[key] && !after[i][key]).length
    console.log(
        `${label.padEnd(8)} ${String(b).padStart(6)} ${String(a).padStart(6)}   ${String(gains).padStart(11)}  ${String(losses).padStart(11)}  ${String(gains - losses).padStart(4)}   ${signTest(gains, losses).toPrecision(2)}`,
    )
}
const valueChanged = before.filter((r, i) => r.value !== after[i].value).length
console.log(`\nrows whose value changed: ${valueChanged}`)

if (list) {
    for (const [label, key] of metrics) {
        const changed = before.map((r, i) => [r, after[i]]).filter(([b, a]) => b[key] !== a[key])
        if (!changed.length) continue
        console.log(`\n--- ${label} changes ---`)
        for (const [b, a] of changed)
            console.log(`${a[key] ? '+' : '-'} ${b.khmer}  gold "${b.gold}"  value "${b.value}" -> "${a.value}"${key !== 'hit' ? `  cands [${a.candidates.join(' | ')}]` : ''}`)
    }
}
