"""Fail if a publishable build file names or points to the compilations it was derived from (owner decision 2026-10-18).

Loads every private/build/third_party_data/*.json that is a publishable build file (a JSON object with dataset, label, listing_block,
summary and rows, as corpus_writer.publish expects) and scans EVERY dict key and EVERY string value, recursively (rows, summary,
listing_block, inputs, label, dataset), for the forbidden names and hosts in tp_common (case-insensitive substrings
`settlesignal`, `settle signal`, `settle-signal`, `goodjobsfirst`, `good jobs first`, `goodjobs`, `violation tracker`, `violationtracker`,
`violation-tracker`, `advottic`, `gjf`; hosts settlesignal.com, goodjobsfirst.org, violationtracker.goodjobsfirst.org, advottic.com;
multi-word names also with separators removed). The two expected build files must exist. Private side files (excluded lists, provenance
maps, REPORT.md, review reports) are not build files and are not scanned.

Usage: python3 -I -B check_no_source_names.py [build.json ...]      exit code 0 = clean, 1 = a forbidden name/host (first path printed)
"""
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tp_common as tp  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BUILD = os.path.join(ROOT, "private", "build", "third_party_data")
EXPECTED = ("settlement_notices", "enforcement_data_sources_catalog")
BUILD_KEYS = {"dataset", "label", "listing_block", "summary", "rows"}


def is_build_file(data):
    return isinstance(data, dict) and BUILD_KEYS <= set(data)


def count_nodes(obj):
    """(dict keys, string values) scanned."""
    if isinstance(obj, dict):
        k, v = len(obj), 0
        for value in obj.values():
            ck, cv = count_nodes(value)
            k, v = k + ck, v + cv
        return k, v
    if isinstance(obj, (list, tuple)):
        k = v = 0
        for value in obj:
            ck, cv = count_nodes(value)
            k, v = k + ck, v + cv
        return k, v
    return (0, 1) if isinstance(obj, str) else (0, 0)


def scan_build(data):
    """List of (path, kind, name) hits for a loaded build dict (empty = clean)."""
    return list(tp.find_forbidden(data))


def check_file(path):
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    if not is_build_file(data):
        return None
    hits = scan_build(data)
    keys, strings = count_nodes(data)
    return {"file": os.path.basename(path), "dataset": data["dataset"], "rows": len(data["rows"]), "keys": keys, "strings": strings, "hits": hits}


def main(argv):
    files = [os.path.abspath(a) for a in argv] or sorted(glob.glob(os.path.join(BUILD, "*.json")))
    failed, scanned = False, set()
    for path in files:
        result = check_file(path)
        if result is None:
            continue
        scanned.add(result["dataset"])
        if result["dataset"] != os.path.splitext(result["file"])[0]:
            print(f"FAIL {result['file']}: dataset id {result['dataset']!r} does not match the file name")
            failed = True
        if result["hits"]:
            failed = True
            path_, kind, name = result["hits"][0]
            print(f"FAIL {result['file']}: {len(result['hits'])} forbidden name(s)/host(s); first offending path: {path_} ({kind}, matched {name!r})")
        else:
            print(f"OK   {result['file']}: dataset {result['dataset']}, {result['rows']} rows, {result['keys']:,} keys and {result['strings']:,} string values scanned, 0 forbidden names or hosts")
    if not argv:
        for expected in EXPECTED:
            if expected not in scanned:
                print(f"FAIL expected publishable build file {expected}.json is missing or not build-shaped")
                failed = True
    print("RESULT:", "FAIL" if failed else "PASS (no forbidden name or host in any publishable build file)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
