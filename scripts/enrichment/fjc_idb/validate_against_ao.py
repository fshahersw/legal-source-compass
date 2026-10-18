"""Cross-check the IDB-derived district series against the AO's published civil totals already in the corpus.

`court_stats_district_nos` (Judicial Business tables, FY2014-FY2025) stores civil_filed / civil_terminated / civil_pending per district.
For every district and fiscal year we compare the IDB-derived value (built file fjc_civil_districts.json) with the AO's, and report exact
matches, absolute and percent differences, and the worst cases. Differences are reported, never adjusted.
Run with the environment sourced (one read-only fetch); writes private/build/fjc_idb/validation_vs_ao.json.
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))

import corpus_writer as writer  # noqa: E402

BUILD = os.path.join(ROOT, "private", "build", "fjc_idb")


def main() -> None:
    rows = writer.fetch_all("court_stats_district_nos", select="id,item")
    ao = {}
    for r in rows:
        st = r["item"].get("stats") or {}
        if not st.get("years") or "civil_filed" not in st:
            continue
        ao[r["id"]] = {"years": st["years"], "filed": st["civil_filed"], "terminated": st.get("civil_terminated"), "pending": st.get("civil_pending")}
    built = json.load(open(os.path.join(BUILD, "fjc_civil_districts.json")))
    res = {"filed": [], "terminated": [], "pending": []}
    for row in built["rows"]:
        cid = row["id"]
        a = ao.get(cid)
        if not a:
            continue
        ser = {s["fy"]: s for s in row["item"]["profile"]["series"]}
        for i, fy in enumerate(a["years"]):
            s = ser.get(fy)
            if not s:
                continue
            for key, mine in (("filed", s["filings"]), ("terminated", s["terminations"]), ("pending", s["pending_end"])):
                theirs = (a.get(key) or [None] * len(a["years"]))[i]
                if theirs is None or mine is None:
                    continue
                res[key].append({"court_id": cid, "fy": fy, "idb": mine, "ao": theirs, "diff": mine - theirs})
    summary = {}
    for key, items in res.items():
        exact = sum(1 for x in items if x["diff"] == 0)
        within1 = sum(1 for x in items if abs(x["diff"]) <= max(1, 0.01 * x["ao"]))
        worst = sorted(items, key=lambda x: -abs(x["diff"]) / max(x["ao"], 1))[:8]
        summary[key] = {"compared": len(items), "exact": exact, "within_1pct_or_1_case": within1, "worst": worst,
                        "districts": len({x["court_id"] for x in items}), "fy_range": [min(x["fy"] for x in items), max(x["fy"] for x in items)] if items else None}
    with open(os.path.join(BUILD, "validation_vs_ao.json"), "w") as h:
        json.dump({"source": "court_stats_district_nos (US Courts Judicial Business tables) in the corpus", "summary": summary, "details": res}, h)
    for k, v in summary.items():
        print(k, {a: b for a, b in v.items() if a != "worst"})
        for w in v["worst"][:3]:
            print("   worst", w)


if __name__ == "__main__":
    main()
