"""Write the read-only corpus lookups the saferproducts builder joins against (private/build/saferproducts/lookups/).

Inputs (all read-only):
  * company_sec_profiles.psv        written by hand from `select id, title from corpus_records where dataset='company_sec_profiles'`
                                    (md5 of the `id|title` lines in id order is checked against the corpus in REPORT.md)
  * regulatory_cpsc_aggregates_firms.json   the `firm` aggregate rows of regulatory_cpsc_aggregates (saved Supabase MCP SELECT result)
  * agency_safety_cpsc_recalls_api  rebuilt from the raw Recall REST API files acquired earlier by the cpsc_catalog stream
                                    (private/acq/cpsc_catalog/recall_api/recalls_YYYY.json); the corpus dataset was built from the
                                    same files, and the script prints fingerprints that were compared with SELECT md5(...) on the
                                    corpus rows (ids, ids+dates, ids+manufacturer lists).

Usage:
  python3 -I -B scripts/enrichment/saferproducts/make_lookups.py <saved firm-aggregate tool-result file>
"""
import glob
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
LOOK = os.path.join(ROOT, "private", "build", "saferproducts", "lookups")
RAW = os.path.join(ROOT, "private", "acq", "cpsc_catalog", "recall_api")


def md5(lines):
    return hashlib.md5("\n".join(lines).encode("utf-8")).hexdigest()


def clean(text):
    return re.sub(r"\s+", " ", text or "").strip()


def recalls():
    recs = []
    for path in sorted(glob.glob(os.path.join(RAW, "recalls_*.json"))):
        with open(path, encoding="utf-8") as fh:
            recs.extend(json.load(fh))
    recs.sort(key=lambda r: ("cpsc-api:%s" % r["RecallNumber"]).encode())
    out = []
    for r in recs:
        out.append({
            "id": "cpsc-api:%s" % r["RecallNumber"],
            "recall_number": r["RecallNumber"],
            "date": r["RecallDate"][:10],
            "title": clean(r["Title"]),
            "url": r.get("URL"),
            "manufacturers": [clean(x.get("Name")) for x in r.get("Manufacturers") or []],
            "importers": [clean(x.get("Name")) for x in r.get("Importers") or []],
            "distributors": [clean(x.get("Name")) for x in r.get("Distributors") or []],
            "products": [{"name": clean(p.get("Name")), "model": clean(p.get("Model")), "type": clean(p.get("Type"))} for p in r.get("Products") or []],
        })
    return out


def firms(saved):
    with open(saved, encoding="utf-8") as fh:
        outer = json.load(fh)
    body = outer["result"] if isinstance(outer, dict) else outer
    match = re.search(r"<untrusted-data-[^>]*>\s*(\[.*\])\s*</untrusted-data", body, re.S)
    return json.loads(match.group(1))


def main(argv):
    os.makedirs(LOOK, exist_ok=True)
    rows = recalls()
    fingerprints = {
        "rows": len(rows),
        "md5_ids": md5([r["id"] for r in rows]),
        "md5_id_date": md5(["%s|%s" % (r["id"], r["date"]) for r in rows]),
        "md5_id_title_date": md5(["%s|%s|%s" % (r["id"], r["date"], r["title"]) for r in rows]),
        "md5_id_manufacturers": md5(["%s|%s" % (r["id"], json.dumps(r["manufacturers"], ensure_ascii=False)) for r in rows]),
    }
    payload = {
        "dataset": "agency_safety_cpsc_recalls_api",
        "note": "rebuilt from the raw Recall REST API files (same files the corpus dataset was built from); fingerprints compared with the live corpus rows",
        "source_files": sorted(os.path.relpath(p, ROOT) for p in glob.glob(os.path.join(RAW, "recalls_*.json"))),
        "fingerprints": fingerprints,
        "rows": rows,
    }
    with open(os.path.join(LOOK, "corpus_recalls_api.json"), "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)
    print(json.dumps(fingerprints))
    if argv:
        agg = firms(argv[0])
        with open(os.path.join(LOOK, "regulatory_cpsc_aggregates_firms.json"), "w", encoding="utf-8") as fh:
            json.dump({"dataset": "regulatory_cpsc_aggregates", "kind": "firm", "rows": agg}, fh, ensure_ascii=False)
        print("firm aggregate rows", len(agg))


if __name__ == "__main__":
    main(sys.argv[1:])
