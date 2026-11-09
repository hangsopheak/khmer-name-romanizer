#!/usr/bin/env python3
"""Apply native-reader corrections to distillation source files.

Takes a JSON payload on the command line:

    {
      "adoption-com.json": {"Makara": {"khmer": "មករា"}, ...},
      "behindthename-khmer.json": {"Rith": {"khmer": "រិទ្ធ", "altKhmer": [...]}, ...}
    }

Every entry whose Latin name matches (case-insensitive, gender ignored)
gets the corrected spelling, status "corrected" (the validator treats a
native-reader correction as final: round-trip is recorded but can never
flag it) and a dated correction note. altKhmer is optional and replaces
the stored alternatives when given (use [] to clear).

Usage:
    python3 scripts/apply_corrections.py '<json>'
"""
import json
import sys
from pathlib import Path

SOURCES_DIR = Path("scripts/sources")


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    payload = json.loads(sys.argv[1])

    for filename, fixes in payload.items():
        path = SOURCES_DIR / filename
        data = json.loads(path.read_text(encoding="utf-8"))
        fixes_norm = {k.lower(): v for k, v in fixes.items()}
        matched = set()
        for e in data["entries"]:
            fix = fixes_norm.get(e["latin"].lower())
            if not fix:
                continue
            matched.add(e["latin"].lower())
            e["khmer"] = fix["khmer"]
            if "altKhmer" in fix:
                e["altKhmer"] = fix["altKhmer"] or None
            e["status"] = "corrected"
            e["note"] = fix.get("note", "native-reader correction (2026-11-08)")
            e.pop("flagReason", None)
        unmatched = [k for k in fixes if k.lower() not in matched]
        path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"{filename}: corrected {len(matched)}/{len(fixes)} names"
              + (f"  UNMATCHED: {unmatched}" if unmatched else ""), file=sys.stderr)
        if unmatched:
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
