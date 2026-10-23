"""Write court_sites.json: every federal district and bankruptcy court (corpus court_spine id) with the host of its official website.

Court ids are the court_spine / CourtListener ids. The site of a court is taken as scripts/enrichment/court_locations does it: the
host code when it equals the court id, otherwise the court's link label and column on uscourts.gov's "Court Website Links" page
(raw page kept in private/acq/court_locations/uscourts/). Courts that share one website (S.D. Tex., W.D. Mo., D. Guam, D. Idaho)
list each other in `shared_with`.

    python3 -I -B scripts/enrichment/judge_practices/make_roster.py
"""
from __future__ import annotations

import json
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment", "court_locations"))
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))

import build_court_locations as bcl  # noqa: E402

LOOK = os.path.join(ROOT, "private", "build", "court_locations", "lookups")
SPINE = os.path.join(ROOT, "private", "build", "judge_xwalk", "lookups", "court_spine.jsonl")
OUT = os.path.join(HERE, "court_sites.json")


def main() -> None:
    courts = {r["id"]: r for r in json.load(open(os.path.join(LOOK, "cl_courts.json")))["rows"]}
    spine = {}
    with open(SPINE, encoding="utf-8") as h:
        for line in h:
            r = json.loads(line)
            spine[r["id"]] = r
    sites, unresolved = bcl.site_courts(courts)
    if unresolved:
        raise SystemExit(f"unresolved sites: {unresolved}")
    rows = []
    by_host = defaultdict(list)
    for host, hits in sites.items():
        for cid, how in hits:
            c = courts.get(cid)
            if not c or c["jurisdiction"] not in ("FD", "FB"):
                continue
            by_host[host].append(cid)
    for host, ids in sorted(by_host.items()):
        for cid in sorted(ids):
            c = courts[cid]
            s = spine.get(cid, {})
            rows.append({
                "court_id": cid,
                "level": "district" if c["jurisdiction"] == "FD" else "bankruptcy",
                "name": s.get("title") or c["full_name"],
                "state": s.get("state") or "",
                "host": host,
                "home_url": f"https://{host}/",
                "shared_with": sorted(i for i in ids if i != cid),
            })
    rows.sort(key=lambda r: (r["level"], r["court_id"]))
    with open(OUT, "w", encoding="utf-8") as h:
        json.dump({"source": "court_locations.site_courts over the uscourts.gov Court Website Links page", "courts": rows}, h, indent=1, sort_keys=True)
        h.write("\n")
    lv = defaultdict(int)
    for r in rows:
        lv[r["level"]] += 1
    print(len(rows), dict(lv), "hosts:", len(by_host))


if __name__ == "__main__":
    main()
