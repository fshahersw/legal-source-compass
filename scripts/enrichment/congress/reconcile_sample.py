"""Reconcile the stored bill lists of a sample of members with the Congress.gov API's own sponsored and cosponsored lists.

  python3 -I -B reconcile_sample.py [N_house] [N_senate]

The sample is members who served only in the 108th-119th Congress (so the whole of their service lies inside the stored bill
records) with moderate list lengths, chosen with a fixed seed. For each member the API's /member/{id}/sponsored-legislation list is
split into measures (a bill number) and amendments (an amendment number): the API's sponsored count includes amendments, the
stored count does not. The measures are compared by identity (Congress, type, number) with the measures stored as sponsored (first
listed sponsor) and, for a smaller sample, the cosponsored list is compared with the stored cosponsored list. Differences are
printed, not hidden: a measure introduced after the Bill Status snapshot was taken is expected to appear only in the API.
Uses the stream's request budget (about 40 requests).
"""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cg_api as api  # noqa: E402

BUILD = api.BUILD
TYPES = {"HR": "hr", "S": "s", "HJRES": "hjres", "SJRES": "sjres", "HCONRES": "hconres", "SCONRES": "sconres", "HRES": "hres", "SRES": "sres"}


def fetch_all(path: str, key: str) -> list[dict]:
    first = api.get(path, offset=0, limit=250)
    total = int(first["pagination"]["count"])
    items = list(first[key])
    for off in range(250, total, 250):
        items.extend(api.get(path, offset=off, limit=250)[key])
    return items


def main(argv: list[str]) -> None:
    n_house = int(argv[0]) if argv else 8
    n_senate = int(argv[1]) if len(argv) > 1 else 4
    rows = json.loads((BUILD / "congress_members.json").read_text())["rows"]
    rnd = random.Random(20261023)
    pool = [r for r in rows if r["detail"]["member"]["bills"]["servedOnlyInCollection"] and r["detail"]["member"]["current"] is not None
            and (r["detail"]["member"]["legislation"]["sponsored"] or 0) <= 450 and r["detail"]["member"]["bills"]["sponsoredTotal"] > 0]
    house = [r for r in pool if r["detail"]["member"]["chamber"] == "House of Representatives"]
    senate = [r for r in pool if r["detail"]["member"]["chamber"] == "Senate"]
    sample = rnd.sample(house, min(n_house, len(house))) + rnd.sample(senate, min(n_senate, len(senate)))
    out = []
    for r in sample:
        bio = r["id"]
        m = r["detail"]["member"]
        items = fetch_all(f"/member/{bio}/sponsored-legislation", "sponsoredLegislation")
        measures = {(int(i["congress"]), TYPES[i["type"]], int(i["number"])) for i in items if i.get("number") and i.get("type") in TYPES}
        amendments = sum(1 for i in items if i.get("amendmentNumber"))
        res = {"bioguide": bio, "name": m["names"]["inverted"], "chamber": m["chamber"], "api_list_items": len(items), "api_measures": len(measures),
               "api_amendments": amendments, "api_count_field": m["legislation"]["sponsored"], "stored_sponsored": m["bills"]["sponsoredTotal"],
               "api_measures_by_congress": {}, "stored_by_congress": m["bills"]["sponsoredByCongress"]}
        for c, _, _ in measures:
            res["api_measures_by_congress"][str(c)] = res["api_measures_by_congress"].get(str(c), 0) + 1
        res["measures_equal_stored"] = res["api_measures"] == res["stored_sponsored"]
        res["by_congress_equal"] = {int(k): v for k, v in res["api_measures_by_congress"].items()} == {int(k): v for k, v in m["bills"]["sponsoredByCongress"].items() if v}
        out.append(res)
    cos = [r for r in sample if (r["detail"]["member"]["legislation"]["cosponsored"] or 0) <= 700][:12]
    cres = []
    for r in cos:
        bio = r["id"]
        items = fetch_all(f"/member/{bio}/cosponsored-legislation", "cosponsoredLegislation")
        api_ids = {(int(i["congress"]), TYPES[i["type"]], int(i["number"])) for i in items if i.get("number") and i.get("type") in TYPES}
        stored = {(int(c), t, n) for c, types in r["detail"]["cosponsored"]["byCongress"].items() for t, nums in types.items() for n in nums}
        cres.append({"bioguide": bio, "api_items": len(items), "api_measures": len(api_ids), "stored": len(stored), "equal": api_ids == stored,
                     "only_in_api": len(api_ids - stored), "only_in_stored": len(stored - api_ids),
                     "only_in_api_examples": sorted(api_ids - stored)[:4], "only_in_stored_examples": sorted(stored - api_ids)[:4]})
    report = {"sponsored": out, "cosponsored": cres, "requests_used": api.used()}
    (BUILD / "reconcile_sample.json").write_text(json.dumps(report, indent=1))
    ok_sp = sum(1 for x in out if x["measures_equal_stored"])
    ok_bc = sum(1 for x in out if x["by_congress_equal"])
    ok_co = sum(1 for x in cres if x["equal"])
    print(json.dumps({"sponsored_members": len(out), "sponsored_measures_equal": ok_sp, "sponsored_by_congress_equal": ok_bc,
                      "cosponsored_members": len(cres), "cosponsored_identity_equal": ok_co, "requests_used": api.used()}))
    for x in out:
        if not x["measures_equal_stored"]:
            print("  sponsored differs", x["bioguide"], x["name"], "API measures", x["api_measures"], "stored", x["stored_sponsored"], "amendments", x["api_amendments"])
    for x in cres:
        if not x["equal"]:
            print("  cosponsored differs", x["bioguide"], "only API", x["only_in_api"], x["only_in_api_examples"], "only stored", x["only_in_stored"], x["only_in_stored_examples"])


if __name__ == "__main__":
    main(sys.argv[1:])
