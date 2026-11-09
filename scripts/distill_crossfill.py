#!/usr/bin/env python3
"""Cross-fill attested Khmer spellings across the distillation sources.

adoption.com and behindthename.com list many of the same given names. An
entry still `pending` (waiting for LLM distillation) whose Latin name
matches an entry with an attested Khmer spelling — in EITHER file —
adopts that spelling instead: khmerSource "btn" beats "llm".

Match keys are case-insensitive and space-insensitive ("Rom Chang" ==
"Romchang"), gender is ignored (same given name, different listing).
Submitter typos with a dangling trailing coeng are cleaned on import
(noted) — a bare word-final coeng is never valid Khmer orthography.

Usage: python3 scripts/distill_crossfill.py   (idempotent)
"""
import json
import re
import sys
from pathlib import Path

FILES = [
    Path("scripts/sources/adoption-com.json"),
    Path("scripts/sources/behindthename-khmer.json"),
]
CORPUS = Path("scripts/scraped-names.json")
KHMER_ONLY = re.compile(r"^[\u1780-\u17ff]+$")


def clean(khmer: str) -> tuple[str | None, str | None]:
    """Return (spelling, note) with submitter-typo cleanup applied."""
    note = None
    if khmer.endswith("\u17d2"):  # dangling trailing coeng; a final
        # toandakhiat (U+17CD, silent-letter ៍) is VALID and never touched
        khmer = khmer.rstrip("\u17d2")
        note = "cleaned from BTN submitter spelling (dangling trailing coeng removed)"
    if not KHMER_ONLY.match(khmer) or len(khmer) < 2:
        return None, None
    return khmer, note


def main() -> int:
    datas = {p: json.loads(p.read_text(encoding="utf-8")) for p in FILES}

    # attested index: match key -> (khmer, note). Provenance lives in
    # khmerSource — validation may already have moved status to
    # verified/flagged, which does not change where the Khmer came from.
    attested = {}
    for data in datas.values():
        for e in data["entries"]:
            if e.get("khmerSource") != "btn" or not e["khmer"]:
                continue
            khmer, note = clean(e["khmer"])
            if not khmer:
                continue
            attested.setdefault(e["latin"].lower().replace(" ", ""), (khmer, note))

    # corpus index: single-token scraped-names.json rows (kname and
    # Wikidata attestations) — latin(lower) -> khmer when unambiguous.
    corpus = {}
    if CORPUS.exists():
        for p in json.loads(CORPUS.read_text(encoding="utf-8")):
            if " " in p["latin"] or " " in p["khmer"]:
                continue
            corpus.setdefault(p["latin"].lower(), set()).add(p["khmer"])
    corpus = {k: next(iter(v)) for k, v in corpus.items() if len(v) == 1}

    def lookup(key: str):
        if key in attested:
            return *attested[key], "btn"
        if key in corpus:
            return corpus[key], None, "corpus"
        return None

    filled = 0
    remaining = []
    for path, data in datas.items():
        for e in data["entries"]:
            if e["status"] != "pending":
                continue
            hit = lookup(e["latin"].lower().replace(" ", ""))
            if not hit:
                remaining.append(e["latin"])
                continue
            khmer, note, origin = hit
            e["khmer"] = khmer
            e["khmerSource"] = origin
            e["status"] = "distilled"
            e["note"] = note or (f"attested in scraped corpus ({origin})" if origin == "corpus" else None)
            filled += 1
        path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"cross-filled {filled} pending entries from attested spellings", file=sys.stderr)
    print(f"still pending (need LLM distill): {len(remaining)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
