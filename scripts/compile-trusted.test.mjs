import { describe, it, expect } from 'vitest'
import { TIER, isNativeCorrection, selectTrustedPairs } from './lib/trusted-select.mjs'

// Regression tests for the 0.6.0 data-quality finding: the trusted-list
// compiler used to keep the FIRST pair per Khmer key, so a stale
// distilled alias could hide a native-reader correction (នារី "Nary"
// hid "Neary"). A native correction must override any earlier pair;
// everything else keeps the historical first-seen order, so the
// compiled file stays stable with the released state.

describe('selectTrustedPairs', () => {
    it('a native correction seen later outranks anything seen earlier', () => {
        const out = selectTrustedPairs([
            { khmer: 'នារី', latin: 'Nary', tier: TIER.rest },
            { khmer: 'នារី', latin: 'Neary', tier: TIER.nativePrimary },
        ])
        expect(out).toEqual([{ khmer: 'នារី', latin: 'Neary', tier: TIER.nativePrimary }])
    })

    it('a native correction alt spelling also outranks an earlier attestation', () => {
        const out = selectTrustedPairs([
            { khmer: 'សោភ័ណ', latin: 'Sophaep', tier: TIER.rest },
            { khmer: 'សោភ័ណ', latin: 'Soaphoan', tier: TIER.nativeAlt },
        ])
        expect(out[0].latin).toBe('Soaphoan')
    })

    it('a native correction primary beats its own alt spelling', () => {
        const out = selectTrustedPairs([
            { khmer: 'នារី', latin: 'Neary Alt', tier: TIER.nativeAlt },
            { khmer: 'នារី', latin: 'Neary', tier: TIER.nativePrimary },
        ])
        expect(out[0].latin).toBe('Neary')
    })

    it('without a native correction, first seen wins (the released order)', () => {
        const out = selectTrustedPairs([
            { khmer: 'បុរី', latin: 'Borey', tier: TIER.rest },
            { khmer: 'បុរី', latin: 'Bourey', tier: TIER.rest },
        ])
        expect(out).toEqual([{ khmer: 'បុរី', latin: 'Borey', tier: TIER.rest }])
    })

    it('keys without conflicts pass through, sorted like the compiler output', () => {
        const out = selectTrustedPairs([
            { khmer: 'ខ', latin: 'Khol', tier: TIER.rest },
            { khmer: 'គ', latin: 'Ko', tier: TIER.nativePrimary },
        ])
        expect(out.map((p) => p.latin)).toEqual(['Khol', 'Ko'])
    })
})

describe('isNativeCorrection', () => {
    it('recognizes the review-note marker', () => {
        expect(isNativeCorrection({ note: 'native-reader correction (2026-11-08)' })).toBe(true)
    })

    it('rejects second-AI approval notes and missing notes', () => {
        expect(isNativeCorrection({ note: 'second-AI distillation, user-approved (2026-11-08)' })).toBe(false)
        expect(isNativeCorrection({ note: null })).toBe(false)
        expect(isNativeCorrection({})).toBe(false)
    })
})
