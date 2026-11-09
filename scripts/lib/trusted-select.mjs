/**
 * Trusted-pair selection for compile-trusted.mjs — one pair per Khmer key.
 *
 * The regression this guards (0.6.0 data-quality finding): the compiler
 * used to keep the FIRST pair per Khmer key, so a stale distilled alias
 * seen early could hide a native-reader correction seen later (នារី
 * "Nary" hid Neary). Wrong pairs then survived every pipeline rerun.
 *
 * Tiers:
 *
 *   0  native primary  — native-reader correction (note "native-reader
 *                        correction …"), the entry's own khmer field.
 *                        Explicit owner fixes outrank everything.
 *   1  native alt      — altKhmer spelling of a native correction.
 *   2  attested or approved — everything else: behindthename submitter
 *                        transcriptions and owner-bulk-approved
 *                        second-AI spellings. Measured (2026-11-09),
 *                        neither class reliably beats the other
 *                        (btn: Akrun for អរុណ, Chompei for ចំប៉ី;
 *                        approved: Mliss for ម្លិះ, Sonisay for និស្ស័យ),
 *                        so they keep the historical first-seen order —
 *                        the compiled file stays byte-stable with the
 *                        released 0.6.0 state outside native fixes.
 *
 * Ties keep the first candidate seen (SOURCES order, then entry order),
 * so output is deterministic. Provenance is read from the entry note;
 * "native-reader correction" is the marker the review docs use.
 */

export const TIER = {
    nativePrimary: 0,
    nativeAlt: 1,
    rest: 2,
}

/** Provenance of a `status: "corrected"` entry, from its note. */
export const isNativeCorrection = (entry) => (entry.note ?? '').startsWith('native-reader correction')

/**
 * candidates: [{ khmer, latin, tier, ... }] — pre-gated by the caller.
 * Returns the selected pairs sorted like the compiler output
 * (latin, then khmer).
 */
export const selectTrustedPairs = (candidates) => {
    const best = new Map()
    for (const c of candidates)
        if (!best.has(c.khmer) || c.tier < best.get(c.khmer).tier) best.set(c.khmer, c)
    return [...best.values()].sort((a, b) => a.latin.localeCompare(b.latin) || a.khmer.localeCompare(b.khmer))
}
