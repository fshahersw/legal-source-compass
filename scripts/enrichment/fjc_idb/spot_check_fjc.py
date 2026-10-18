"""Independent spot check of the displayed FJC IDB figures.

Reads the raw tab-delimited file straight from private/acq/fjc_idb/cv88on.zip with the csv module (no DuckDB, none of civil_agg's
SQL) and recomputes selected figures from the codebook's definitions; then compares them with the values stored in the built files.
Writes private/build/fjc_idb/spot_checks.json. Exit code 1 if any figure differs.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import json
import os
import statistics
import sys
import zipfile
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
import idb_codes as ic  # noqa: E402

ZIP = os.path.join(ROOT, "private", "acq", "fjc_idb", "cv88on.zip")
BUILD = os.path.join(ROOT, "private", "build", "fjc_idb")
CODEBOOK = os.path.join(ROOT, "private", "acq", "courtlistener", "idb_civil_codebook_1988_forward.txt")
DISTRICTS = ["cand", "nysd", "txsd", "wyd", "flsd", "njd"]
YEARS = [2025, 2023, 2015]
MDLS = [2738, 2327, 2885, 2592]
PRODUCT = {195, 245, 315, 345, 355, 365, 367, 368, 385}


def d(s: str):
    try:
        return dt.datetime.strptime(s.strip(), "%m/%d/%Y").date()
    except ValueError:
        return None


def fy(date) -> int | None:
    return None if date is None else date.year + (1 if date.month >= 10 else 0)


def num(s: str):
    s = s.strip()
    if s in ("", "-8"):
        return None
    try:
        return int(s)
    except ValueError:
        return None


def main() -> int:
    text = open(CODEBOOK).read()
    labels = ic.parse_districts(text)
    code_of = {ic.court_id_for(lbl): code for code, lbl in labels.items()}
    want = {code_of[c]: c for c in DISTRICTS}
    filed = defaultdict(int)       # (court, fy) -> n
    cls = defaultdict(int)         # (court, fy) -> class action filings
    term = defaultdict(int)        # (court, fy) -> terminations
    days = defaultdict(list)       # (court, fy) -> days
    fil_by_fy = defaultdict(int)   # court -> fy -> n for cumulative
    term_by_fy = defaultdict(int)
    us_filed = defaultdict(int)
    us_term = defaultdict(int)
    nos365 = defaultdict(int)
    product = defaultdict(int)
    mdl = defaultdict(lambda: {"cases": 0, "pending": 0, "districts": set(), "days": []})
    rows = 0
    with zipfile.ZipFile(ZIP) as z, z.open("cv88on.txt") as raw:
        rdr = csv.reader(io.TextIOWrapper(raw, encoding="cp1252", errors="replace", newline=""), delimiter="\t", quoting=csv.QUOTE_NONE)
        header = next(rdr)
        ix = {name: i for i, name in enumerate(header)}
        for r in rdr:
            if len(r) < len(header):
                continue
            rows += 1
            code = r[ix["DISTRICT"]].strip()
            pending = r[ix["STATUSCD"]].strip() == "S" or r[ix["TAPEYEAR"]].strip() == "2099"
            ff = fy(d(r[ix["FDATEUSE"]]))
            tt = None if pending else fy(d(r[ix["TDATEUSE"]]))
            nos = num(r[ix["NOS"]])
            if ff is not None:
                us_filed[ff] += 1
                if nos == 365:
                    nos365[ff] += 1
                if nos in PRODUCT:
                    product[ff] += 1
            if tt is not None:
                us_term[tt] += 1
            if code in want:
                c = want[code]
                if ff is not None:
                    filed[(c, ff)] += 1
                    fil_by_fy[(c, ff)] += 1
                    if num(r[ix["CLASSACT"]]) == 1:
                        cls[(c, ff)] += 1
                if tt is not None:
                    term[(c, tt)] += 1
                    term_by_fy[(c, tt)] += 1
                    fd, td = d(r[ix["FILEDATE"]]), d(r[ix["TERMDATE"]])
                    if fd and td and td >= fd:
                        days[(c, tt)].append((td - fd).days)
            m = r[ix["MDLDOCK"]].strip()
            if m.isdigit() and int(m) in MDLS:
                e = mdl[int(m)]
                e["cases"] += 1
                e["pending"] += 1 if pending else 0
                e["districts"].add(code)
                fd, td = d(r[ix["FILEDATE"]]), d(r[ix["TERMDATE"]])
                if not pending and fd and td and td >= fd:
                    e["days"].append((td - fd).days)

    built = {n: json.load(open(os.path.join(BUILD, n + ".json"))) for n in ("fjc_civil_districts", "fjc_civil_national", "fjc_civil_nos", "fjc_civil_mdls")}
    checks = []

    def check(what, where, mine, shown):
        ok = (mine == shown) if not isinstance(mine, float) or shown is None else abs(mine - shown) < 1e-6
        checks.append({"figure": what, "where": where, "recomputed_from_raw": mine, "displayed": shown, "match": bool(ok)})

    dist_rows = {r["id"]: r["item"]["profile"] for r in built["fjc_civil_districts"]["rows"]}
    for c in DISTRICTS:
        ser = {s["fy"]: s for s in dist_rows[c]["series"]}
        for y in YEARS:
            s = ser.get(y)
            if not s:
                continue
            pend = sum(v for (cc, f), v in fil_by_fy.items() if cc == c and f <= y) - sum(v for (cc, f), v in term_by_fy.items() if cc == c and f <= y)
            med = statistics.median(days[(c, y)]) if days[(c, y)] else None
            check("civil filings", f"fjc_civil_districts {c} FY{y}", filed[(c, y)], s["filings"])
            check("civil terminations", f"fjc_civil_districts {c} FY{y}", term[(c, y)], s["terminations"])
            check("pending at Sep 30", f"fjc_civil_districts {c} FY{y}", pend, s["pending_end"])
            check("median days to termination", f"fjc_civil_districts {c} FY{y}", float(med) if med is not None else None, s["median_days"])
            check("class-action filings", f"fjc_civil_districts {c} FY{y}", cls[(c, y)], s["class_action"])
    us = {r["id"]: r["item"]["year"] for r in built["fjc_civil_national"]["rows"] if r["id"].startswith("US:FY")}
    for y in (2025, 2024, 2019):
        check("national civil filings", f"fjc_civil_national US:FY{y}", us_filed[y], us[f"US:FY{y}"]["filings"])
        check("national civil terminations", f"fjc_civil_national US:FY{y}", us_term[y], us[f"US:FY{y}"]["terminations"])
    nos_rows = {r["id"]: r["item"]["profile"] for r in built["fjc_civil_nos"]["rows"]}
    s365 = {s["fy"]: s for s in nos_rows["nos:365"]["series"]}
    for y in (2025, 2023):
        check("NOS 365 filings", f"fjc_civil_nos nos:365 FY{y}", nos365[y], s365[y]["filings"])
    sprod = {s["fy"]: s for s in nos_rows["group:product"]["series"]}
    check("product-group filings", "fjc_civil_nos group:product FY2025", product[2025], sprod[2025]["filings"])
    mdl_rows = {r["id"]: r["item"]["profile"]["totals"] for r in built["fjc_civil_mdls"]["rows"]}
    for m in MDLS:
        e = mdl[m]
        t = mdl_rows[f"mdl:{m}"]
        check("MDL cases carrying the number", f"fjc_civil_mdls mdl:{m}", e["cases"], t["cases"])
        check("MDL cases pending", f"fjc_civil_mdls mdl:{m}", e["pending"], t["pending"])
        check("MDL districts", f"fjc_civil_mdls mdl:{m}", len(e["districts"]), t["districts"])
        check("MDL median days to termination", f"fjc_civil_mdls mdl:{m}", float(statistics.median(e["days"])) if e["days"] else None, t["median_days"])
    bad = [c for c in checks if not c["match"]]
    out = {"method": "independent csv-module pass over private/acq/fjc_idb/cv88on.zip, no DuckDB, definitions from the codebook", "rows_read": rows,
           "checks": len(checks), "mismatches": len(bad), "details": checks}
    with open(os.path.join(BUILD, "spot_checks.json"), "w") as h:
        json.dump(out, h, indent=1, default=str)
    print(f"{len(checks)} figures recomputed from {rows:,} raw rows; {len(bad)} mismatches")
    for c in bad[:10]:
        print("MISMATCH", c)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
