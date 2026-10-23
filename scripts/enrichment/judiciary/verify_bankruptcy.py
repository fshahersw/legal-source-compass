"""Independent checks of fjc_bankruptcy_districts. Prints a JSON summary with a failure count; writes verify_bankruptcy.json.

  python3 -I -B verify_bankruptcy.py [--skip-raw]

1. Second path: pandas (chunked C parser over `unzip -p` of both raw zips, not the streamed aggregate) recomputes, for every
   district x snapshot, filed / closed / pending and filed by chapter (raw ORGFLCHP code read with the code set of the FILEDATE) and by
   nature of debt, and compares every cell with the build.
2. Published totals: AO Judicial Business Table F-2 (filings by chapter, business and nonbusiness, FY2008-FY2025) as held in
   the corpus dataset court_jb_bankruptcy (lookup private/build/judiciary/lookups/ao_f2_bankruptcy.json): total, business,
   nonbusiness, chapters 7, 11, 12, 13 and business chapter 11, per bankruptcy court and year.
"""
from __future__ import annotations

import collections
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import fetchlib as fl  # noqa: E402
import jcodes as jc  # noqa: E402

BUILD = fl.ROOT / "private" / "build" / "judiciary"
COLS = ["SNAPSHOT", "SNAPFILE", "SNAPCLOS", "SNAPPEND", "DISTRICT", "ORGFLDT", "FILEDATE", "ORGFLCHP", "NTRDBT"]


def raw_pass():
    import pandas as pd

    cells = collections.Counter()
    for z in ("cpbank08to17.zip", "cpbank18on.zip"):
        proc = subprocess.Popen(["unzip", "-p", str(fl.ACQ / "fjc_idb" / z)], stdout=subprocess.PIPE)
        for chunk in pd.read_csv(proc.stdout, sep="\t", dtype=str, usecols=COLS, chunksize=1_000_000, quoting=3, encoding="cp1252", keep_default_na=False):
            snap = chunk["SNAPSHOT"].str.strip()
            per = snap.str[6:10].where(snap.str.startswith("09/30"), "2026-06-30")
            court = chunk["DISTRICT"].str.strip().map(lambda c: jc.district_court_id(c) or "not_recorded")
            orig = chunk["FILEDATE"]  # code set of the filing instance (see build_bankruptcy.py)
            iso = orig.str.slice(6, 10) + "-" + orig.str.slice(0, 2) + "-" + orig.str.slice(3, 5)
            for col, name in (("SNAPFILE", "filed"), ("SNAPCLOS", "closed"), ("SNAPPEND", "pending_end")):
                m = chunk[col].str.strip() == "1"
                for (c, p), n in pd.DataFrame({"c": court[m], "p": per[m]}).value_counts().items():
                    cells[(c, p, name)] += int(n)
            m = chunk["SNAPFILE"].str.strip() == "1"
            sub = pd.DataFrame({"c": court[m], "p": per[m], "code": chunk["ORGFLCHP"][m].str.strip().str.lower(), "iso": iso[m],
                                "debt": chunk["NTRDBT"][m].str.strip().str.lower()})
            # codes changed on Oct 17, 2005: the code set follows the filing instance date
            sub["era"] = (sub["iso"] >= "2005-10-17").map({True: "new", False: "old"})
            for (c, p, code, era), n in sub[["c", "p", "code", "era"]].value_counts().items():
                ch = jc.chapter(code, "new" if era == "new" else "old")
                cells[(c, p, "filed_ch" + ch)] += int(n)
            for (c, p, d), n in sub[["c", "p", "debt"]].value_counts().items():
                cells[(c, p, "filed_" + {"b": "business", "c": "consumer", "o": "other"}.get(d, "not_recorded"))] += int(n)
        proc.wait()
    return cells


def main(argv) -> None:
    build = json.loads((BUILD / "fjc_bankruptcy_districts.json").read_text())
    items = {r["id"]: r["item"] for r in build["rows"]}
    failures, checks = [], 0
    if "--skip-raw" not in argv:
        cells = raw_pass()
        for (court, period, measure), n in cells.items():
            if court == "not_recorded":
                continue
            item = items.get(f"district:{court}")
            s = next((x for x in item["series"] if x["period"] == period), None) if item else None
            checks += 1
            got = None if s is None else s.get(measure, 0)
            if got != n:
                failures.append({"check": "pandas cell", "cell": [court, period, measure], "build": got, "pandas": n})
    # ---- F-2
    f2 = json.loads((BUILD / "lookups" / "ao_f2_bankruptcy.json").read_text())
    stats = collections.Counter()
    diffs = []
    combined = {"arkansas-combined": ["ared", "arwd"]}  # F-2 reports the two Arkansas districts together
    for row in f2:
        bk = row["id"]
        dists = [items.get(f"district:{d}") for d in combined[bk]] if bk in combined else \
            [next((r for r in items.values() if r.get("bankruptcy_court_id") == bk), None)]
        if not all(dists):
            stats["f2_rows_without_district_record"] += 1
            continue
        for i, fy in enumerate(row["years"]):
            if fy < 2008:
                continue
            ss = [next((x for x in d["series"] if x["period"] == str(fy)), None) for d in dists]
            if not all(ss):
                continue
            s = {k: sum(x[k] for x in ss) for k in ("filed", "filed_business", "filed_ch7", "filed_ch11", "filed_ch12", "filed_ch13", "filed_business_ch11")}
            mine = {"total": s["filed"], "bus": s["filed_business"], "nonbus": s["filed"] - s["filed_business"], "ch7": s["filed_ch7"],
                    "ch11": s["filed_ch11"], "ch12": s["filed_ch12"], "ch13": s["filed_ch13"], "bus_ch11": s["filed_business_ch11"]}
            for k, v in mine.items():
                pub = (row.get(k) or [None] * 30)[i]
                if pub is None:
                    continue
                stats[f"{k}_compared"] += 1
                if v == pub:
                    stats[f"{k}_exact"] += 1
                else:
                    diffs.append({"court": bk, "fy": fy, "field": k, "build": v, "f2": pub, "diff": v - pub})
    worst = sorted(diffs, key=lambda d: -abs(d["diff"]))[:15]
    # The codebook warns that "statistics based on the FY 2008 BPNS snapshot ... may slightly differ from the published FY 2008
    # tables"; FY2008 total differences are reported, differences in any later year are failures.
    total_mismatch = [d for d in diffs if d["field"] == "total"]
    stats["total_differences_fy2008"] = sum(1 for d in total_mismatch if d["fy"] == 2008)
    for d in total_mismatch:
        if d["fy"] != 2008:
            failures.append({"check": "F-2 total filings", **d})
    checks += stats["total_compared"]
    report = {"checks": checks, "failures": len(failures), "failure_examples": failures[:20], "f2": dict(stats), "f2_worst_differences": worst,
              "f2_differences_by_field": dict(collections.Counter(d["field"] for d in diffs))}
    (BUILD / "verify_bankruptcy.json").write_text(json.dumps(report, indent=1))
    print(json.dumps({k: report[k] for k in ("checks", "failures", "f2", "f2_differences_by_field")}))


if __name__ == "__main__":
    main(sys.argv[1:])
