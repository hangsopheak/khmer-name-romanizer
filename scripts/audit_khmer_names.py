# Audit: which "cambodian"/"curated" bucket rows are actually non-Khmer people?
# Method: Wikidata P27 (country of citizenship). No Cambodian citizenship => foreign transcription.
import json
import time
import urllib.parse
import urllib.request

WDQS = "https://query.wikidata.org/sparql"
UA = "khmer-name-romanizer-audit (https://github.com/hangsopheak/khmer-name-romanizer; contact: hangsopheak.hod@gmail.com)"

AUSTRALIA = [  # also treat citizenships of diaspora hubs conservatively: label, don't drop
    "Q424",     # Cambodia
    "Q819",     # Laos
    "Q881",     # Vietnam
    "Q869",     # Thailand
    "Q17",      # China
    "Q884",     # South Korea
    "Q17",
]

rows = json.load(open("scripts/scraped-names.json"))
in_domain = [r for r in rows if r.get("bucket") in ("cambodian", "curated") and r.get("qid") and r["qid"] != "manual"]
qids = sorted({r["qid"] for r in in_domain})
print(f"in-domain rows: {len(in_domain)}  unique qids: {len(qids)}")

def query(batch):
    values = " ".join(f"wd:{q}" for q in batch)
    sparql = f"""
    SELECT ?item ?cit WHERE {{
      VALUES ?item {{ {values} }}
      ?item wdt:P27 ?cit .
    }}"""
    url = WDQS + "?" + urllib.parse.urlencode({"query": sparql})
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/sparql-results+json"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.load(resp)
            return data["results"]["bindings"]
        except Exception as exc:
            if attempt == 4:
                raise
            time.sleep(3 * (attempt + 1))

cit_by_qid = {}
B = 60
batches = [qids[i:i + B] for i in range(0, len(qids), B)]
for i, batch in enumerate(batches):
    try:
        bindings = query(batch)
    except Exception as exc:
        print(f"batch {i} failed: {exc}")
        continue
    for b in bindings:
        qid = b["item"]["value"].rsplit("/", 1)[-1]
        cit = b["cit"]["value"].rsplit("/", 1)[-1]
        cit_by_qid.setdefault(qid, set()).add(cit)
    print(f"batch {i + 1}/{len(batches)} done")
    time.sleep(1)

json.dump({k: sorted(v) for k, v in cit_by_qid.items()}, open("scripts/audit-citizenship.json", "w"), indent=1)

KH = "Q424"
missing, foreign, domestic = [], [], []
by_qid = {}
for r in in_domain:
    by_qid.setdefault(r["qid"], []).append(r)

for qid, rl in by_qid.items():
    cits = cit_by_qid.get(qid)
    if not cits:
        missing.append(rl)
    elif KH in cits:
        domestic.append(rl)
    else:
        foreign.append(rl)

km_wiki = lambda rl: any(r["source"] == "wikidata/kmwiki-humans" for r in rl)
km_foreign = [rl for rl in foreign if km_wiki(rl)]
km_missing = [rl for rl in missing if km_wiki(rl)]

print(f"\ndomestic (has KH citizenship):      {len(domestic)} rows / {len(by_qid) - len(foreign) - len(missing)} qids")
print(f"foreign  (no KH citizenship):        {len(foreign)} rows / {len(foreign) and len({r['qid'] for rl in foreign for r in rl})} qids")
print(f"  of which source=kmwiki-humans:     {len(km_foreign)} rows")
print(f"missing citizenship data:            {len(missing)} rows / {len(missing) and len({r['qid'] for rl in missing for r in rl})} qids")
print(f"  of which source=kmwiki-humans:     {len(km_missing)} rows")

print("\n--- FOREIGN (has citizenship, none KH) ---")
for rl in sorted(foreign, key=lambda rl: rl[0]["khmer"]):
    r = rl[0]
    cits = ",".join(cit_by_qid[r["qid"]])
    print(f"{r['khmer']}  ->  {r['latin']}  [{r['qid']}  cit={cits}  src={r['source']}  n={r['attestations']}]")

print("\n--- MISSING (no citizenship claim) kmwiki-humans only ---")
for rl in sorted(km_missing, key=lambda rl: rl[0]["khmer"]):
    r = rl[0]
    print(f"{r['khmer']}  ->  {r['latin']}  [{r['qid']}  src={r['source']}  n={r['attestations']}]")
