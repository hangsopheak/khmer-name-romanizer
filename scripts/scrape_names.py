#!/usr/bin/env python3
"""Scrape Khmer <-> Latin person-name pairs for khmer-name-romanizer.

Source: Wikidata SPARQL — humans with a Khmer Wikipedia article, taking
their Khmer and English labels as the attested pair. Stdlib only, no pip
dependencies. Writes scripts/scraped-names.json (and a raw dump next to
it for provenance).

Usage:
    python3 scripts/scrape_names.py [--limit 20000] [--out scripts/scraped-names.json]
"""
import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

WDQS = "https://query.wikidata.org/sparql"
USER_AGENT = (
    "khmer-name-romanizer-scraper/1.0 "
    "(https://github.com/hangsopheak/khmer-name-romanizer; contact: hangsopheak.hod@gmail.com)"
)

QUERY = """
SELECT ?item ?km ?en (IF(BOUND(?khmerCtz), "cambodian", IF(BOUND(?otherCtz), "foreign", "unknown")) AS ?bucket) WHERE {
  ?article schema:about ?item ; schema:isPartOf <https://km.wikipedia.org/> .
  ?item wdt:P31 wd:Q5 .
  ?item rdfs:label ?km . FILTER(LANG(?km) = "km")
  ?item rdfs:label ?en . FILTER(LANG(?en) = "en")
  OPTIONAL { ?item wdt:P27 wd:Q424 . BIND("x" AS ?khmerCtz) }
  OPTIONAL { ?item wdt:P27 ?anyCtz . FILTER(?anyCtz != wd:Q424) BIND("x" AS ?otherCtz) }
}
LIMIT %d
"""

# Second pass: any Cambodian citizen (P27=Q424) with both labels, even
# without a Khmer Wikipedia article — widens the in-domain pool.
QUERY_CAMBODIANS = """
SELECT ?item ?km ?en ("cambodian" AS ?bucket) WHERE {
  ?item wdt:P31 wd:Q5 .
  ?item wdt:P27 wd:Q424 .
  ?item rdfs:label ?km . FILTER(LANG(?km) = "km")
  ?item rdfs:label ?en . FILTER(LANG(?en) = "en")
}
LIMIT %d
"""

# Leading honorifics/titles that are not part of a personal name.
KHMER_TITLES = [
    "សម្តេចព្រះ", "សម្តេចអគ្គ", "សម្តេច", "ព្រះករុណា", "ព្រះបាទ", "ព្រះអង្គ",
    "ព្រះអរហន្ត", "ព្រះថេរ", "ព្រះ", "លោកនាង", "លោកស្រី", "លោកជំទាវ", "លោកគ្រូ",
    "លោក", "អ្នកស្រី", "អ្នកនាង", "ឧកញ៉ា", "អ្នកឧកញ៉ា",
    "ម៉ែស", "មិសស", "ដុកតឺរ", "ប្រធាន",
]
LATIN_TITLES = [
    "samdech", "oknha", "neak", "his", "her", "majesty", "king", "queen",
    "prince", "princess", "h.e.", "he.", "dr.", "mr.", "ms.", "mrs.",
    "ven.", "venerable", "monsignor", "sir", "dame", "president", "prime",
    "minister", "general", "gen.", "deputy", "hrh", "hm",
]

KHMER_ONLY = re.compile(r"^[\u1780-\u17ff\s]+$")
LATIN_ONLY = re.compile(r"^[A-Za-z\s\-.']+$")
ROMAN_NUMERAL = re.compile(r"^[IVXLC]+$")
KHMER_ORDINAL = re.compile(r"ទី[០-៩០-៩]+$")
ZERO_WIDTH = re.compile(r"[\u200b\u200c\ufeff]")
# every exotic space (NBSP, thin space, en-space, ...) becomes a plain space
UNICODE_SPACES = re.compile(r"[\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+")


def squash_spaces(text: str) -> str:
    return re.sub(r"\s+", " ", UNICODE_SPACES.sub(" ", text)).strip()


def clean_khmer(raw: str) -> str:
    text = ZERO_WIDTH.sub("", raw)
    text = squash_spaces(text)
    # strip leading honorifics, repeatedly (e.g. "សម្តេចព្រះ ...")
    changed = True
    while changed:
        changed = False
        for title in KHMER_TITLES:
            if text.startswith(title + " "):
                text = text[len(title):].lstrip()
                changed = True
    # drop parentheticals "(អ្នកស្រី)" etc.
    text = re.sub(r"\([^)]*\)", "", text)
    text = squash_spaces(text)
    return text


def clean_latin(raw: str) -> str:
    text = squash_spaces(raw)
    text = re.sub(r"\([^)]*\)", "", text)
    # strip trailing Roman ordinals (Jayavarman VII -> Jayavarman; the Khmer
    # ទី៧ ordinal is stripped on the other side)
    words = text.split(" ")
    while words and ROMAN_NUMERAL.match(words[-1]) and len(words) > 1:
        words.pop()
    changed = True
    while changed:
        changed = False
        for title in LATIN_TITLES:
            while words and words[0].lower().rstrip(".") in (title, title + "."):
                words.pop(0)
                changed = True
    text = " ".join(words)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def khmer_ordinal_stripped(text: str) -> str:
    text = KHMER_ORDINAL.sub("", text).strip()
    return text


def looks_like_name_pair(khmer: str, latin: str) -> bool:
    if not khmer or not latin:
        return False
    if not KHMER_ONLY.match(khmer) or not LATIN_ONLY.match(latin):
        return False
    k_tokens = khmer.split(" ")
    l_words = latin.split(" ")
    if not (1 <= len(k_tokens) <= 4) or not (1 <= len(l_words) <= 5):
        return False
    if abs(len(k_tokens) - len(l_words)) > 1:
        return False
    # every Khmer token needs at least one consonant-range character
    for token in k_tokens:
        if not any("\u1780" <= ch <= "\u17b2" for ch in token):
            return False
    if any(len(w) < 2 for w in l_words):
        return False
    return True


def fetch_sparql(query: str, limit: int, note: str) -> list:
    url = WDQS + "?" + urllib.parse.urlencode(
        {"query": query % limit, "format": "json"}
    )
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/sparql-results+json"})
    print(f"querying wikidata: {note} (limit {limit}) ...", file=sys.stderr)
    started = time.time()
    with urllib.request.urlopen(request, timeout=90) as response:
        payload = json.load(response)
    rows = payload["results"]["bindings"]
    print(f"got {len(rows)} rows in {time.time() - started:.1f}s", file=sys.stderr)
    time.sleep(2)  # WDQS etiquette
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=20000)
    parser.add_argument("--out", default="scripts/scraped-names.json")
    args = parser.parse_args()

    rows = fetch_sparql(QUERY, args.limit, "kmwiki humans with en labels")
    rows += fetch_sparql(QUERY_CAMBODIANS, args.limit, "Cambodian citizens with km+en labels")

    seen = {}
    rejected = Counter()
    for row in rows:
        qid = row["item"]["value"].rsplit("/", 1)[-1]
        khmer = khmer_ordinal_stripped(clean_khmer(row["km"]["value"]))
        latin = clean_latin(row["en"]["value"])
        bucket = row.get("bucket", {}).get("value", "unknown")
        if not looks_like_name_pair(khmer, latin):
            rejected["shape"] += 1
            continue
        key = khmer.replace(" ", "")
        if key in seen:
            # keep the first, but count the duplicate attestation
            seen[key]["attestations"] += 1
            continue
        seen[key] = {
            "khmer": khmer,
            "latin": latin,
            "qid": qid,
            "bucket": bucket,
            "source": "wikidata/kmwiki-humans",
            "attestations": 1,
        }

    pairs = sorted(seen.values(), key=lambda p: (-p["attestations"], p["khmer"]))
    out_path = Path(args.out)
    out_path.write_text(json.dumps(pairs, ensure_ascii=False, indent=1), encoding="utf-8")
    raw_path = out_path.with_suffix(".raw.json")
    raw_path.write_text(json.dumps({"rows": len(rows), "endpoint": WDQS, "buckets": dict(Counter(p["bucket"] for p in pairs))}, ensure_ascii=False), encoding="utf-8")

    print(f"wrote {len(pairs)} unique pairs -> {out_path}", file=sys.stderr)
    print(f"rejected by shape filter: {rejected['shape']}", file=sys.stderr)
    print(f"buckets: {dict(Counter(p['bucket'] for p in pairs))}", file=sys.stderr)
    for pair in pairs[:10]:
        print(f"  {pair['khmer']}  ->  {pair['latin']}  ({pair['attestations']})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
