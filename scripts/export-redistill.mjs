#!/usr/bin/env node
/**
 * Export the adoption.com re-distillation list for a second-opinion AI.
 *
 * Scope: entries whose current Khmer spelling came from the in-repo LLM
 * distillation (khmerSource "llm") and were NOT corrected by the native
 * reader — the set a second model should re-derive. The GLM spellings are
 * deliberately NOT included, so the second opinion stays unanchored.
 * Gender-duplicated listings (same Latin for F and M) collapse to one row.
 *
 * A reference appendix lists the adoption.com names whose Khmer is already
 * attested elsewhere (behindthename transcriptions, scraped corpus) —
 * cross-check material only.
 *
 * Usage: node scripts/export-redistill.mjs   (writes docs/adoption-redistill-input.md)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const data = JSON.parse(readFileSync(new URL('./sources/adoption-com.json', import.meta.url), 'utf8'))
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|')

const glm = new Map() // latin -> {genders:Set, meaning}
for (const e of data.entries) {
    if (e.khmerSource !== 'llm' || e.status === 'corrected') continue
    const row = glm.get(e.latin) ?? { genders: new Set(), meaning: e.meaning }
    row.genders.add((e.gender ?? '?').replace('Female', 'F').replace('Male & Female', 'F/M').replace('Male', 'M'))
    glm.set(e.latin, row)
}
const attested = data.entries.filter(
    (e) => ['btn', 'corpus'].includes(e.khmerSource) && e.status !== 'corrected',
)

const lines = [
    '# adoption.com Cambodian given names — Khmer spelling task',
    '',
    'For each Latin name below, write the standard Khmer-script spelling used as a Cambodian given name.',
    'Gender and the English meaning are hints only; give one best spelling per name.',
    'Output format: `Latin -> Khmer` per line.',
    '',
    `## Names to distill (${glm.size})`,
    '',
    '| # | Latin | G | Meaning hint |',
    '|---|---|---|---|',
    ...[...glm.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([latin, r], i) => `| ${i + 1} | ${esc(latin)} | ${[...r.genders].sort().join('/')} | ${esc(r.meaning)} |`),
    '',
    '## Reference — already attested elsewhere (do not re-distill, cross-check only)',
    '',
    '| Latin | Khmer | attested by |',
    '|---|---|---|',
    ...attested
        .sort((a, b) => a.latin.localeCompare(b.latin))
        .map((e) => `| ${esc(e.latin)} | ${esc(e.khmer)} | ${e.khmerSource === 'btn' ? 'behindthename.com transcription' : 'scraped corpus (kname/Wikidata)'} |`),
    '',
]
writeFileSync(fileURLToPath(new URL('../docs/adoption-redistill-input.md', import.meta.url)), lines.join('\n'))
console.log(`docs/adoption-redistill-input.md: ${glm.size} names to re-distill, ${attested.length} attested reference rows`)

/* same distill set as CSV (upload-friendly) */
const csvCell = (s) => {
    const v = String(s ?? '')
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}
const csv = [
    'latin,gender,meaning_hint',
    ...[...glm.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([latin, r]) => [latin, [...r.genders].sort().join('/'), r.meaning ?? ''].map(csvCell).join(',')),
].join('\n')
writeFileSync(fileURLToPath(new URL('../docs/adoption-redistill-input.csv', import.meta.url)), csv + '\n')
console.log(`docs/adoption-redistill-input.csv: ${glm.size} rows`)
