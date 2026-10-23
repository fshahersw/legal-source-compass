"""Save the read-only lookups the oversight builders join against (run once, offline).

  python3 -I -B scripts/enrichment/oversight/save_lookups.py

private/build/oversight/lookups/fr_agency_titles.json   [id, title] of every published fr_agency_profiles record,
                                                        taken from that dataset's build file (the rows that were
                                                        published; the record count is checked against the corpus)
Company names for the CEP resolutions come from lookup_company_sec_profiles-style rows saved by
save_company_lookup (see build_doj.py), never guessed.
"""
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as cm  # noqa: E402

SRC = os.path.join(cm.PRIVATE, "build", "agencies_fr", "fr_agency_profiles.json.gz")
OUT = os.path.join(cm.BUILD, "lookups", "fr_agency_titles.json")


def main():
    with gzip.open(SRC, "rt", encoding="utf-8") as handle:
        build = json.load(handle)
    rows = [[str(r["id"]), r["title"]] for r in build["rows"]]
    rows.sort(key=lambda r: (int(r[0]) if r[0].isdigit() else 10**9, r[0]))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump({"source": "fr_agency_profiles build file (published rows)", "built_at": build.get("built_at"), "rows": rows}, handle, ensure_ascii=False)
    print(json.dumps({"agencies": len(rows), "file": cm.rel(OUT)}))


if __name__ == "__main__":
    main()
