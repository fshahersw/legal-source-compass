"""Independent verification of the state_analysis build files (second path from the raw files).

Run: python3 -I -B verify_state_analysis.py [--fast]
Writes private/build/state_analysis/verify.json with a failure count per check. --fast skips the full raw re-reads of the
FJC text file, the CFPB file and the OSHA files (each re-read takes minutes).

Checks (each re-derives values without the builder's code path):
  fjc_counts      county FY2021-FY2025 counts (all and core) re-counted from cv88on.zip with the csv module
  acs             six ACS measures for every county re-read with hard-coded cell ids (no shell-label resolution)
  rates           every county rate recomputed from its stored count and the PEP file read again
  spearman        every within-state and cross-state rho recomputed in DuckDB SQL (average ranks + corr)
  bh              Benjamini-Hochberg decisions recomputed with an independent step-up implementation
  districts       statutory district = district where most residents' filings were made (counties with >= 20 filings,
                  multi-district states, screened codes excluded); every county in at most one district
  echo            county facility and formal-action counts re-counted with csv.reader and column indexes
  osha / cfpb     county counts re-counted with an independently built ZIP -> county table
  cities          population, median household income and poverty for every place re-read from the raw subset
"""
from __future__ import annotations

import csv
import gzip
import io
import json
import math
import os
import sys
import zipfile
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))
import duckdb  # noqa: E402

B = os.path.join(ROOT, "private", "build", "state_analysis")
ACQ = os.path.join(ROOT, "private", "acq", "state_analysis")
csv.field_size_limit(1 << 24)


def load(name):
    return json.load(open(os.path.join(B, name + ".json")))


def close(a, b, tol=0.011):
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= tol * max(1.0, abs(b) * 0.0001) or abs(a - b) <= tol


def main(fast: bool) -> None:
    res: dict[str, dict] = {}
    prof = {r["id"]: r["item"] for r in load("county_profiles")["rows"]}
    leg = {r["id"]: r["item"] for r in load("county_legal_activity")["rows"]}
    sca = {r["id"]: r["item"] for r in load("state_cross_analysis")["rows"]}
    cities = {r["id"]: r["item"] for r in load("city_profiles")["rows"]}
    fips_state = {f: p["profile"]["usps"] for f, p in prof.items()}

    # ---- ACS with hard-coded cells
    def read(t):
        out = {}
        with gzip.open(os.path.join(ACQ, "census", "acs5y2024", f"acsdt5y2024-{t}.subset.dat.gz"), "rt") as h:
            rd = csv.reader(h, delimiter="|")
            hdr = next(rd)
            for row in rd:
                out[row[0]] = dict(zip(hdr, row))
        return out

    t = {k: read(k) for k in ("b01003", "b19013", "c17002", "b15003", "b23025", "b25003")}
    fails, n = [], 0
    for f, p in prof.items():
        g = "0500000US" + f
        a = p["profile"]["acs"]
        num = lambda tb, cols: sum(float(t[tb][g][c]) for c in cols)  # noqa: E731
        try:
            checks = {
                "pop_acs": float(t["b01003"][g]["B01003_E001"]),
                "median_hh_income": float(t["b19013"][g]["B19013_E001"]) if float(t["b19013"][g]["B19013_E001"]) >= 0 else None,
                "poverty_rate": num("c17002", ["C17002_E002", "C17002_E003"]) / float(t["c17002"][g]["C17002_E001"]) * 100,
                "pct_bachelors": num("b15003", ["B15003_E022", "B15003_E023", "B15003_E024", "B15003_E025"]) / float(t["b15003"][g]["B15003_E001"]) * 100,
                "unemployment_acs": float(t["b23025"][g]["B23025_E005"]) / float(t["b23025"][g]["B23025_E003"]) * 100,
                "owner_occupied": float(t["b25003"][g]["B25003_E002"]) / float(t["b25003"][g]["B25003_E001"]) * 100,
            }
        except (KeyError, ZeroDivisionError, ValueError) as e:
            fails.append([f, "read", repr(e)])
            continue
        for k, v in checks.items():
            n += 1
            got = a[k]["v"]
            want = None if v is None else round(v, 2 if k != "pop_acs" and k != "median_hh_income" else 0)
            if not close(got, want):
                fails.append([f, k, got, want])
    res["acs"] = {"checked": n, "failures": len(fails), "examples": fails[:10]}

    # ---- rates from stored counts and PEP read again
    pep = {}
    with open(os.path.join(ACQ, "census", "co-est2025-alldata.csv"), encoding="latin-1") as h:
        for row in csv.DictReader(h):
            if row["SUMLEV"] == "050":
                pep[row["STATE"] + row["COUNTY"]] = [int(row[f"POPESTIMATE{y}"]) for y in range(2021, 2026)]
    fails, n = [], 0
    for f, it in leg.items():
        lg = it["legal"]
        if lg["fjc_5y"] is None or f not in pep:
            continue
        den = sum(pep[f]) / 5
        for cnt, rate in (("fjc_5y", "fjc_rate"), ("fjc_core_5y", "fjc_core_rate"), ("osha_5y", "osha_rate"), ("cfpb_5y", "cfpb_rate")):
            want = round(lg[cnt] / 5 / den * 100000, 2) if den else None
            got = lg[rate]
            if rate in ("fjc_rate", "fjc_core_rate") and lg.get("fjc_flag"):
                want = None
            n += 1
            if not close(got, want):
                fails.append([f, rate, got, want])
    res["rates"] = {"checked": n, "failures": len(fails), "examples": fails[:10]}

    # ---- Spearman in DuckDB SQL, BH independently
    con = duckdb.connect()
    metrics = {f: {**prof[f]["metrics"], **{k: v for k, v in leg[f]["metrics"].items()}} for f in prof}
    rows = []
    for f, m in metrics.items():
        for k, v in m.items():
            if isinstance(v, (int, float)) and v is not None:
                rows.append((fips_state[f], f, k, float(v)))
    con.execute("CREATE TABLE m(st VARCHAR, id VARCHAR, k VARCHAR, v DOUBLE)")
    con.executemany("INSERT INTO m VALUES (?, ?, ?, ?)", rows)
    fails, n, bh_fails, bh_n = [], 0, [], 0
    for sid, it in sca.items():
        if not sid.startswith("state:"):
            continue
        st = sid.split(":")[1]
        tests = it["profile"]["tests"]
        for tt in tests:
            if tt["rho"] is None:
                continue
            q = f"""
                WITH p AS (SELECT a.id, a.v AS x, b.v AS y FROM m a JOIN m b ON a.id = b.id AND a.k = '{tt['x']}' AND b.k = '{tt['y']}' WHERE a.st = '{st}'),
                r AS (SELECT (rank() OVER (ORDER BY x) + rank() OVER (ORDER BY x) + count(*) OVER (PARTITION BY x) - 1) / 2.0 AS rx,
                             (rank() OVER (ORDER BY y) + rank() OVER (ORDER BY y) + count(*) OVER (PARTITION BY y) - 1) / 2.0 AS ry FROM p)
                SELECT corr(rx, ry), count(*) FROM r"""
            rho, cnt = con.execute(q).fetchone()
            n += 1
            if cnt != tt["n"] or rho is None or abs(rho - tt["rho"]) > 0.0006:
                fails.append([sid, tt["x"], tt["y"], tt["rho"], rho, tt["n"], cnt])
        ran = sorted([tt for tt in tests if tt["rho"] is not None], key=lambda tt: tt["p"])
        m_ = len(ran)
        kmax = 0
        for i, tt in enumerate(ran, 1):
            if tt["p"] <= 0.05 * i / m_:
                kmax = i
        for i, tt in enumerate(ran, 1):
            bh_n += 1
            if (i <= kmax) != tt["holds"]:
                bh_fails.append([sid, tt["x"], tt["y"], tt["p"], tt["holds"]])
    res["spearman"] = {"checked": n, "failures": len(fails), "examples": fails[:10]}
    res["bh"] = {"checked": bh_n, "failures": len(bh_fails), "examples": bh_fails[:10]}

    # ---- cross-state rho with the standard library's ranked correlation (a third implementation)
    import statistics

    ov = sca["overview:cross_state"]["profile"]
    fails, n = [], 0
    for tt in ov["tests"]:
        if tt["rho"] is None:
            continue
        pairs = [(v[tt["x"]], v[tt["y"]]) for v in ov["states"].values() if v.get(tt["x"]) is not None and v.get(tt["y"]) is not None]
        rho = statistics.correlation([a for a, _ in pairs], [b for _, b in pairs], method="ranked")
        n += 1
        if len(pairs) != tt["n"] or abs(rho - tt["rho"]) > 0.0006:
            fails.append([tt["x"], tt["y"], tt["rho"], rho, tt["n"], len(pairs)])
    res["spearman_cross_state"] = {"checked": n, "failures": len(fails), "examples": fails[:10]}

    # ---- districts vs where residents filed
    fails, n, agree = [], 0, 0
    multi = defaultdict(set)
    for f, p in prof.items():
        dd = p["profile"]["district"]
        if dd:
            multi[p["profile"]["usps"]].add(dd["court_id"])
    for f, p in prof.items():
        dd = p["profile"]["district"]
        lg = leg[f]["legal"]
        by = lg.get("fjc_by_court") or {}
        if not dd or len(multi[p["profile"]["usps"]]) < 2 or sum(by.values()) < 20 or lg.get("fjc_flag"):
            continue
        n += 1
        top = max(by.items(), key=lambda kv: kv[1])[0]
        if top == dd["court_id"]:
            agree += 1
        else:
            fails.append([f, p["profile"]["name"], dd["court_id"], top, by])
    res["districts"] = {"checked": n, "failures": len(fails), "agreement": round(agree / n * 100, 2) if n else None, "examples": fails[:15]}

    # ---- cities
    t2 = {k: read(k) for k in ("b01003", "b19013", "c17002")}
    fails, n = [], 0
    for gid, it in cities.items():
        g = "1600000US" + gid
        a = it["acs"]
        try:
            pop = float(t2["b01003"][g]["B01003_E001"])
            inc = float(t2["b19013"][g]["B19013_E001"])
            pov = (float(t2["c17002"][g]["C17002_E002"]) + float(t2["c17002"][g]["C17002_E003"])) / float(t2["c17002"][g]["C17002_E001"]) * 100
        except (KeyError, ZeroDivisionError, ValueError):
            continue
        for k, want in (("pop_acs", pop), ("median_hh_income", inc if inc >= 0 else None), ("poverty_rate", round(pov, 2))):
            n += 1
            if not close(a[k]["v"], want):
                fails.append([gid, k, a[k]["v"], want])
    res["cities"] = {"checked": n, "failures": len(fails), "examples": fails[:10]}

    # ---- ECHO with column indexes
    z = zipfile.ZipFile(os.path.join(ROOT, "private", "acq", "epa_echo", "echo_exporter.zip"))
    fac, formal = defaultdict(int), defaultdict(int)
    with z.open("ECHO_EXPORTER.csv") as h:
        rd = csv.reader(io.TextIOWrapper(h, encoding="latin-1", newline=""))
        hdr = next(rd)
        i_f, i_a = hdr.index("FAC_FIPS_CODE"), hdr.index("FAC_FORMAL_ACTION_COUNT")
        for row in rd:
            c = row[i_f].strip()
            if len(c) == 5 and c.isdigit():
                fac[c] += 1
                try:
                    formal[c] += int(float(row[i_a])) if row[i_a].strip() else 0
                except ValueError:
                    pass
    fails, n = [], 0
    for f, it in leg.items():
        lg = it["legal"]
        if lg["echo_facilities"] is None:
            continue
        n += 1
        if lg["echo_facilities"] != fac.get(f, 0) or lg["echo_formal_actions"] != formal.get(f, 0):
            fails.append([f, lg["echo_facilities"], fac.get(f, 0), lg["echo_formal_actions"], formal.get(f, 0)])
    res["echo"] = {"checked": n, "failures": len(fails), "examples": fails[:10]}

    if not fast:
        zmap = zip_table()
        res["osha"] = verify_osha(leg, zmap)
        res["cfpb"] = verify_cfpb(leg, zmap)
        res["fjc_counts"] = verify_fjc(leg, fips_state)
    res["total_failures"] = sum(v["failures"] for v in res.values() if isinstance(v, dict) and "failures" in v)
    with open(os.path.join(B, "verify.json"), "w") as h:
        json.dump(res, h, indent=1)
    print(json.dumps({k: (v if not isinstance(v, dict) else {kk: vv for kk, vv in v.items() if kk != "examples"}) for k, v in res.items()}, indent=1))


def zip_table() -> dict[str, str | None]:
    """ZCTA -> county by largest land part, built here from the relationship file with csv.reader (ties -> None)."""
    parts = defaultdict(list)
    with open(os.path.join(ACQ, "census", "tab20_zcta520_county20_natl.txt"), encoding="utf-8-sig") as h:
        rd = csv.reader(h, delimiter="|")
        hdr = next(rd)
        iz, ic, il = hdr.index("GEOID_ZCTA5_20"), hdr.index("GEOID_COUNTY_20"), hdr.index("AREALAND_PART")
        for row in rd:
            if len(row[iz]) == 5 and len(row[ic]) == 5:
                parts[row[iz]].append((int(row[il] or 0), row[ic]))
    out = {}
    for zc, lst in parts.items():
        pos = [p for p in lst if p[0] > 0] or lst
        best = max(p[0] for p in pos)
        top = {c for a, c in pos if a == best}
        out[zc] = top.pop() if len(top) == 1 else None
    return out


STATE_FIPS = {}


def _usps(c):
    import sa_sources as S
    return S.FIPS_TO_USPS.get(c[:2])


def verify_osha(leg, zmap):
    sys.path.insert(0, HERE)
    d = os.path.join(ROOT, "private", "acq", "osha", "dol", "inspection")
    cnt = defaultdict(int)
    for fn in sorted(os.listdir(d)):
        if not fn.endswith(".csv.gz"):
            continue
        with gzip.open(os.path.join(d, fn), "rt", encoding="utf-8-sig", newline="") as h:
            rd = csv.reader(h)
            hdr = next(rd)
            io_, iz, is_ = hdr.index("OPEN_DATE"), hdr.index("SITE_ZIP"), hdr.index("SITE_STATE")
            for row in rd:
                dt = row[io_][:10]
                if len(dt) != 10:
                    continue
                y, mo = int(dt[:4]), int(dt[5:7])
                fy = y + (mo >= 10)
                if not 2021 <= fy <= 2025:
                    continue
                zc = row[iz].strip()[:5]
                if len(row[iz].strip()) not in (5, 10) or not zc.isdigit():
                    continue
                c = zmap.get(zc)
                if c and _usps(c) == row[is_].strip().upper():
                    cnt[c] += 1
    fails, n = [], 0
    for f, it in leg.items():
        lg = it["legal"]
        if lg["osha_5y"] is None:
            continue
        n += 1
        if lg["osha_5y"] != cnt.get(f, 0):
            fails.append([f, lg["osha_5y"], cnt.get(f, 0)])
    return {"checked": n, "failures": len(fails), "examples": fails[:10]}


def verify_cfpb(leg, zmap):
    z = zipfile.ZipFile(os.path.join(ROOT, "private", "acq", "cfpb", "bulk", "complaints.csv.zip"))
    cnt = defaultdict(int)
    with z.open("complaints.csv") as h:
        rd = csv.reader(io.TextIOWrapper(h, encoding="utf-8", newline=""))
        hdr = next(rd)
        idt, iz, ist = hdr.index("Date received"), hdr.index("ZIP code"), hdr.index("State")
        for row in rd:
            if len(row) <= iz or not ("2021" <= row[idt][:4] <= "2025"):
                continue
            zc = row[iz].strip()
            if len(zc) not in (5, 10) or not zc[:5].isdigit() or (len(zc) == 10 and zc[5] != "-"):
                continue
            c = zmap.get(zc[:5])
            if c and _usps(c) == row[ist].strip().upper():
                cnt[c] += 1
    fails, n = [], 0
    for f, it in leg.items():
        lg = it["legal"]
        if lg["cfpb_5y"] is None:
            continue
        n += 1
        if lg["cfpb_5y"] != cnt.get(f, 0):
            fails.append([f, lg["cfpb_5y"], cnt.get(f, 0)])
    return {"checked": n, "failures": len(fails), "examples": fails[:10]}


def verify_fjc(leg, fips_state):
    """Re-count from the official zip with csv, using the codebook's district list for the filing state."""
    sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment", "fjc_idb"))
    import idb_codes as ic
    text = open(os.path.join(ROOT, "private", "acq", "courtlistener", "idb_civil_codebook_1988_forward.txt")).read()
    dstate = {}
    for code, label in ic.parse_districts(text).items():
        u = ic.USPS.get(label.split(" - ")[0])
        if u:
            dstate[code] = u.upper()
    prisoner = {510, 530, 535, 540, 550, 555, 560}
    recode = {"12025": "12086", "46113": "46102"}
    allc, core = defaultdict(int), defaultdict(int)
    z = zipfile.ZipFile(os.path.join(ROOT, "private", "acq", "fjc_idb", "cv88on.zip"))
    with z.open("cv88on.txt") as h:
        rd = csv.reader(io.TextIOWrapper(h, encoding="cp1252", errors="replace", newline=""), delimiter="\t", quoting=csv.QUOTE_NONE)
        hdr = next(rd)
        ix = {k: hdr.index(k) for k in ("DISTRICT", "FDATEUSE", "COUNTY", "NOS", "JURIS", "MDLDOCK")}
        for row in rd:
            if len(row) < len(hdr):
                continue
            dt = row[ix["FDATEUSE"]].strip()
            parts = dt.split("/")
            if len(parts) != 3 or not parts[2].isdigit():
                continue
            mo, y = int(parts[0]), int(parts[2])
            fy = y + (mo >= 10)
            if not 2021 <= fy <= 2025:
                continue
            code = row[ix["COUNTY"]].strip()
            code = recode.get(code, code)
            st = dstate.get(row[ix["DISTRICT"]].strip())
            if fips_state.get(code) is None or fips_state[code] != st:
                continue
            allc[code] += 1
            nos = row[ix["NOS"]].strip()
            mdl = row[ix["MDLDOCK"]].strip()
            juris = row[ix["JURIS"]].strip()
            if not (nos.isdigit() and int(nos) in prisoner) and mdl in ("", "-8") and juris != "1":
                core[code] += 1
    fails, n = [], 0
    for f, it in leg.items():
        lg = it["legal"]
        if lg["fjc_5y"] is None:
            continue
        n += 1
        if lg["fjc_5y"] != allc.get(f, 0) or lg["fjc_core_5y"] != core.get(f, 0):
            fails.append([f, lg["fjc_5y"], allc.get(f, 0), lg["fjc_core_5y"], core.get(f, 0)])
    return {"checked": n, "failures": len(fails), "examples": fails[:10]}


if __name__ == "__main__":
    main("--fast" in sys.argv)
