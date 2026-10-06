"""Write /tmp/sc4/nh/REPORT.json from receipts and verification artifacts."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from sc_common import Archive  # noqa: E402

from nh_lib import BASE  # noqa: E402


def main(work):
    arc = Archive(work)
    routes = {"direct": 0, "firecrawl": 0}
    bytes_total = 0
    complete = 0
    for r in arc.index.values():
        if r.get("state") == "complete":
            complete += 1
            bytes_total += r.get("bytes", 0)
            routes[r.get("route", "direct")] = routes.get(r.get("route", "direct"), 0) + 1
    inv = {}
    if os.path.exists(os.path.join(work, "inventory_summary.json")):
        inv = json.load(open(os.path.join(work, "inventory_summary.json")))
    verify = {}
    if os.path.exists(os.path.join(work, "verify_report.json")):
        verify = json.load(open(os.path.join(work, "verify_report.json")))
    manifest = {}
    if os.path.exists(os.path.join(work, "packet", "manifest.json")):
        manifest = json.load(open(os.path.join(work, "packet", "manifest.json")))
    titles = len(json.load(open(os.path.join(work, "title_toc_paths.json")))) if os.path.exists(
        os.path.join(work, "title_toc_paths.json")
    ) else None
    chapters = len(json.load(open(os.path.join(work, "mrg_paths.json")))) if os.path.exists(
        os.path.join(work, "mrg_paths.json")
    ) else None
    report = {
        "state": "NH",
        "source_urls": [BASE + "NHTOC.htm"],
        "edition_statement": None,
        "currency_statement": None,
        "official_status_statement": None,
        "notes": "No edition/currency prose found on NHTOC.htm at acquisition time.",
        "titles": titles,
        "chapters_mrg": chapters,
        "sections_inventory": inv.get("sections"),
        "sections_parsed": manifest.get("sections") or verify.get("sections"),
        "raw_objects_complete": complete,
        "raw_bytes": bytes_total,
        "requests_indexed": len(arc.index),
        "routes": routes,
        "verification": verify,
        "acquire_failures": {
            "titles": json.load(open(os.path.join(work, "acquire_title_failed.json")))
            if os.path.exists(os.path.join(work, "acquire_title_failed.json"))
            else [],
            "chapter_toc": json.load(open(os.path.join(work, "acquire_chapter_failed.json")))
            if os.path.exists(os.path.join(work, "acquire_chapter_failed.json"))
            else [],
            "mrg": json.load(open(os.path.join(work, "acquire_mrg_failed.json")))
            if os.path.exists(os.path.join(work, "acquire_mrg_failed.json"))
            else [],
        },
    }
    json.dump(report, open(os.path.join(work, "REPORT.json"), "w"), indent=2)
    return report


if __name__ == "__main__":
    print(json.dumps(main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/sc4/nh"), indent=2))
