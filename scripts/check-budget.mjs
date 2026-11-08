#!/usr/bin/env node
/**
 * Package budget gate for CI: packed size and transliteration speed.
 *
 * The accuracy gates cannot see a data explosion (a dictionary 5x the
 * size can score identically) or a pathological slowdown, so this guard
 * caps them. Thresholds carry generous headroom over the measured
 * baseline (2026-11-08: 38 kB packed, ~76k names/s on an M-series; CI
 * runners are slower — the floor is 1.3% of local throughput) and are
 * meant to trip only on structural regressions, not noise.
 *
 * Usage: node scripts/check-budget.mjs [--max-kb 80] [--min-rate 1000]
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const arg = (name, fallback) => {
    const i = process.argv.indexOf(name)
    return i !== -1 ? Number(process.argv[i + 1]) : fallback
}
const maxKb = arg('--max-kb', 80)
const minRate = arg('--min-rate', 1000)

/* --- packed size via npm pack --dry-run --json --------------------- */
const pack = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' }))
const kb = pack[0].size / 1024          // compressed tarball (what ships)
const diskKb = pack[0].unpackedSize / 1024  // on-disk footprint in node_modules
const files = pack[0].entryCount
console.log(`packed: ${kb.toFixed(1)} kB (cap ${maxKb} kB) · unpacked: ${diskKb.toFixed(1)} kB (cap ${maxKb * 4} kB) · ${files} files`)

/* --- throughput on the corpus -------------------------------------- */
const { createDefaultTransliterator } = await import('../dist/index.js')
const rows = JSON.parse(readFileSync(new URL('./scraped-names.json', import.meta.url), 'utf8')).slice(0, 2000)
const t = createDefaultTransliterator()
rows.slice(0, 100).forEach((r) => t.transliterate(r.khmer)) // warm caches
const runs = 3
const t0 = process.hrtime.bigint()
let n = 0
for (let i = 0; i < runs; i++) for (const r of rows) { t.transliterate(r.khmer); n++ }
const rate = Math.round(n / (Number(process.hrtime.bigint() - t0) / 1e9))
console.log(`throughput: ${rate.toLocaleString()} names/s (floor ${minRate.toLocaleString()})`)

if (kb > maxKb) {
    console.error(`BUDGET FAILED: packed size ${kb.toFixed(1)} kB > ${maxKb} kB`)
    process.exit(1)
}
if (diskKb > maxKb * 4) {
    console.error(`BUDGET FAILED: unpacked size ${diskKb.toFixed(1)} kB > ${maxKb * 4} kB`)
    process.exit(1)
}
if (rate < minRate) {
    console.error(`BUDGET FAILED: throughput ${rate} < ${minRate} names/s`)
    process.exit(1)
}
console.log('budget ok')
