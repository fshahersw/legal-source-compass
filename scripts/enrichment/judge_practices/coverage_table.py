"""Per-court coverage table (markdown) from the built datasets: how each court's site lists judges, counts by kind, documents, profile links.

    python3 -I -B scripts/enrichment/judge_practices/coverage_table.py > private/scratch/enrich/judge_practices/coverage_table.md
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "private", "build", "judge_practices")


def main() -> None:
    cover = json.load(open(os.path.join(OUT, "judge_court_coverage.json"), encoding="utf-8"))["rows"]
    pages = json.load(open(os.path.join(OUT, "judge_court_pages.json"), encoding="utf-8"))["rows"]
    by_court: dict[str, list[dict]] = {}
    for r in pages:
        by_court.setdefault(r["item"]["judge_page"]["court_id"], []).append(r["item"]["judge_page"])
    print("| Court | Level | Listing found | Judges | District | Magistrate | Bankruptcy | Other / no title | Pages / list-only | Documents | Profile linked | Status / note |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|")
    tot = {k: 0 for k in ("judges", "district", "magistrate", "bankruptcy", "other", "pages", "listonly", "docs", "linked")}
    for r in sorted(cover, key=lambda r: r["item"]["coverage"]["court_id"]):
        cv = r["item"]["coverage"]
        js = by_court.get(cv["court_id"], [])
        tc = [j["title_class"] for j in js]
        district = sum(1 for t in tc if t in ("district_judge", "senior_district_judge", "chief_district_judge"))
        magistrate = sum(1 for t in tc if t in ("magistrate_judge", "chief_magistrate_judge", "senior_magistrate_judge"))
        bankruptcy = sum(1 for t in tc if t in ("bankruptcy_judge", "chief_bankruptcy_judge"))
        other = len(js) - district - magistrate - bankruptcy
        listing = [lp for lp in cv["listing_pages"] if lp.get("status") == 200 and (lp.get("judges_found") or 0) > 0]
        found = "yes" if listing else ("no" if cv["status"] in ("no_judges_found", "blocked_robots", "blocked") else "yes (no entries)")
        note = cv["status"].replace("_", " ") + (f": {cv['note']}" if cv.get("note") and cv["status"] in ("no_judges_found", "blocked_robots", "blocked") else "")
        print(f"| {cv['court_id']} | {cv['level'][:4]} | {found} | {cv['judges']} | {district} | {magistrate} | {bankruptcy} | {other} | "
              f"{cv['judge_pages']} / {cv['listing_entries']} | {cv['documents']} | {cv['profiles_linked']} | {note[:110]} |")
        tot["judges"] += cv["judges"]
        tot["district"] += district
        tot["magistrate"] += magistrate
        tot["bankruptcy"] += bankruptcy
        tot["other"] += other
        tot["pages"] += cv["judge_pages"]
        tot["listonly"] += cv["listing_entries"]
        tot["docs"] += cv["documents"]
        tot["linked"] += cv["profiles_linked"]
    print(f"| **Total ({len(cover)} courts)** | | | {tot['judges']} | {tot['district']} | {tot['magistrate']} | {tot['bankruptcy']} | {tot['other']} | "
          f"{tot['pages']} / {tot['listonly']} | {tot['docs']} (document links per judge; a file linked by two judges counts twice) | {tot['linked']} | |")


if __name__ == "__main__":
    main()
