/**
 * Common alternative romanizations of one Latin name word.
 *
 * Khmer names are officially spelled several ways; each alternation below is
 * attested in the gold roster data (see scripts/data/token_conflicts.md):
 *
 *   nh <-> gn        Panha / Pagna, Nhan / Gnan
 *   final y <-> i    Ly / Li, Vatey / Vati
 *   final th <-> t   Ngeth / Nget
 *   final n <-> nn   Tan / Tann, Vann / Van
 *   (o|oeu)n <-> rn  Thoeun / Thoeurn, Soeun / Soeurn, Thon / Thorn
 *   initial ou <-> u Ouch / Uch
 *   i <-> y          Lina / Lyna
 */

interface Alternation {
    pattern: RegExp
    replace: string
}

const ALTERNATIONS: Alternation[] = [
    { pattern: /nh/, replace: 'gn' },
    { pattern: /gn/, replace: 'nh' },
    { pattern: /y$/, replace: 'i' },
    { pattern: /([^aeiou])i$/, replace: '$1y' },
    { pattern: /th$/, replace: 't' },
    { pattern: /([aeiou])t$/, replace: '$1th' },
    { pattern: /nn$/, replace: 'n' },
    { pattern: /([aeiou])n$/, replace: '$1nn' },
    { pattern: /(o|eu)rn$/, replace: '$1n' },
    { pattern: /(o|eu)n$/, replace: '$1rn' },
    { pattern: /^ou/, replace: 'u' },
    { pattern: /^u/, replace: 'ou' },
    { pattern: /^([^aeiouy]+)i(?=[^aeiouy])/, replace: '$1y' },
    { pattern: /^([^aeiouy]+)y(?=[^aeiouy])/, replace: '$1i' },
]

function capitalize(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1)
}

/** Alternative spellings of a single-word Latin rendering (never includes the input). */
export function spellingAlternates(word: string): string[] {
    if (!word || /\s/.test(word)) return []
    const lower = word.toLowerCase()
    const seen = new Set([lower])
    const alternates: string[] = []
    for (const { pattern, replace } of ALTERNATIONS) {
        if (!pattern.test(lower)) continue
        const candidate = lower.replace(pattern, replace)
        if (seen.has(candidate)) continue
        seen.add(candidate)
        alternates.push(capitalize(candidate))
    }
    return alternates
}
