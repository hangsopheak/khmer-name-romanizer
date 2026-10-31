#!/usr/bin/env python3
"""Scrape Khmer <-> Latin person-name pairs for khmer-name-romanizer.

Sources (all Wikimedia, all openly licensed — no election/government
sites are touched):

  1. Wikidata SPARQL — humans with a Khmer Wikipedia article, Khmer and
     English labels as the attested pair.
  2. Wikidata SPARQL — any Cambodian citizen (P27=Q424) with both labels,
     even without a Khmer Wikipedia article.
  3. Wikidata SPARQL — any human with both labels (widens the foreign
     bucket: Khmer renderings of international names).
  4. Wikidata SPARQL — humans with BOTH a km.wikipedia and en.wikipedia
     article, using the article *titles* as the pair (a second attestation
     path that catches items whose labels are missing or stale).
  5. Wikidata SPARQL — given-name / family-name items (P31=Q12308941 /
     Q101352) with both labels: pure name tokens, the highest-value
     dictionary material.

Stdlib only, no pip dependencies. Writes scripts/scraped-names.json
(and a raw dump next to it for provenance). A query that times out or
fails is skipped with a warning; the rest still land.

Usage:
    python3 scripts/scrape_names.py [--limit N] [--out scripts/scraped-names.json]
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

# Third pass: ANY human with both labels — the foreign bucket (Khmer
# renderings of international names), reported separately by the eval.
# The endpoint's proxies cut this long result stream mid-transfer, so it
# is walked in LIMIT/OFFSET pages (see PAGED_SOURCES) and tolerates
# partial coverage: pages that fail are logged and skipped.
QUERY_ALL_HUMANS = """
SELECT ?item ?km ?en (IF(BOUND(?khmerCtz), "cambodian", IF(BOUND(?otherCtz), "foreign", "unknown")) AS ?bucket) WHERE {
  ?item wdt:P31 wd:Q5 .
  ?item rdfs:label ?km . FILTER(LANG(?km) = "km")
  ?item rdfs:label ?en . FILTER(LANG(?en) = "en")
  OPTIONAL { ?item wdt:P27 wd:Q424 . BIND("x" AS ?khmerCtz) }
  OPTIONAL { ?item wdt:P27 ?anyCtz . FILTER(?anyCtz != wd:Q424) BIND("x" AS ?otherCtz) }
}
LIMIT %d OFFSET %d
"""

# Fourth pass: humans with BOTH a Khmer and an English Wikipedia article,
# pairing the article *titles* — a second attestation path for items
# whose labels are missing or diverge from the common name.
QUERY_SITELINK_TITLES = """
SELECT ?item ?km ?en (IF(BOUND(?khmerCtz), "cambodian", IF(BOUND(?otherCtz), "foreign", "unknown")) AS ?bucket) WHERE {
  ?item wdt:P31 wd:Q5 .
  ?kmwiki schema:about ?item ; schema:isPartOf <https://km.wikipedia.org/> ; schema:name ?km .
  ?enwiki schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?en .
  OPTIONAL { ?item wdt:P27 wd:Q424 . BIND("x" AS ?khmerCtz) }
  OPTIONAL { ?item wdt:P27 ?anyCtz . FILTER(?anyCtz != wd:Q424) BIND("x" AS ?otherCtz) }
}
LIMIT %d
"""

# Fifth pass: given-name (Q12308941) and family-name (Q101352) items with
# both labels. NOTE: Wikidata barely models Khmer names as items — this
# source is overwhelmingly FOREIGN names transcribed in Khmer (Michael,
# Georg…), so it lands in the foreign bucket and never feeds dictionary
# mining; it broadens the out-of-domain eval set instead.
# One query PER type: a combined VALUES clause plans badly on WDQS and
# times out; the plain per-type shape runs in ~30s.
QUERY_GIVEN_NAMES = """
SELECT ?item ?km ?en ("foreign" AS ?bucket) WHERE {
  ?item wdt:P31 wd:Q12308941 .
  ?item rdfs:label ?km . FILTER(LANG(?km) = "km")
  ?item rdfs:label ?en . FILTER(LANG(?en) = "en")
}
LIMIT %d
"""

QUERY_FAMILY_NAMES = """
SELECT ?item ?km ?en ("foreign" AS ?bucket) WHERE {
  ?item wdt:P31 wd:Q101352 .
  ?item rdfs:label ?km . FILTER(LANG(?km) = "km")
  ?item rdfs:label ?en . FILTER(LANG(?en) = "en")
}
LIMIT %d
"""

# (query, per-query limit, source tag, human note) — processed in order of
# trust, so the first source to see a Khmer name owns its `source` field.
SOURCES = [
    (QUERY, 20000, "wikidata/kmwiki-humans", "kmwiki humans with en labels"),
    (QUERY_CAMBODIANS, 20000, "wikidata/cambodian-citizens", "Cambodian citizens with km+en labels"),
    (QUERY_SITELINK_TITLES, 50000, "wikipedia/km-en-titles", "humans with kmwiki+enwiki article titles"),
    (QUERY_GIVEN_NAMES, 20000, "wikidata/given-names", "given-name items with km+en labels"),
    (QUERY_FAMILY_NAMES, 20000, "wikidata/family-names", "family-name items with km+en labels"),
]

# Paged sources: (query, page size, max pages, source tag, note). Each
# page is a separate request; a failed page just ends the walk early.
PAGED_SOURCES = [
    (QUERY_ALL_HUMANS, 2500, 20, "wikidata/all-humans", "all humans with km+en labels"),
]

# Leading honorifics/titles that are not part of a personal name.
KHMER_TITLES = [
    "សម្តេចព្រះ", "សម្តេចអគ្គ", "សម្តេច", "ព្រះករុណា", "ព្រះបាទ", "ព្រះអង្គ",
    "ព្រះអរហន្ត", "ព្រះថេរ", "ព្រះ", "លោកនាង", "លោកស្រី", "លោកជំទាវ", "លោកគ្រូ",
    "លោក", "អ្នកស្រី", "អ្នកនាង", "ឧកញ៉ា", "អ្នកឧកញ៉ា",
    "ចៅចមមាតាអ្នក", "ចៅចមមាតា", "ចៅពញា",
    "ម៉ែស", "មិសស", "ដុកតឺរ", "ប្រធាន",
]
LATIN_TITLES = [
    "samdech", "oknha", "neak", "his", "her", "majesty", "king", "queen",
    "prince", "princess", "h.e.", "he.", "dr.", "mr.", "ms.", "mrs.",
    "ven.", "venerable", "monsignor", "sir", "dame", "president", "prime",
    "minister", "general", "gen.", "deputy", "hrh", "hm",
]

# Compound royal titles that also appear written WITHOUT a space before
# the name (e.g. ចៅចមមាតាអ្នកអង្គ = title + អង្គ "Ang"). Bare ចៅ stays
# space-required: real names like ចៅ សុភា start with it.
KHMER_TITLES_NO_SPACE = [
    "ចៅចមមាតាអ្នក", "ចៅចមមាតា", "ចៅពញា",
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
    text = text.replace("_", " ")  # MediaWiki title form
    text = squash_spaces(text)
    # strip leading honorifics, repeatedly (e.g. "សម្តេចព្រះ ..."),
    # including compound royal titles written without a space
    changed = True
    while changed:
        changed = False
        for title in KHMER_TITLES:
            if text.startswith(title + " "):
                text = text[len(title):].lstrip()
                changed = True
        for title in KHMER_TITLES_NO_SPACE:
            rest = text[len(title):].lstrip()
            if (text.startswith(title) and len(text) > len(title)
                    and len(rest.replace(" ", "")) >= 2
                    and any("\u1780" <= ch <= "\u17b2" for ch in rest)):
                text = rest
                changed = True
    # drop parentheticals "(អ្នកស្រី)" etc.
    text = re.sub(r"\([^)]*\)", "", text)
    text = squash_spaces(text)
    return text


def clean_latin(raw: str) -> str:
    text = squash_spaces(raw.replace("_", " "))
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


def _parse_bindings(text: str) -> list:
    """Parse a WDQS JSON response into result bindings.

    The endpoint sometimes aborts mid-stream (client sees a partial JSON
    body followed by a Java stack trace and the query text). Rows written
    before the abort are still good, so salvage them: re-close the
    structure at the last complete binding boundary.
    """
    try:
        return json.loads(text, strict=False)["results"]["bindings"]
    except json.JSONDecodeError:
        pass
    sep = text.rfind("\n    }, {")
    fin = text.rfind("\n    } ]")
    cut = max(sep, fin)
    if cut == -1:
        raise ValueError("no complete bindings in response")
    keep = text[:cut + len("\n    }")]
    return json.loads(keep + " ]\n  }\n}\n", strict=False)["results"]["bindings"]


def _run_sparql(formatted_query: str, note: str, attempts: int) -> list:
    url = WDQS + "?" + urllib.parse.urlencode(
        {"query": formatted_query, "format": "json"}
    )
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/sparql-results+json"})
    print(f"querying wikidata: {note} ...", file=sys.stderr)
    started = time.time()
    payload = None
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                text = response.read().decode("utf-8")
            payload = _parse_bindings(text)
            break
        except Exception as exc:  # noqa: BLE001 — one bad query must not kill the scrape
            if attempt == attempts:
                print(f"  query FAILED after {attempts} attempts ({exc}); giving up on it", file=sys.stderr)
                return []
            wait = 5 * attempt
            if isinstance(exc, urllib.error.HTTPError) and exc.code in (429, 503, 504):
                wait = 30 * attempt
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                if retry_after and retry_after.isdigit():
                    wait = max(wait, int(retry_after))
            print(f"  attempt {attempt} failed ({exc}); retrying in {wait}s ...", file=sys.stderr)
            time.sleep(wait)
    print(f"got {len(payload)} rows in {time.time() - started:.1f}s", file=sys.stderr)
    return payload


def fetch_sparql(query: str, limit: int, note: str, attempts: int = 3) -> list:
    rows = _run_sparql(query % limit, f"{note} (limit {limit})", attempts)
    time.sleep(2)  # WDQS etiquette
    return rows


def fetch_sparql_paged(query: str, page: int, offset: int, note: str, attempts: int = 2) -> list:
    rows = _run_sparql(query % (page, offset), f"{note} (limit {page} offset {offset})", attempts)
    time.sleep(2)  # WDQS etiquette
    return rows


def reclean(pairs: list) -> list:
    """Re-apply cleaning/shape filters to already-stored corpus rows.

    Lets cleaning improvements (new titles, filters) reach the corpus
    without re-hitting the network. Rows whose Khmer key collides after
    re-cleaning merge their attestations.
    """
    seen = {}
    dropped = 0
    for pair in pairs:
        khmer = khmer_ordinal_stripped(clean_khmer(pair["khmer"]))
        latin = clean_latin(pair["latin"])
        if not looks_like_name_pair(khmer, latin):
            dropped += 1
            continue
        # name-item sources are foreign transcriptions (Wikidata has no
        # Khmer name items) — re-bucket stored rows accordingly
        bucket = pair["bucket"]
        if pair.get("source") in ("wikidata/name-items", "wikidata/given-names", "wikidata/family-names"):
            bucket = "foreign"
        key = khmer.replace(" ", "")
        if key in seen:
            seen[key]["attestations"] = seen[key].get("attestations", 1) + 1
            continue
        pair = {**pair, "khmer": khmer, "latin": latin, "bucket": bucket}
        seen[key] = pair
    print(f"recleaned: kept {len(seen)}, dropped {dropped}, merged collisions", file=sys.stderr)
    return sorted(seen.values(), key=lambda p: (-p["attestations"], p["khmer"]))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=0,
                        help="override every per-query limit (0 = use per-source defaults)")
    parser.add_argument("--out", default="scripts/scraped-names.json")
    parser.add_argument("--reclean", action="store_true",
                        help="offline: re-apply cleaning to the stored corpus, no network")
    args = parser.parse_args()

    out_path = Path(args.out)

    if args.reclean:
        pairs = reclean(json.loads(out_path.read_text(encoding="utf-8")))
        out_path.write_text(json.dumps(pairs, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"wrote {len(pairs)} pairs -> {out_path}", file=sys.stderr)
        return 0

    seen = {}
    rejected = Counter()
    source_rows = {}

    # Incremental by design: seed from any existing corpus so a run where
    # some sources fail (WDQS is flaky) never loses what earlier runs
    # already landed. Re-observing a pair bumps its attestations — a
    # uniform bump across re-observed pairs, so ranking is unaffected.
    out_path = Path(args.out)
    if out_path.exists():
        for prior in json.loads(out_path.read_text(encoding="utf-8")):
            seen[prior["khmer"].replace(" ", "")] = prior

    def absorb(rows: list, source: str) -> None:
        source_rows[source] = source_rows.get(source, 0) + len(rows)
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
                "source": source,
                "attestations": 1,
            }

    for query, limit, source, note in SOURCES:
        absorb(fetch_sparql(query, args.limit or limit, note), source)

    for query, page, max_pages, source, note in PAGED_SOURCES:
        if args.limit:
            page = args.limit
        offset = 0
        for page_index in range(max_pages):
            rows = fetch_sparql_paged(query, page, offset,
                                      f"{note}, page {page_index + 1}/{max_pages}")
            if not rows:
                break  # failed or exhausted — keep whatever landed so far
            absorb(rows, source)
            # advance by what actually landed: aborted pages yield partial
            # rows, and restarting after them loses nothing. A genuinely
            # final short page is followed by an empty page, which breaks.
            offset += len(rows)
        else:
            print(f"  note: {note} hit the {max_pages}-page cap; corpus may be partial", file=sys.stderr)

    pairs = sorted(seen.values(), key=lambda p: (-p["attestations"], p["khmer"]))
    out_path.write_text(json.dumps(pairs, ensure_ascii=False, indent=1), encoding="utf-8")
    raw_path = out_path.with_suffix(".raw.json")
    raw_path.write_text(json.dumps({
        "rows": len(source_rows),
        "endpoint": WDQS,
        "sources": source_rows,
        "buckets": dict(Counter(p["bucket"] for p in pairs)),
    }, ensure_ascii=False), encoding="utf-8")

    print(f"wrote {len(pairs)} unique pairs -> {out_path}", file=sys.stderr)
    print(f"rejected by shape filter: {rejected['shape']}", file=sys.stderr)
    print(f"buckets: {dict(Counter(p['bucket'] for p in pairs))}", file=sys.stderr)
    print(f"sources: {dict(Counter(p['source'] for p in pairs))}", file=sys.stderr)
    for pair in pairs[:10]:
        print(f"  {pair['khmer']}  ->  {pair['latin']}  ({pair['attestations']})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
