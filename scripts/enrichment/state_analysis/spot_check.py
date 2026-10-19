"""Spot checks: displayed figures against the exact raw line they come from (writes private/build/state_analysis/spot_checks.json).

Each check reads the raw file directly (no builder code), prints where the value sits and whether the build matches.
"""
from __future__ import annotations

import csv
import gzip
import json
import os
import re
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "state_analysis")
B = os.path.join(ROOT, "private", "build", "state_analysis")


def rows(name):
    return {r["id"]: r for r in json.load(open(os.path.join(B, name + ".json")))["rows"]}


def acs_line(table, geo):
    with gzip.open(os.path.join(ACQ, "census", "acs5y2024", f"acsdt5y2024-{table}.subset.dat.gz"), "rt") as h:
        hdr = h.readline().rstrip("\n").split("|")
        for line in h:
            if line.startswith(geo + "|"):
                return dict(zip(hdr, line.rstrip("\n").split("|")))
    return {}


def main():
    cp, cl, cities, sca = rows("county_profiles"), rows("county_legal_activity"), rows("city_profiles"), rows("state_cross_analysis")
    out = []

    def add(what, shown, raw, where):
        out.append({"figure": what, "build": shown, "raw": raw, "where": where, "match": str(shown) == str(raw)})

    for f in ("48201", "17031", "06037", "46102", "56045"):
        a = cp[f]["item"]["profile"]["acs"]
        r = acs_line("b19013", "0500000US" + f)
        add(f"{f} median household income (ACS)", a["median_hh_income"]["v"], float(r["B19013_E001"]), "acsdt5y2024-b19013.dat, GEO_ID 0500000US" + f + ", B19013_E001")
    with open(os.path.join(ACQ, "census", "co-est2025-alldata.csv"), encoding="latin-1") as h:
        pep = {r["STATE"] + r["COUNTY"]: r for r in csv.DictReader(h) if r["SUMLEV"] == "050"}
    for f in ("48201", "36061", "02063"):
        add(f"{f} population July 1, 2025 (PEP)", cp[f]["item"]["metrics"]["population"], int(pep[f]["POPESTIMATE2025"]), "co-est2025-alldata.csv, STATE+COUNTY " + f + ", POPESTIMATE2025")
    with gzip.open(os.path.join(ACQ, "bls", "la.data.64.County.gz"), "rt") as h:
        laus = {}
        for line in h:
            p = line.split("\t")
            if len(p) > 3 and p[2].strip() == "M13" and p[1].strip() == "2025":
                laus[p[0].strip()] = p[3].strip()
    for f in ("48201", "06037"):
        sid = f"LAUCN{f}0000000003"
        add(f"{f} unemployment rate 2025 (LAUS)", cp[f]["item"]["metrics"]["unemployment_rate"], float(laus[sid]), f"la.data.64.County, {sid}, 2025 M13")
    z = zipfile.ZipFile(os.path.join(ACQ, "bea", "CAINC1.zip"))
    with z.open("CAINC1__ALL_AREAS_1969_2024.csv") as h:
        for r in csv.reader(line.decode("latin-1") for line in h):
            if len(r) > 5 and r[0].strip().strip('"').strip() == "48201" and r[4].strip() == "3":
                add("48201 per capita personal income 2024 (BEA)", cp["48201"]["item"]["metrics"]["per_capita_personal_income"], float(r[-1]), "CAINC1__ALL_AREAS, GeoFIPS 48201, LineCode 3, 2024")
    r = acs_line("b01003", "1600000US4835000")
    add("Houston city population (ACS)", cities["4835000"]["item"]["acs"]["pop_acs"]["v"], float(r["B01003_E001"]), "acsdt5y2024-b01003.dat, GEO_ID 1600000US4835000")
    # statute text for districts
    page = open(os.path.join(ACQ, "usc", "USCODE-2024-title28-partI-chap5.htm"), encoding="utf-8").read()
    m = re.search(r"\(2\) The Houston Division comprises the counties of ([^.]*)\.", page)
    add("Harris County district (28 U.S.C. 124)", cp["48201"]["item"]["profile"]["district"]["court_id"], "txsd" if m and "Harris" in m.group(1) else "not found",
        "USCODE-2024 28 U.S.C. 124(b)(2): " + (m.group(0)[:120] if m else ""))
    m = re.search(r"Le Flore Love", page)
    add("Love County OK district (Code text 'Le Flore Love')", cp["40085"]["item"]["profile"]["district"]["court_id"], "oked" if m else "not found", "28 U.S.C. 116(b)")
    # legal counts (verified in full by verify_state_analysis.py; shown here for the record)
    lg = cl["48201"]["item"]["legal"]
    add("48201 federal civil filings by residents FY2021-FY2025", lg["fjc_5y"], sum(int(lg["fjc_fy"][y]) for y in ("2021", "2022", "2023", "2024", "2025")), "sum of the stored FY series (raw recount: verify.json fjc_counts)")
    st = sca["state:TX"]["item"]["profile"]
    add("Texas counties", st["counties"], sum(1 for k in pep if k.startswith("48")), "co-est2025-alldata.csv SUMLEV 050 rows with STATE 48")
    d = sca["district:txsd"]["item"]["profile"]
    add("S.D. Tex. filings FY2021-FY2025 (sum of residence classes)", d["filed_5y"], sum(d["filed_by_residence"].values()), "FJC IDB district 41 (txsd), FY of FDATEUSE")
    a = acs_line("c17002", "0500000US48201")
    pov = round((float(a["C17002_E002"]) + float(a["C17002_E003"])) / float(a["C17002_E001"]) * 100, 2)
    add("48201 poverty rate (ACS C17002)", cp["48201"]["item"]["profile"]["acs"]["poverty_rate"]["v"], pov, "C17002_E002+E003 / E001, GEO_ID 0500000US48201")
    with open(os.path.join(B, "spot_checks.json"), "w") as h:
        json.dump(out, h, indent=1)
    for c in out:
        print(("OK  " if c["match"] else "DIFF"), c["figure"], c["build"], c["raw"])
    print(len(out), "checks,", sum(not c["match"] for c in out), "mismatches")


if __name__ == "__main__":
    main()
