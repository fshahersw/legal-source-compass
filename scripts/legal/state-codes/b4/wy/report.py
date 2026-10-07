"""Build /tmp/sc4/wy/REPORT.json from receipts and packet manifest."""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive  # noqa: E402

from titles import CURRENCY_STATEMENT, DOWNLOAD_PAGE, TITLE_PDFS  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/wy")
    a = ap.parse_args()
    arc = Archive(a.work)
    direct = proxied = failed = 0
    raw_bytes = raw_objects = 0
    for r in arc.index.values():
        if r.get("route") == "firecrawl":
            proxied += 1
        elif r.get("state") == "complete":
            direct += 1
        if r.get("state") == "failed":
            failed += 1
        if r.get("state") == "complete":
            raw_objects += 1
            raw_bytes += r.get("bytes", 0)
    man = {}
    inv = {}
    verify = {}
    mism = []
    dups = []
    spots = []
    gaps = []
    mp = os.path.join(a.work, "packet", "manifest.json")
    if os.path.exists(mp):
        man = json.load(open(mp))
    if os.path.exists(os.path.join(a.work, "inventory.json")):
        inv = json.load(open(a.work + "/inventory.json"))
    if os.path.exists(os.path.join(a.work, "verify.json")):
        verify = json.load(open(os.path.join(a.work, "verify.json")))
    if os.path.exists(os.path.join(a.work, "parse_mismatches.json")):
        mism = json.load(open(os.path.join(a.work, "parse_mismatches.json")))
    if os.path.exists(os.path.join(a.work, "genuine_duplicates.json")):
        dups = json.load(open(os.path.join(a.work, "genuine_duplicates.json")))
    if os.path.exists(os.path.join(a.work, "spot_checks.json")):
        spots = json.load(open(os.path.join(a.work, "spot_checks.json")))
    if os.path.exists(os.path.join(a.work, "empty_section_gaps.json")):
        gaps = json.load(open(os.path.join(a.work, "empty_section_gaps.json")))
    report = {
        "state": "WY",
        "official_sources": [
            "https://wyoleg.gov/stateStatutes/StateStatutes",
            DOWNLOAD_PAGE,
        ],
        "currency_statement_verbatim": CURRENCY_STATEMENT,
        "edition": None,
        "title_pdfs": len(TITLE_PDFS),
        "counts_before_parser_fix": {
            "sections": 21814,
            "note": "false splits on sub-decimal headers (e.g. 1-1-123.1)",
        },
        "counts_after_parser_fix": {
            "chapters": man.get("chapters"),
            "sections": man.get("sections"),
            "inventory_toc_sections": inv.get("total_sections_toc"),
            "inventory_parsed_sections": inv.get("total_sections_parsed"),
        },
        "toc_reconciliation": {
            "titles_with_mismatch": len(mism),
            "all_titles_exact_ordered_match": len(mism) == 0,
        },
        "genuine_duplicate_occurrences": len(dups),
        "genuine_duplicates": dups,
        "empty_section_gaps": gaps,
        "spot_checks": spots,
        "raw_objects": raw_objects,
        "raw_bytes": raw_bytes,
        "http_requests_recorded": len(arc.index),
        "routes": {"direct_complete": direct, "proxied": proxied, "failed": failed},
        "verification": verify,
        "mismatches": mism,
        "manifest": man,
    }
    json.dump(report, open(os.path.join(a.work, "REPORT.json"), "w"), indent=2)
    print(json.dumps(report["counts_after_parser_fix"]))


if __name__ == "__main__":
    main()
