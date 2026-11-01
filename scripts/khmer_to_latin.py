#!/usr/bin/env python3
"""Bridge to the pynini FST tier: khmer-latin-name-transformer.

Reads a JSON array of Khmer strings on stdin, writes a JSON array of the
same length on stdout — the FST reading of each input, or null where the
transformer failed. Callers batch every string once (the pynini model
loads at import) and inject the results as `fstResults`.

The transformer is a pip package (not vendored here — this package stays
zero-dependency; the FST tier is optional). macOS ARM has no pynini
wheels: install with

    brew install openfst
    CPLUS_INCLUDE_PATH=$(brew --prefix openfst)/include \
    LIBRARY_PATH=$(brew --prefix openfst)/lib \
    pip install pynini khmer-latin-name-transformer

Origin: scripts/khmer_to_latin.py in the student-management roster
pipeline, where this FST tier was first wired (see the FST-tier rows in
that project's bench results).
"""
import json
import sys

try:
    from khmer_latin_name_transformer import to_latin
except ImportError:
    sys.stderr.write("khmer-latin-name-transformer is not installed\n")
    sys.exit(1)

names = json.load(sys.stdin)
results = []
for name in names:
    try:
        results.append(" ".join(str(to_latin(name)).split()))
    except Exception:
        results.append(None)
json.dump(results, sys.stdout)
