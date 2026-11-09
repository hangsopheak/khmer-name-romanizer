#!/usr/bin/env python3
"""Fill distilled Khmer spellings into a scrape source file (chunk helper).

Takes a JSON map {latin: [khmer, note-or-null]} on the command line and
patches matching `pending` entries: khmer set, khmerSource="llm",
status="distilled". Match is case-insensitive on the Latin name; entries
already distilled/attested are left untouched. Prints matched/missed so a
bad key never fails silently.

Usage (one chunk of ~10 names per call):
    python3 scripts/distill_fill.py scripts/sources/adoption-com.json \
        '{"Chantrea": ["ចន្ទ្រា", null], ...}'
"""
import json
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    out_path = Path(sys.argv[1])
    updates = json.loads(sys.argv[2])

    data = json.loads(out_path.read_text(encoding="utf-8"))
    # match ALL entries with this latin (gender duplicates fill together)
    def apply(latin_key, khmer, note):
        hit = 0
        for e in data["entries"]:
            if e["latin"].lower() != latin_key or e["status"] != "pending":
                continue
            e["khmer"] = khmer
            e["khmerSource"] = "llm"
            e["status"] = "distilled"
            if note:
                e["note"] = note
            hit += 1
        return hit

    matched, unmatched = [], []
    for latin, (khmer, note) in updates.items():
        if apply(latin.lower(), khmer, note):
            matched.append(latin)
        else:
            unmatched.append(latin)

    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"matched {len(matched)}/{len(updates)} latin keys  unmatched: {unmatched or '-'}", file=sys.stderr)
    return 0 if not unmatched else 1


if __name__ == "__main__":
    sys.exit(main())
