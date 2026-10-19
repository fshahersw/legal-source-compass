"""Build the state_analysis datasets: county_profiles, county_legal_activity, city_profiles, state_cross_analysis.

Run: python3 -I -B build_state_analysis.py   (reads private/acq/state_analysis/, the other streams' raw files named in
sa_fjc.py / sa_streams.py, and private/build/state_analysis/lookups/; writes private/build/state_analysis/<dataset>.json).

Scope: the 50 states and the District of Columbia (the app's STATES table). Denominators: Census Population Estimates,
Vintage 2025, July 1 county totals; a five-year rate uses the mean of the July 1, 2021-2025 estimates. Associations are
Spearman rank correlations with Benjamini-Hochberg control within each family; they are associations, never causes.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..")))

import corpus_writer as writer  # noqa: E402
import sa_acs  # noqa: E402
import sa_districts as SD  # noqa: E402
import sa_fjc  # noqa: E402
import sa_http  # noqa: E402
import sa_sources as S  # noqa: E402
import sa_stats as ST  # noqa: E402
import sa_streams  # noqa: E402

ROOT = sa_http.ROOT
ACQ = sa_http.ACQ
OUT = os.path.join(ROOT, "private", "build", "state_analysis")
LOOKUPS = os.path.join(OUT, "lookups")
CACHE = os.path.join(OUT, "cache")

PEP_URL = "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/counties/totals/co-est2025-alldata.csv"
GAZ_COUNTY_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_counties_national.zip"
GAZ_PLACE_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_place_national.zip"
ZCTA_URL = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt"
LAUS_URL = "https://download.bls.gov/pub/time.series/la/la.data.64.County"
BEA_URL = "https://apps.bea.gov/regional/zip/CAINC1.zip"
ECHO_URL = "https://echo.epa.gov/files/echodownloads/echo_exporter.zip"
OSHA_URL = "https://data.dol.gov/data-catalog/OSHA/inspection/OSHA_inspection.zip"
CFPB_URL = "https://files.consumerfinance.gov/ccdb/complaints.csv.zip"
B01003_URL = sa_acs.ACS_DIR_URL + "acsdt5y2024-b01003.dat"
WINDOW_YEARS = list(range(2021, 2026))
NR = "Not recorded"
CITY_MIN_POP = 10_000
CITY_MIN_PER_STATE = 15
SMALL_BASE = 10  # five-year counts below this are flagged as a small base
POP_MIN = 10_000  # counties below this population are not listed as standing out on a rate

LEGAL = {
    "fjc_rate": ("Federal civil filings by residents", "per 100,000 residents a year", "rate"),
    "fjc_core_rate": ("Federal civil filings by residents, excluding prisoner petitions, MDL-numbered and U.S.-plaintiff cases", "per 100,000 residents a year", "rate"),
    "osha_rate": ("OSHA inspections at sites in the county", "per 100,000 residents a year", "rate"),
    "cfpb_rate": ("CFPB consumer complaints", "per 100,000 residents a year", "rate"),
    "cfpb_noncredit_rate": ("CFPB complaints other than credit reporting", "per 100,000 residents a year", "rate"),
    "echo_formal_per_1k": ("EPA and state formal enforcement actions (ECHO)", "per 1,000 ECHO-listed facilities", "rate"),
}
LEGAL_SHORT = {
    "fjc_rate": "federal civil filings by residents", "fjc_core_rate": "core federal civil filings by residents",
    "osha_rate": "OSHA inspections", "cfpb_rate": "CFPB complaints", "cfpb_noncredit_rate": "CFPB complaints other than credit reporting",
    "echo_formal_per_1k": "formal environmental enforcement actions per facility",
}
DEMO_SHORT = {
    "median_hh_income": "median household income", "per_capita_personal_income": "per capita personal income", "poverty_rate": "poverty rate",
    "pct_bachelors": "share with a bachelor's degree", "pct_uninsured": "uninsured share", "unemployment_rate": "unemployment rate",
    "median_age": "median age", "pct_65plus": "share aged 65 and over", "pct_hispanic": "Hispanic or Latino share",
    "pct_black_nh": "Black (not Hispanic) share", "pct_white_nh": "White (not Hispanic) share", "pct_foreign_born": "foreign-born share",
    "density": "population density", "owner_occupied": "owner-occupied share",
}
DEMO = {
    "median_hh_income": "Median household income", "per_capita_personal_income": "Per capita personal income (BEA)",
    "poverty_rate": "Poverty rate", "pct_bachelors": "Bachelor's degree or higher", "pct_uninsured": "No health insurance",
    "unemployment_rate": "Unemployment rate (BLS)", "median_age": "Median age", "pct_65plus": "Aged 65 and over",
    "pct_hispanic": "Hispanic or Latino", "pct_black_nh": "Black, not Hispanic", "pct_white_nh": "White, not Hispanic",
    "pct_foreign_born": "Foreign-born", "density": "Residents per square mile", "owner_occupied": "Owner-occupied homes",
}


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def r2(v, nd=2):
    return None if v is None else round(v, nd)


def inputs_list() -> list[dict]:
    man = sa_http.manifest()
    out = [{"url": e["url"], "path": p, "sha256": e["sha256"]} for p, e in sorted(man.items()) if os.path.exists(os.path.join(ROOT, p))]
    other = [
        ("https://www.fjc.gov/sites/default/files/idb/textfiles/cv88on.zip", "private/acq/fjc_idb/cv88on.zip", "private/acq/fjc_idb/_manifest.jsonl"),
        (ECHO_URL, "private/acq/epa_echo/echo_exporter.zip", "private/acq/epa_echo/_manifest.jsonl"),
        (CFPB_URL, "private/acq/cfpb/bulk/complaints.csv.zip", "private/acq/cfpb/_manifest.jsonl"),
    ]
    for url, path, mpath in other:
        sha = None
        for line in open(os.path.join(ROOT, mpath)):
            e = json.loads(line)
            if e.get("path") == path:
                sha = e.get("sha256")
        out.append({"url": url, "path": path, "sha256": sha})
    for line in open(os.path.join(ROOT, "private/acq/osha/_manifest.jsonl")):
        e = json.loads(line)
        if e.get("path", "").startswith("private/acq/osha/dol/inspection/"):
            out.append({"url": e["url"] + "#" + e.get("member", ""), "path": e["path"], "sha256": e["sha256"]})
    return out


def cache_json(name: str, key: str, fn):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name + ".json")
    if os.path.exists(path):
        d = json.load(open(path))
        if d.get("key") == key:
            return d["value"]
    v = fn()
    json.dump({"key": key, "value": v}, open(path, "w"))
    return v


# ---------------------------------------------------------------- load


def load_all() -> dict:
    acs, cells, shells = sa_acs.load(ACQ)
    pep, pep_names = S.read_pep_counties(os.path.join(ACQ, "census", "co-est2025-alldata.csv"))
    gaz_c = {r["GEOID"]: r for r in S.read_gazetteer(os.path.join(ACQ, "census", "2024_Gaz_counties_national.zip"))}
    gaz_p = {r["GEOID"]: r for r in S.read_gazetteer(os.path.join(ACQ, "census", "2024_Gaz_place_national.zip"))}
    laus = S.read_laus(os.path.join(ACQ, "bls", "la.data.64.County.gz"), range(2015, 2026))
    bea = S.read_bea_cainc1(os.path.join(ACQ, "bea", "CAINC1.zip"), range(2015, 2025))
    sl155 = S.read_acs(os.path.join(ACQ, "census", "acs5y2024", "acsdt5y2024-b01003.sl155.dat.gz"), prefixes=("1550000US",))
    lit = json.load(open(os.path.join(LOOKUPS, "county_litigation_counts.json")))
    courts = set(json.load(open(os.path.join(LOOKUPS, "court_spine_districts.json")))["values"])
    return {"acs": acs, "cells": cells, "shells": shells, "pep": pep, "pep_names": pep_names, "gaz_c": gaz_c, "gaz_p": gaz_p,
            "laus": laus, "bea": bea, "sl155": sl155, "lit": lit, "courts": courts}


def county_universe(d: dict) -> dict[str, dict]:
    """Counties of the 50 states + DC present in the ACS 2024 5-year file, with Gazetteer names and land area."""
    out = {}
    for geo in d["acs"]:
        f = S.geo_county(geo)
        if not f or f[:2] not in S.FIPS_TO_USPS:
            continue
        g = d["gaz_c"].get(f)
        out[f] = {"fips": f, "usps": S.FIPS_TO_USPS[f[:2]], "name": g["NAME"] if g else d["pep_names"].get(f, f),
                  "land_sqmi": float(g["ALAND_SQMI"]) if g and g.get("ALAND_SQMI") else None}
    return out


def mean_pop(series: dict, years) -> float | None:
    vals = [series.get(y) for y in years]
    if any(v is None for v in vals) or not vals:
        return None
    return sum(vals) / len(vals)  # type: ignore[arg-type]


# ---------------------------------------------------------------- build


def main() -> None:
    t0 = time.time()
    d = load_all()
    counties = county_universe(d)
    print("counties", len(counties))
    county_state = {f: c["usps"] for f, c in counties.items()}

    # --- FJC IDB by county of residence (cached; the DuckDB file and county list are the key)
    st = os.stat(sa_fjc.DB)
    fkey = hashlib.sha256(json.dumps([st.st_size, int(st.st_mtime), sorted(county_state.items()), sa_fjc.FY_SERIES, sa_fjc.FY_WINDOW, sorted(sa_fjc.RECODE.items())]).encode()).hexdigest()

    def run_fjc():
        con = sa_fjc.connect()
        sa_fjc.prepare(con, county_state)
        cc = sa_fjc.county_counts(con)
        un = sa_fjc.state_unmatched(con)
        con.close()
        return {"counties": cc, "unmatched": un}

    fjc = cache_json("fjc_counties", fkey, run_fjc)
    print("fjc counties", len(fjc["counties"]), round(time.time() - t0))

    # --- districts from 28 U.S.C. ch. 5 (+ Virginia local rules)
    page = open(os.path.join(ACQ, "usc", "USCODE-2024-title28-partI-chap5.htm"), encoding="utf-8").read()
    sections = S.parse_usc_chapter5(page)
    import subprocess

    def pdf_text(p):
        return subprocess.run(["pdftotext", "-layout", p, "-"], capture_output=True, text=True, check=True).stdout

    va_rules = SD.parse_va_rules(pdf_text(os.path.join(ACQ, "courts", "vaed_local_rules_2024-12-01.pdf")), "vaed", SD.VAED_URL, "E.D. Va. Local Civil Rule 3(C)")
    va_rules = va_rules[:4]  # the civil rule's four divisions (the criminal rule repeats them)
    va_rules += SD.parse_va_rules(pdf_text(os.path.join(ACQ, "courts", "vawd_local_rules.pdf")), "vawd", SD.VAWD_URL, "W.D. Va. General Rule 2(a)")
    by_state: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for f, c in sorted(counties.items()):
        by_state[c["usps"]].append((f, c["name"]))
    fjc_by_court = {f: v.get("by_court", {}) for f, v in fjc["counties"].items()}
    court_pages = [{"court_id": "txnd", "division": f"{n.title()} Division", "url": f"https://www.txnd.uscourts.gov/location/{n}",
                    "text": SD.court_page_text(open(os.path.join(ACQ, "courts", f"txnd_location_{n}.html"), encoding="utf-8").read())}
                   for n in ("abilene", "amarillo")]
    assign, dreport = SD.assign(sections, by_state, fjc_by_court, va_rules, d["courts"], court_pages)
    county_district = {f: a["court_id"] for f, a in assign.items()}
    print("district assignments", len(assign), "unassigned", len(dreport["unassigned"]), "aliases", len(dreport["aliases"]), "unmatched names", len(dreport["unmatched_names"]))

    # --- streamed enforcement / complaints
    zcta = os.path.join(ACQ, "census", "tab20_zcta520_county20_natl.txt")
    echo = sa_streams.echo_counties()
    osha = sa_streams.osha_counties(zcta)
    cfpb = sa_streams.cfpb_counties(zcta)

    # ---------------------------------------------------------------- county rows
    acs, cells = d["acs"], d["cells"]
    county_metrics: dict[str, dict] = {}
    profiles: dict[str, dict] = {}
    legal: dict[str, dict] = {}
    for f, c in sorted(counties.items()):
        row = acs.get("0500000US" + f, {})
        prof = sa_acs.profile(row, cells)
        pep = d["pep"].get(f, {})
        pop25 = pep.get(2025)
        pmean = mean_pop(pep, WINDOW_YEARS)
        land = c["land_sqmi"]
        density = pop25 / land if pop25 and land else None
        laus = d["laus"].get(f, {})
        urate = laus.get("03", {})
        bea = d["bea"].get(f, {})
        pci = bea.get("per_capita", {})
        m = {k: v["v"] for k, v in prof.items()}
        m.update({"population": pop25, "density": r2(density, 1), "unemployment_rate": urate.get(2025),
                  "per_capita_personal_income": pci.get(2024)})
        # legal activity
        fc = fjc["counties"].get(f, {})
        fy = {int(k): v for k, v in fc.get("fy", {}).items()}
        core_fy = {int(k): v for k, v in fc.get("core_fy", {}).items()}
        fjc5 = sum(fy.get(y, 0) for y in WINDOW_YEARS)
        core5 = sum(core_fy.get(y, 0) for y in WINDOW_YEARS)
        ct_note = None
        if c["usps"] == "CT":
            ct_note = ("Connecticut's county-equivalents became nine planning regions in 2022; the IDB county codes, the ZIP-to-county "
                       "relationship file and ECHO county codes still use the eight former counties, so county legal measures are not recorded.")
        has_fjc = ct_note is None
        rate = lambda n, den: None if den in (None, 0) else n / 5 / den * 100_000  # noqa: E731
        by_court = fc.get("by_court", {})
        own = by_court.get(county_district.get(f, ""), 0) if county_district.get(f) else None
        tot_window = sum(by_court.values())
        oc = osha["counties"].get(f) if ct_note is None else None
        osha5 = sum(oc["fy"].get(str(y), 0) for y in WINDOW_YEARS) if oc else 0
        cc = cfpb["counties"].get(f) if ct_note is None else None
        cfpb5 = sum(cc["y"].get(str(y), 0) for y in WINDOW_YEARS) if cc else 0
        credit = cc["credit_reporting"] if cc else 0
        ec = echo["counties"].get(f) if ct_note is None else None
        lit_n = d["lit"]["values"].get(f, 0)
        trend = None
        early = [core_fy.get(y, 0) for y in (2016, 2017, 2018)]
        late = [core_fy.get(y, 0) for y in (2023, 2024, 2025)]
        if has_fjc and sum(early) / 3 >= 5 and sum(late) / 3 >= 5:
            trend = (sum(late) / 3 - sum(early) / 3) / (sum(early) / 3) * 100
        lg = {
            "fjc_5y": fjc5 if has_fjc else None, "fjc_rate": r2(rate(fjc5, pmean)) if has_fjc else None,
            "fjc_core_5y": core5 if has_fjc else None, "fjc_core_rate": r2(rate(core5, pmean)) if has_fjc else None,
            "fjc_fy": {str(y): fy.get(y, 0) for y in sa_fjc.FY_SERIES} if has_fjc else {},
            "fjc_core_fy": {str(y): core_fy.get(y, 0) for y in sa_fjc.FY_SERIES} if has_fjc else {},
            "fjc_trend_pct": r2(trend, 1),
            "fjc_nos": fc.get("nos", {}) if has_fjc else {},
            "fjc_window": fc.get("window", {}) if has_fjc else {},
            "fjc_own_district_share": r2(own / tot_window * 100, 1) if (own is not None and tot_window and has_fjc) else None,
            "fjc_by_court": by_court if has_fjc else {},
            "osha_5y": osha5 if ct_note is None else None, "osha_rate": r2(rate(osha5, pmean)) if ct_note is None else None,
            "osha_fy": {y: oc["fy"].get(y, 0) for y in map(str, WINDOW_YEARS)} if oc else {},
            "osha_split_share": r2(oc["split"] / osha5 * 100, 1) if oc and osha5 else None,
            "cfpb_5y": cfpb5 if ct_note is None else None, "cfpb_rate": r2(rate(cfpb5, pmean)) if ct_note is None else None,
            "cfpb_noncredit_5y": (cfpb5 - credit) if ct_note is None else None,
            "cfpb_noncredit_rate": r2(rate(cfpb5 - credit, pmean)) if ct_note is None else None,
            "cfpb_credit_share": r2(credit / cfpb5 * 100, 1) if cfpb5 else None,
            "cfpb_y": {y: cc["y"].get(y, 0) for y in map(str, WINDOW_YEARS)} if cc else {},
            "cfpb_split_share": r2(cc["split"] / cfpb5 * 100, 1) if cc and cfpb5 else None,
            "echo_facilities": ec["facilities"] if ec else (0 if ct_note is None else None),
            "echo_active": ec["active"] if ec else (0 if ct_note is None else None),
            "echo_inspections_5y": ec["inspections_5y"] if ec else (0 if ct_note is None else None),
            "echo_formal_actions": ec["formal_actions"] if ec else (0 if ct_note is None else None),
            "echo_with_formal": ec["with_formal_action"] if ec else (0 if ct_note is None else None),
            "echo_snc": ec["snc"] if ec else (0 if ct_note is None else None),
            "echo_formal_per_1k": r2(ec["formal_actions"] / ec["facilities"] * 1000) if ec and ec["facilities"] >= 20 else None,
            "resources": lit_n,
            "pop_mean_2021_2025": r2(pmean, 1),
            "note": ct_note,
        }
        for k in ("fjc_rate", "fjc_core_rate", "osha_rate", "cfpb_rate", "cfpb_noncredit_rate", "echo_formal_per_1k"):
            m[k] = lg[k]
        m["fjc_5y"], m["fjc_core_5y"], m["osha_5y"], m["cfpb_5y"], m["resources"] = lg["fjc_5y"], lg["fjc_core_5y"], lg["osha_5y"], lg["cfpb_5y"], lit_n
        m["fjc_trend_pct"], m["fjc_own_district_share"] = lg["fjc_trend_pct"], lg["fjc_own_district_share"]
        county_metrics[f] = m
        legal[f] = lg
        profiles[f] = {"acs": prof, "pep": {str(y): v for y, v in sorted(pep.items())}, "laus_rate": {str(y): v for y, v in sorted(urate.items())},
                       "laus_labor_force": {str(y): v for y, v in sorted(laus.get("06", {}).items())},
                       "bea_per_capita": {str(y): v for y, v in sorted(pci.items())}, "land_sqmi": land, "density": r2(density, 1)}

    # ---------------------------------------------------------------- residence-code screen (FJC)
    flagged = screen_residence_codes(counties, legal, county_metrics, assign)
    print("residence codes screened out", len(flagged))

    dkey = hashlib.sha256((fkey + json.dumps(sorted(county_district.items())) + json.dumps(sorted(flagged))).encode()).hexdigest()

    def run_comp():
        con = sa_fjc.connect()
        sa_fjc.prepare(con, county_state)
        comp = sa_fjc.district_composition(con, county_district, sorted(flagged))
        con.close()
        return comp

    comp = cache_json("fjc_district_comp", dkey, run_comp)

    # ---------------------------------------------------------------- state aggregates and tests
    states_meta = {u: {"usps": u, "fips": f, "name": n} for f, u, n in S.STATES}
    state_values: dict[str, dict] = {}
    for u in states_meta:
        fl = [f for f in counties if counties[f]["usps"] == u]
        row = acs.get("0400000US" + states_meta[u]["fips"], {})
        prof = sa_acs.profile(row, cells)
        spep = d["pep"].get(states_meta[u]["fips"], {})
        pmean = mean_pop(spep, WINDOW_YEARS)
        sums = defaultdict(float)
        fjc_pop = 0.0  # FJC rates use only counties whose residence code passed the screen (counts and population both)
        for f in fl:
            lg = legal[f]
            for k in ("osha_5y", "cfpb_5y", "cfpb_noncredit_5y", "echo_formal_actions", "echo_facilities"):
                if lg.get(k) is not None:
                    sums[k] += lg[k]
            if lg.get("fjc_5y") is not None and f not in flagged:
                sums["fjc_5y"] += lg["fjc_5y"]
                sums["fjc_core_5y"] += lg["fjc_core_5y"]
                fjc_pop += mean_pop(d["pep"].get(f, {}), WINDOW_YEARS) or 0
        has = u != "CT"
        v = {k: x["v"] for k, x in prof.items()}
        land = sum(counties[f]["land_sqmi"] or 0 for f in fl)
        laus_state = [d["laus"].get(f, {}).get("06", {}).get(2025) for f in fl]
        laus_unemp = [d["laus"].get(f, {}).get("04", {}).get(2025) for f in fl]
        bea_state = d["bea"].get(states_meta[u]["fips"] + "000", {}).get("per_capita", {}).get(2024)
        v.update({
            "population": spep.get(2025), "density": r2(spep.get(2025) / land, 1) if land and spep.get(2025) else None,
            "unemployment_rate": r2(sum(laus_unemp) / sum(laus_state) * 100, 1) if all(x is not None for x in laus_state + laus_unemp) and laus_state else None,
            "per_capita_personal_income": bea_state,
            "fjc_rate": r2(sums["fjc_5y"] / 5 / fjc_pop * 100_000) if has and fjc_pop else None,
            "fjc_core_rate": r2(sums["fjc_core_5y"] / 5 / fjc_pop * 100_000) if has and fjc_pop else None,
            "fjc_screened_counties": sum(1 for f in fl if f in flagged),
            "osha_rate": r2(sums["osha_5y"] / 5 / pmean * 100_000) if has and pmean else None,
            "cfpb_rate": r2(sums["cfpb_5y"] / 5 / pmean * 100_000) if has and pmean else None,
            "cfpb_noncredit_rate": r2(sums["cfpb_noncredit_5y"] / 5 / pmean * 100_000) if has and pmean else None,
            "echo_formal_per_1k": r2(sums["echo_formal_actions"] / sums["echo_facilities"] * 1000) if has and sums["echo_facilities"] else None,
            "fjc_5y": int(sums["fjc_5y"]) if has else None, "osha_5y": int(sums["osha_5y"]) if has else None, "cfpb_5y": int(sums["cfpb_5y"]) if has else None,
        })
        state_values[u] = v
    us_row = acs.get("0100000US", {})
    us_prof = {k: x["v"] for k, x in sa_acs.profile(us_row, cells).items()}
    # United States values for the non-ACS measures: sums over the 50 states and DC (rates over the counties that have them)
    us_pop = sum(d["pep"].get(states_meta[u]["fips"], {}).get(2025) or 0 for u in states_meta)
    us_land = sum(c["land_sqmi"] or 0 for c in counties.values())
    lf = [d["laus"].get(f, {}).get("06", {}).get(2025) for f in counties]
    un = [d["laus"].get(f, {}).get("04", {}).get(2025) for f in counties]
    pairs = [(a, b) for a, b in zip(un, lf) if a is not None and b is not None]
    us_prof.update({
        "population": us_pop, "density": r2(us_pop / us_land, 1) if us_land else None,
        "unemployment_rate": r2(sum(a for a, _ in pairs) / sum(b for _, b in pairs) * 100, 1) if pairs else None,
        "per_capita_personal_income": d["bea"].get("00000", {}).get("per_capita", {}).get(2024),
    })
    fjc_ok = [f for f in counties if legal[f]["fjc_5y"] is not None and f not in flagged]
    fjc_den = sum(mean_pop(d["pep"].get(f, {}), WINDOW_YEARS) or 0 for f in fjc_ok)
    oth = [f for f in counties if legal[f]["osha_5y"] is not None]
    oth_den = sum(mean_pop(d["pep"].get(f, {}), WINDOW_YEARS) or 0 for f in oth)
    fac = sum(legal[f]["echo_facilities"] or 0 for f in oth)
    us_prof.update({
        "fjc_rate": r2(sum(legal[f]["fjc_5y"] for f in fjc_ok) / 5 / fjc_den * 100_000) if fjc_den else None,
        "fjc_core_rate": r2(sum(legal[f]["fjc_core_5y"] for f in fjc_ok) / 5 / fjc_den * 100_000) if fjc_den else None,
        "osha_rate": r2(sum(legal[f]["osha_5y"] for f in oth) / 5 / oth_den * 100_000) if oth_den else None,
        "cfpb_rate": r2(sum(legal[f]["cfpb_5y"] for f in oth) / 5 / oth_den * 100_000) if oth_den else None,
        "cfpb_noncredit_rate": r2(sum(legal[f]["cfpb_noncredit_5y"] for f in oth) / 5 / oth_den * 100_000) if oth_den else None,
        "echo_formal_per_1k": r2(sum(legal[f]["echo_formal_actions"] or 0 for f in oth) / fac * 1000) if fac else None,
    })

    # within-state tests
    state_tests: dict[str, list[dict]] = {}
    for u in states_meta:
        fl = sorted(f for f in counties if counties[f]["usps"] == u)
        tests = []
        for lk in LEGAL:
            xs = {f: county_metrics[f][lk] for f in fl}
            ys = {dk: {f: county_metrics[f].get(dk) for f in fl} for dk in DEMO}
            for t in ST.test_family(xs, ys, DEMO):
                t["x"] = lk
                tests.append(t)
        ST.apply_bh(tests)
        state_tests[u] = tests
    # cross-state tests
    ust = sorted(states_meta)
    xtests = []
    for lk in LEGAL:
        xs = {u: state_values[u][lk] for u in ust}
        ys = {dk: {u: state_values[u].get(dk) for u in ust} for dk in DEMO}
        for t in ST.test_family(xs, ys, DEMO):
            t["x"] = lk
            xtests.append(t)
    ST.apply_bh(xtests)

    # ---------------------------------------------------------------- districts
    district_rows: dict[str, dict] = {}
    for f, a in assign.items():
        dr = district_rows.setdefault(a["court_id"], {"court_id": a["court_id"], "name": a["district"], "usps": counties[f]["usps"], "counties": [], "divisions": {}})
        dr["counties"].append(f)
        if a.get("division"):
            dv = dr["divisions"].setdefault(a["division"], {"name": a["division"], "held_at": a.get("held_at") or [], "counties": []})
            dv["counties"].append(f)
    for cid, dr in district_rows.items():
        fl = dr["counties"]
        pop = sum(d["pep"].get(f, {}).get(2025) or 0 for f in fl)
        pmean = sum(mean_pop(d["pep"].get(f, {}), WINDOW_YEARS) or 0 for f in fl)
        agg = {}
        for key in ("poverty_rate", "pct_bachelors", "pct_uninsured", "pct_65plus", "pct_hispanic", "pct_black_nh", "pct_white_nh", "pct_foreign_born", "owner_occupied"):
            nums = [sa_acs.counts(acs.get("0500000US" + f, {}), cells, key) for f in fl]
            if all(n[0] is not None for n in nums) and sum(n[1] for n in nums):
                agg[key] = r2(sum(n[0] for n in nums) / sum(n[1] for n in nums) * 100)
        inc = [county_metrics[f]["median_hh_income"] for f in fl if county_metrics[f]["median_hh_income"] is not None]
        land = sum(counties[f]["land_sqmi"] or 0 for f in fl)
        ok = [f for f in fl if f not in flagged and legal[f]["fjc_5y"] is not None]
        res5 = sum(legal[f]["fjc_5y"] for f in ok)
        core5 = sum(legal[f]["fjc_core_5y"] for f in ok)
        fpmean = sum(mean_pop(d["pep"].get(f, {}), WINDOW_YEARS) or 0 for f in ok)
        osha5 = sum(legal[f]["osha_5y"] or 0 for f in fl)
        cfpb5 = sum(legal[f]["cfpb_5y"] or 0 for f in fl)
        has = dr["usps"] != "CT"
        cm = comp.get(cid, {})
        dr.update({
            "population": pop, "land_sqmi": r2(land, 1), "density": r2(pop / land, 1) if land else None, "demographics": agg,
            "median_income_range": [min(inc), max(inc)] if inc else None,
            "residents_fjc_5y": res5 if has else None, "residents_fjc_rate": r2(res5 / 5 / fpmean * 100_000) if has and fpmean else None,
            "residents_core_rate": r2(core5 / 5 / fpmean * 100_000) if has and fpmean else None,
            "screened_counties": sorted(f for f in fl if f in flagged),
            "osha_rate": r2(osha5 / 5 / pmean * 100_000) if has and pmean else None,
            "cfpb_rate": r2(cfpb5 / 5 / pmean * 100_000) if has and pmean else None,
            "filed_by_residence": cm.get("all", {}), "filed_by_residence_core": cm.get("core", {}),
            "filed_fy": {str(k): v for k, v in sorted(cm.get("fy", {}).items())},
            "filed_5y": sum(cm.get("all", {}).values()),
        })

    # ---------------------------------------------------------------- what stands out
    standouts = {u: stand_out(u, counties, county_metrics, legal, state_tests[u], district_rows, d) for u in states_meta}

    # ---------------------------------------------------------------- cities
    cities = build_cities(d, counties)

    # ---------------------------------------------------------------- rows
    built = now()
    ins = inputs_list()
    write_county_profiles(counties, county_metrics, profiles, assign, built, ins)
    write_county_legal(counties, county_metrics, legal, assign, fjc, echo, osha, cfpb, built, ins)
    write_cities(cities, counties, built, ins)
    write_state_analysis(states_meta, counties, county_metrics, legal, state_values, us_prof, state_tests, xtests, district_rows,
                         standouts, assign, dreport, fjc, comp, built, ins, d)
    print("done", round(time.time() - t0), "s")


# ---------------------------------------------------------------- residence-code screen


OWN_SHARE_MIN = 50.0  # percent of a county code's filings made in the county's own district (multi-district states)
OWN_SHARE_BASE = 50  # filings needed before the own-district test applies
FIRST_CODE_RATIO = 3.0  # a state's first county code (xx001) at this multiple of the other counties' median rate


def screen_residence_codes(counties, legal, cm, assign) -> dict[str, list[str]]:
    """Flag county codes whose IDB filings evidently do not reflect residence; their FJC rates become Not recorded.

    (a) Multi-district states: fewer than OWN_SHARE_MIN percent of the FY2021-FY2025 filings carrying the code were filed in
        the county's own district (28 U.S.C. ch. 5), with at least OWN_SHARE_BASE filings. Residents normally sue at home;
        a code used mostly elsewhere is being used for something else (a division city of the same name, a prison, a default).
    (b) The state's first county code (FIPS xx001) with a rate at least FIRST_CODE_RATIO times the median rate of the state's
        other counties and at least twice their 90th percentile: the pattern of a default entry on the civil cover sheet
        rather than residence (the second condition keeps large urban first counties, such as Alameda, in).
    Counts stay visible with the reason; rates, trends, rankings and tests leave the county out.
    """
    multi = defaultdict(set)
    for f, a in assign.items():
        multi[counties[f]["usps"]].add(a["court_id"])
    med_other: dict[str, float | None] = {}
    p90_other: dict[str, float | None] = {}
    for u in {c["usps"] for c in counties.values()}:
        vals = [legal[f]["fjc_rate"] for f in counties if counties[f]["usps"] == u and not f.endswith("001") and legal[f]["fjc_rate"] is not None]
        med_other[u] = ST.median(vals) if vals else None
        p90_other[u] = ST.quantile(vals, 0.9) if vals else None
    out: dict[str, list[str]] = {}
    for f, c in counties.items():
        lg = legal[f]
        if lg["fjc_5y"] is None:
            continue
        reasons = []
        tot = sum(lg["fjc_by_court"].values())
        own = lg["fjc_own_district_share"]
        if len(multi[c["usps"]]) > 1 and tot >= OWN_SHARE_BASE and own is not None and own < OWN_SHARE_MIN:
            reasons.append(f"Only {own:.0f}% of the {tot:,} filings FY2021-FY2025 carrying this county's residence code were filed in its own district "
                           f"({assign[f]['district']}); the code is evidently also used for something other than residence, such as a court division "
                           "of the same name, a prison or a default entry.")
        m, p90 = med_other.get(c["usps"]), p90_other.get(c["usps"])
        if f.endswith("001") and lg["fjc_rate"] is not None and m and p90 and lg["fjc_rate"] >= max(FIRST_CODE_RATIO * m, 2 * p90):
            reasons.append(f"This is the state's first county code (FIPS {f}); its rate ({lg['fjc_rate']:,.1f} per 100,000 a year) is "
                           f"{lg['fjc_rate'] / m:.1f} times the median of the state's other counties ({m:,.1f}) and over twice their 90th percentile "
                           f"({p90:,.1f}), the pattern of a default entry rather than residence.")
        if reasons:
            out[f] = reasons
            lg["fjc_flag"] = reasons
            lg["fjc_rate_unscreened"] = lg["fjc_rate"]
            for k in ("fjc_rate", "fjc_core_rate", "fjc_trend_pct"):
                lg[k] = None
                cm[f][k] = None
    return out


# ---------------------------------------------------------------- stand-out list


def stand_out(u, counties, cm, legal, tests, district_rows, d) -> list[dict]:
    """Deterministic list of notable, sourced facts for a state.

    Rates qualify only for counties with at least POP_MIN residents (2025) and a five-year count of at least SMALL_BASE.
    """
    out: list[dict] = []
    fl = [f for f in counties if counties[f]["usps"] == u]
    big = {f for f in fl if (cm[f].get("population") or 0) >= POP_MIN}
    if u == "CT":
        out.append({"kind": "coverage", "text": "County legal measures are not recorded for Connecticut: its planning regions (2022) do not match the former counties that the IDB, ECHO and ZIP relationships use."})
    for key, base in (("fjc_core_rate", "fjc_core_5y"), ("osha_rate", "osha_5y"), ("cfpb_noncredit_rate", "cfpb_noncredit_5y")):
        pts = [(f, cm[f][key]) for f in fl if f in big and cm[f].get(key) is not None and (legal[f].get(base) or 0) >= SMALL_BASE]
        if len(pts) < 5:
            continue
        med = ST.median([v for _, v in pts])
        hi = max(pts, key=lambda p: (p[1], p[0]))
        if med and hi[1] >= 2 * med:
            out.append({"kind": "high", "metric": key, "county": hi[0], "value": hi[1], "median": r2(med),
                        "text": f"{counties[hi[0]]['name']}: {hi[1]:,.1f} {LEGAL_SHORT[key]} per 100,000 residents a year, {hi[1] / med:.1f} times the state's median county ({med:,.1f}; counties of 10,000+ residents)."})
    # concentration of filings
    ok = [f for f in fl if not legal[f].get("fjc_flag")]
    tot = sum(legal[f]["fjc_core_5y"] or 0 for f in ok)
    pop = sum(d["pep"].get(f, {}).get(2025) or 0 for f in ok)
    if tot >= 100 and pop and len(ok) > 1:
        top = max(ok, key=lambda f: (legal[f]["fjc_core_5y"] or 0, f))
        share = (legal[top]["fjc_core_5y"] or 0) / tot * 100
        pshare = (d["pep"].get(top, {}).get(2025) or 0) / pop * 100
        if share >= 20:
            out.append({"kind": "concentration", "metric": "fjc_core_5y", "county": top, "value": r2(share, 1),
                        "text": f"{counties[top]['name']}: residents filed {share:.0f}% of the state's core federal civil filings by residents (FY2021-FY2025) with {pshare:.0f}% of its population."})
    # strongest association that holds for each legal measure, then the three strongest of those
    best: dict[str, dict] = {}
    for t in tests:
        if t.get("holds") and (t["x"] not in best or abs(t["rho"]) > abs(best[t["x"]]["rho"])):
            best[t["x"]] = t
    held = sorted(best.values(), key=lambda t: (-abs(t["rho"]), t["x"]))[:3]
    for t in held:
        p = "< 0.001" if t["p_bh"] < 0.001 else f"{t['p_bh']:.3f}"
        out.append({"kind": "association", "metric": t["x"], "with": t["y"], "value": r2(t["rho"], 2),
                    "text": f"Across counties, {LEGAL_SHORT[t['x']]} are {'higher' if t['rho'] > 0 else 'lower'} where the {DEMO_SHORT[t['y']]} is higher (Spearman rho {t['rho']:+.2f}, n {t['n']}, adjusted p {p}). An association, not a cause."})
    ran = [t for t in tests if t.get("rho") is not None]
    if ran and not best:
        out.append({"kind": "association_none", "text": f"None of the {len(ran)} county-level associations tested holds after the Benjamini-Hochberg adjustment."})
    if not ran:
        out.append({"kind": "association_none", "text": "Too few counties with both values to test county-level associations (at least 10 are needed)."})
    # districts: out-of-state share
    ds = [dr for dr in district_rows.values() if dr["usps"] == u and dr.get("filed_5y")]
    if ds:
        def oos(dr):
            a = dr["filed_by_residence"]
            n = sum(a.values())
            return (a.get("out_of_state", 0) / n * 100) if n else 0
        top = max(ds, key=lambda dr: (oos(dr), dr["court_id"]))
        if oos(top) >= 10:
            out.append({"kind": "district", "court_id": top["court_id"], "value": r2(oos(top), 1),
                        "text": f"{top['name']}: {oos(top):.0f}% of civil filings FY2021-FY2025 name a first plaintiff living outside the state (FJC residence code 88888)."})
    # trend (core filings)
    tr = [(f, cm[f]["fjc_trend_pct"]) for f in fl if f in big and cm[f].get("fjc_trend_pct") is not None]
    if len(tr) >= 3:
        up = max(tr, key=lambda p: (p[1], p[0]))
        down = min(tr, key=lambda p: (p[1], p[0]))
        if up[1] >= 50:
            out.append({"kind": "trend_up", "county": up[0], "value": up[1], "text": f"{counties[up[0]]['name']}: core federal civil filings by residents rose {up[1]:.0f}% from FY2016-2018 to FY2023-2025 (yearly means)."})
        if down[1] <= -40:
            out.append({"kind": "trend_down", "county": down[0], "value": down[1], "text": f"{counties[down[0]]['name']}: core federal civil filings by residents fell {abs(down[1]):.0f}% from FY2016-2018 to FY2023-2025 (yearly means)."})
    return out


# ---------------------------------------------------------------- cities


def build_cities(d, counties) -> list[dict]:
    acs, cells = d["acs"], d["cells"]
    parts: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for geo, row in d["sl155"].items():
        p, c = geo[9:16], geo[9:11] + geo[16:19]
        parts[p].append((c, row.get("B01003_E001") or 0.0))
    places = []
    for geo, row in acs.items():
        p = S.geo_place(geo)
        if not p or p[:2] not in S.FIPS_TO_USPS:
            continue
        prof = sa_acs.profile(row, cells)
        pop = prof["pop_acs"]["v"]
        if pop is None:
            continue
        places.append((p, pop, prof))
    by_state = defaultdict(list)
    for p, pop, prof in places:
        by_state[S.FIPS_TO_USPS[p[:2]]].append((p, pop, prof))
    out = []
    for u, lst in by_state.items():
        lst.sort(key=lambda t: (-t[1], t[0]))
        keep = [t for i, t in enumerate(lst) if t[1] >= CITY_MIN_POP or i < CITY_MIN_PER_STATE]
        for rank, (p, pop, prof) in enumerate(keep, 1):
            g = d["gaz_p"].get(p, {})
            name = g.get("NAME") or p
            land = float(g["ALAND_SQMI"]) if g.get("ALAND_SQMI") else None
            tot = sum(x for _, x in parts.get(p, [])) or 0
            cparts = sorted(parts.get(p, []), key=lambda t: -t[1])
            out.append({"geoid": p, "usps": u, "name": name, "funcstat": g.get("FUNCSTAT") or None, "lsad": g.get("LSAD") or None,
                        "land_sqmi": land, "density": r2(pop / land, 1) if land else None, "rank": rank, "acs": prof,
                        "counties": [{"fips": c, "name": counties.get(c, {}).get("name", c), "pop": int(x), "share": r2(x / tot * 100, 1) if tot else None} for c, x in cparts]})
    return out


# ---------------------------------------------------------------- writers


def fmt(v, kind="int"):
    if v is None:
        return NR
    if kind == "pct":
        return f"{v:.1f}%"
    if kind == "dollars":
        return f"${v:,.0f}"
    if kind == "rate":
        return f"{v:,.2f}"
    if kind == "dec1":
        return f"{v:.1f}"
    return f"{v:,.0f}"


def write(dataset: str, label: str, rows: list[dict], listing_block: dict, summary: dict, built: str, ins: list[dict]) -> None:
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, dataset + ".json")
    with open(path, "w") as h:
        json.dump({"dataset": dataset, "label": label, "listing_block": listing_block, "summary": summary, "rows": rows,
                   "built_at": built, "inputs": ins}, h)
    print(dataset, len(rows), os.path.getsize(path))


def place_link(u: str, f: str | None = None) -> dict:
    return {"url": f"/places/{u}/{f}" if f else f"/places/{u}", "label": "County page" if f else "State page"}


METRIC_SPECS = {k: (v[0], v[1], v[2]) for k, v in sa_acs.MEASURES.items()}
METRIC_SPECS.update({
    "population": ("Population (July 1, 2025 estimate)", "people", "int"), "density": ("Residents per square mile", "per sq mi", "dec1"),
    "unemployment_rate": ("Unemployment rate (BLS LAUS, 2025 annual average)", "%", "pct"),
    "per_capita_personal_income": ("Per capita personal income (BEA, 2024)", "dollars", "dollars"),
})


def write_county_profiles(counties, cm, profiles, assign, built, ins) -> None:
    rows = []
    for f, c in sorted(counties.items()):
        m = cm[f]
        a = assign.get(f)
        p = profiles[f]
        facts = [
            ["Population, July 1, 2025 (Census Population Estimates, Vintage 2025)", fmt(m["population"])],
            ["Land area (2024 Gazetteer)", NR if c["land_sqmi"] is None else f"{c['land_sqmi']:,.1f} sq mi"],
            ["Residents per square mile", fmt(m["density"], "dec1")],
            ["Federal judicial district (28 U.S.C. ch. 5)", a["district"] if a else NR],
        ]
        for k, (label, unit, kind, _, _) in sa_acs.MEASURES.items():
            v, moe = p["acs"][k]["v"], p["acs"][k]["moe"]
            facts.append([f"{label} ({sa_acs.VINTAGE})", fmt(v, kind) + ("" if v is None or moe is None else f" ± {fmt(moe, kind)}")])
        facts += [["Unemployment rate, 2025 annual average (BLS LAUS)", fmt(m["unemployment_rate"], "pct")],
                  ["Per capita personal income, 2024 (BEA CAINC1)", fmt(m["per_capita_personal_income"], "dollars")]]
        profile = {"fips": f, "usps": c["usps"], "name": c["name"], "state": S.USPS_TO_NAME[c["usps"]],
                   "district": {k: a.get(k) for k in ("court_id", "district", "division", "held_at", "method", "code_name", "exception", "source_url")} if a else None,
                   **p}
        rows.append(writer.record(
            "county_profiles", f, f"{c['name']}, {S.USPS_TO_NAME[c['usps']]}", source_url=sa_acs.ACS_DIR_URL,
            subtitle=f"{fmt(m['population'])} residents (2025) · median household income {fmt(m['median_hh_income'], 'dollars')} · poverty {fmt(m['poverty_rate'], 'pct')}",
            cells={"state": c["usps"], "county": c["name"], "population": m["population"], "median_hh_income": m["median_hh_income"], "poverty_rate": m["poverty_rate"],
                   "pct_bachelors": m["pct_bachelors"], "unemployment_rate": m["unemployment_rate"], "district": a["court_id"] if a else None},
            facts=facts, text=f"{c['name']} {S.USPS_TO_NAME[c['usps']]} county demographics", state=c["usps"],
            filters={"state": [c["usps"]], **({"district": [a["court_id"]]} if a else {})},
            badges=["Census ACS", "Population Estimates", "BLS", "BEA"],
            links=[place_link(c["usps"], f)] + ([{"url": f"/courts/{a['court_id']}", "label": a["district"]}] if a else []),
            extra={"profile": profile, "metrics": {k: m.get(k) for k in METRIC_SPECS}}))
    summary = {
        "source": "Census ACS 2020-2024 5-year table-based summary file; Census Population Estimates Vintage 2025; 2024 Gazetteer; BLS LAUS; BEA CAINC1; 28 U.S.C. ch. 5",
        "sources": [{"name": "ACS 2020-2024 5-year table-based summary file", "url": sa_acs.ACS_DIR_URL, "tables": sa_acs.TABLES, "shells": sa_acs.SHELLS_URL},
                    {"name": "County population totals, Vintage 2025", "url": PEP_URL}, {"name": "2024 Gazetteer, counties", "url": GAZ_COUNTY_URL},
                    {"name": "BLS LAUS county data", "url": LAUS_URL}, {"name": "BEA CAINC1", "url": BEA_URL}, {"name": "28 U.S.C. ch. 5", "url": SD.USC_URL}],
        "measures": {k: {"label": v[0], "unit": v[1], "format": v[2]} for k, v in METRIC_SPECS.items()},
        "definitions": {"share": "percent of the table universe; MOE by the Census approximation for a derived proportion",
                        "density": "July 1, 2025 population / 2024 Gazetteer land area",
                        "missing": "an estimate the Census Bureau does not publish (annotation codes) stays Not recorded"},
        "scope": "3,144 counties and county-equivalents of the 50 states and DC in the ACS 2024 geography (Connecticut's nine planning regions included)",
        "totals": {"records": len(rows)},
    }
    write("county_profiles", "County profiles: population, income, poverty, education, insurance, housing and labor (Census ACS, PEP, BLS, BEA)",
          rows, writer.listing([("state", "State"), ("county", "County"), ("population", "Population 2025"), ("median_hh_income", "Median household income"),
                                ("poverty_rate", "Poverty %"), ("pct_bachelors", "Bachelor's+ %"), ("unemployment_rate", "Unemployment % (2025)"), ("district", "District")],
                               [("state", "State", {u: n for _, u, n in S.STATES})]), summary, built, ins)


def write_county_legal(counties, cm, legal, assign, fjc, echo, osha, cfpb, built, ins) -> None:
    rows = []
    for f, c in sorted(counties.items()):
        lg = legal[f]
        a = assign.get(f)
        note = lg["note"]
        facts = [
            ["Federal civil filings by residents, FY2021-FY2025 (FJC IDB, county of residence of the first plaintiff)", fmt(lg["fjc_5y"])],
            ["  per 100,000 residents a year (mean of July 1, 2021-2025 population)", fmt(lg["fjc_rate"], "rate")],
            ["  excluding prisoner petitions, MDL-numbered and U.S.-plaintiff cases", fmt(lg["fjc_core_5y"]) + " · " + fmt(lg["fjc_core_rate"], "rate") + " per 100,000 a year"],
            ["  share filed in the county's own district", fmt(lg["fjc_own_district_share"], "pct")],
            ["  change in core filings, FY2016-2018 to FY2023-2025 (yearly means; both at least 5)", NR if lg["fjc_trend_pct"] is None else f"{lg['fjc_trend_pct']:+.1f}%"],
            ["OSHA inspections opened FY2021-FY2025 (site ZIP, ZCTA to county)", fmt(lg["osha_5y"]) + " · " + fmt(lg["osha_rate"], "rate") + " per 100,000 a year"],
            ["CFPB complaints received 2021-2025 (consumer ZIP, ZCTA to county)", fmt(lg["cfpb_5y"]) + " · " + fmt(lg["cfpb_rate"], "rate") + " per 100,000 a year"],
            ["  other than credit reporting", fmt(lg["cfpb_noncredit_5y"]) + " · " + fmt(lg["cfpb_noncredit_rate"], "rate") + " per 100,000 a year"],
            ["ECHO-listed facilities (reported county FIPS)", fmt(lg["echo_facilities"])],
            ["  formal enforcement actions recorded (ICIS-Air, ICIS-NPDES, SDWIS, RCRAInfo)", fmt(lg["echo_formal_actions"]) + " · " + fmt(lg["echo_formal_per_1k"], "rate") + " per 1,000 facilities"],
            ["  inspections in the last five years (CAA, CWA, RCRA)", fmt(lg["echo_inspections_5y"])],
            ["  facilities in significant noncompliance or high-priority violation", fmt(lg["echo_snc"])],
            ["County litigation resources in the corpus (county_litigation, tagged with this county)", fmt(lg["resources"])],
        ]
        if note:
            facts.append(["Coverage", note])
        for reason in lg.get("fjc_flag") or []:
            facts.append(["Residence code screened out (rates not computed)", reason])
        cells = {"state": c["usps"], "county": c["name"], "fjc_5y": lg["fjc_5y"], "fjc_rate": lg["fjc_rate"], "osha_rate": lg["osha_rate"],
                 "cfpb_rate": lg["cfpb_rate"], "echo_formal_per_1k": lg["echo_formal_per_1k"], "resources": lg["resources"]}
        rows.append(writer.record(
            "county_legal_activity", f, f"{c['name']}, {S.USPS_TO_NAME[c['usps']]}: legal activity", source_url=sa_fjc.IDB_URL,
            subtitle=(note or f"{fmt(lg['fjc_5y'])} resident federal civil filings FY2021-FY2025 ({fmt(lg['fjc_rate'], 'rate')} per 100,000 a year)"),
            cells=cells, facts=facts, text=f"{c['name']} {S.USPS_TO_NAME[c['usps']]} federal civil filings OSHA CFPB EPA", state=c["usps"],
            filters={"state": [c["usps"]], **({"district": [a["court_id"]]} if a else {})}, badges=["FJC IDB", "OSHA", "CFPB", "EPA ECHO"],
            links=[place_link(c["usps"], f)] + ([{"url": f"/courts/{a['court_id']}", "label": a["district"]}] if a else []),
            extra={"legal": lg, "metrics": {k: lg.get(k) for k in ("fjc_rate", "fjc_core_rate", "osha_rate", "cfpb_rate", "cfpb_noncredit_rate", "echo_formal_per_1k",
                                                                    "fjc_5y", "fjc_core_5y", "osha_5y", "cfpb_5y", "cfpb_noncredit_5y", "echo_facilities",
                                                                    "resources", "fjc_trend_pct", "fjc_own_district_share")}}))
    summary = {
        "source": "FJC Integrated Database civil file; OSHA inspection data; CFPB Consumer Complaint Database; EPA ECHO Exporter; Census ZCTA-county relationship file; county_litigation tags",
        "sources": [{"name": "FJC IDB civil cases 1988-present", "url": sa_fjc.IDB_URL, "page": sa_fjc.IDB_PAGE},
                    {"name": "OSHA inspection data (DOL enforcement data catalog)", "url": OSHA_URL}, {"name": "CFPB Consumer Complaint Database", "url": CFPB_URL},
                    {"name": "EPA ECHO Exporter", "url": ECHO_URL}, {"name": "Census 2020 ZCTA to county relationship file", "url": ZCTA_URL},
                    {"name": "County population totals, Vintage 2025 (denominators)", "url": PEP_URL}],
        "definitions": {
            "fjc": "civil cases whose IDB COUNTY code (residence of the first listed plaintiff; the first defendant's when the U.S. is plaintiff) is this county and that were filed in a district court of the same state, by fiscal year of FDATEUSE",
            "fjc_core": "the same, excluding prisoner petitions (NOS 510-560), cases with an MDL docket number and U.S.-plaintiff cases",
            "rate": "five-year count / 5 / mean of the July 1, 2021-2025 population estimates x 100,000",
            "zip_to_county": "ZIP placed in the county holding the largest land share of its 2020 ZCTA; split-ZCTA shares are stored per county",
            "echo_formal_per_1k": "formal actions recorded for facilities with this county FIPS / facilities listed with it x 1,000 (counties with at least 20 facilities)",
        },
        "stats": {"echo": echo["stats"], "osha": osha["stats"], "cfpb": cfpb["stats"], "fjc_unmatched_codes_by_state": {k: sum(v.values()) for k, v in fjc["unmatched"].items()}},
        "caveats": ["The IDB records residence only for plaintiffs living in the filing district's state; residents of other states are coded 88888.",
                    "Counts are filings, not people; one person may file many cases.", "CFPB complaints are not a statistical sample; credit-reporting complaints dominate recent years.",
                    "Rates on a small base (under 10 in five years) are unstable.", "Associations between these measures and demographics are not causes."],
        "totals": {"records": len(rows)},
    }
    write("county_legal_activity", "County legal activity: federal civil filings by residents, OSHA inspections, CFPB complaints and EPA enforcement",
          rows, writer.listing([("state", "State"), ("county", "County"), ("fjc_5y", "Federal civil filings FY2021-25"), ("fjc_rate", "Per 100k a year"),
                                ("osha_rate", "OSHA per 100k"), ("cfpb_rate", "CFPB per 100k"), ("echo_formal_per_1k", "EPA formal per 1k facilities"), ("resources", "Resources")],
                               [("state", "State", {u: n for _, u, n in S.STATES})]), summary, built, ins)


def write_cities(cities, counties, built, ins) -> None:
    rows = []
    for c in cities:
        acs = c["acs"]
        m = {k: v["v"] for k, v in acs.items()}
        kind = "Census-designated place (no municipal government)" if c["funcstat"] == "S" else "Incorporated place"
        top = c["counties"][0] if c["counties"] else None
        facts = [["Type (2024 Gazetteer functional status)", kind], ["Population (ACS 2020-2024)", fmt(m["pop_acs"])],
                 ["Land area", NR if c["land_sqmi"] is None else f"{c['land_sqmi']:,.1f} sq mi"], ["Residents per square mile", fmt(c["density"], "dec1")],
                 ["Counties (ACS summary level 155 population parts)", "; ".join(f"{x['name']} {fmt(x['share'], 'pct')}" for x in c["counties"]) or NR]]
        for k, (label, unit, fk, _, _) in sa_acs.MEASURES.items():
            if k == "pop_acs":
                continue
            v, moe = acs[k]["v"], acs[k]["moe"]
            facts.append([label, fmt(v, fk) + ("" if v is None or moe is None else f" ± {fmt(moe, fk)}")])
        rows.append(writer.record(
            "city_profiles", c["geoid"], f"{c['name']}, {S.USPS_TO_NAME[c['usps']]}", source_url=sa_acs.ACS_DIR_URL,
            subtitle=f"{fmt(m['pop_acs'])} residents · median household income {fmt(m['median_hh_income'], 'dollars')} · {kind.lower()}",
            cells={"state": c["usps"], "place": c["name"], "population": m["pop_acs"], "median_hh_income": m["median_hh_income"], "poverty_rate": m["poverty_rate"],
                   "pct_bachelors": m["pct_bachelors"], "county": top["name"] if top else None},
            facts=facts, text=f"{c['name']} {S.USPS_TO_NAME[c['usps']]} city demographics", state=c["usps"], filters={"state": [c["usps"]]},
            badges=["Census ACS"], links=[place_link(c["usps"])] + ([place_link(c["usps"], top["fips"])] if top and top["fips"] in counties else []),
            extra={"place": {k: c[k] for k in ("geoid", "usps", "name", "funcstat", "lsad", "land_sqmi", "density", "rank", "counties")}, "acs": acs, "metrics": m}))
    summary = {"source": "Census ACS 2020-2024 5-year table-based summary file (places, summary level 160; place-county parts, summary level 155); 2024 Gazetteer places",
               "sources": [{"name": "ACS 2020-2024 5-year table-based summary file", "url": sa_acs.ACS_DIR_URL}, {"name": "2024 Gazetteer, places", "url": GAZ_PLACE_URL},
                           {"name": "B01003 (summary level 155 parts)", "url": B01003_URL}],
               "selection": f"places with ACS population of at least {CITY_MIN_POP:,}, or among the {CITY_MIN_PER_STATE} most populous places of their state",
               "measures": {k: {"label": v[0], "unit": v[1], "format": v[2]} for k, v in sa_acs.MEASURES.items()}, "totals": {"records": len(rows)}}
    write("city_profiles", "City and place profiles: population, income, poverty, education, insurance and housing (Census ACS 2020-2024)",
          rows, writer.listing([("state", "State"), ("place", "Place"), ("population", "Population"), ("median_hh_income", "Median household income"),
                                ("poverty_rate", "Poverty %"), ("pct_bachelors", "Bachelor's+ %"), ("county", "County")],
                               [("state", "State", {u: n for _, u, n in S.STATES})]), summary, built, ins)


def dist_stats(values: list[float]) -> dict | None:
    if not values:
        return None
    return {"n": len(values), "min": r2(min(values)), "p25": r2(ST.quantile(values, 0.25)), "median": r2(ST.median(values)),
            "p75": r2(ST.quantile(values, 0.75)), "max": r2(max(values))}


def clean_test(t: dict) -> dict:
    return {"x": t["x"], "y": t["y"], "label": t["label"], "rho": r2(t.get("rho"), 3), "n": t["n"], "ci": [r2(x, 3) for x in t["ci"]] if t.get("ci") else None,
            "p": r2(t.get("p"), 5), "p_bh": r2(t.get("p_bh"), 5), "holds": bool(t.get("holds")), "strength": ST.strength(t["rho"]) if t.get("rho") is not None else None}


def write_state_analysis(states_meta, counties, cm, legal, state_values, us_prof, state_tests, xtests, district_rows, standouts, assign, dreport, fjc, comp, built, ins, d) -> None:
    rows = []
    metric_keys = list(dict.fromkeys(list(LEGAL) + ["fjc_trend_pct", "fjc_own_district_share", "resources"] + list(METRIC_SPECS)))
    for u, meta in sorted(states_meta.items()):
        fl = sorted(f for f in counties if counties[f]["usps"] == u)
        dists = {k: dist_stats([cm[f][k] for f in fl if cm[f].get(k) is not None]) for k in metric_keys}
        ok = [f for f in fl if not legal[f].get("fjc_flag")]
        fy_tot = {str(y): sum(int(legal[f]["fjc_fy"].get(str(y), 0)) for f in ok) for y in sa_fjc.FY_SERIES} if u != "CT" else {}
        fy_core = {str(y): sum(int(legal[f]["fjc_core_fy"].get(str(y), 0)) for f in ok) for y in sa_fjc.FY_SERIES} if u != "CT" else {}
        ok_pop = {y: sum(d["pep"].get(f, {}).get(y) or 0 for f in ok) for y in WINDOW_YEARS}
        fy_rate = {str(y): r2(fy_tot[str(y)] / ok_pop[y] * 100_000) for y in WINDOW_YEARS if fy_tot and ok_pop.get(y)}
        fy_core_rate = {str(y): r2(fy_core[str(y)] / ok_pop[y] * 100_000) for y in WINDOW_YEARS if fy_core and ok_pop.get(y)}
        tests = [clean_test(t) for t in state_tests[u]]
        ran = [t for t in tests if t["rho"] is not None]
        dlist = sorted(cid for cid, dr in district_rows.items() if dr["usps"] == u)
        unassigned = [x for x in dreport["unassigned"] if x["state"] == u]
        unmatched_codes = fjc["unmatched"].get(u, {})
        summary_line = (f"{len(fl)} counties · {len(dlist)} federal district{'s' if len(dlist) != 1 else ''} · "
                        f"{sum(1 for t in ran if t['holds'])} of {len(ran)} county associations hold")
        prof = {"usps": u, "name": meta["name"], "counties": len(fl), "districts": dlist, "values": state_values[u], "us": us_prof,
                "distributions": dists, "tests": tests, "tests_run": len(ran), "tests_hold": sum(1 for t in ran if t["holds"]),
                "standouts": standouts[u], "fjc_fy": fy_tot, "fjc_fy_rate": fy_rate, "fjc_core_fy": fy_core, "fjc_core_fy_rate": fy_core_rate,
                "screened_counties": [{"fips": f, "name": counties[f]["name"], "reasons": legal[f]["fjc_flag"]} for f in fl if legal[f].get("fjc_flag")],
                "unassigned_counties": unassigned, "unmatched_fjc_codes": {"total": sum(unmatched_codes.values()), "top": sorted(unmatched_codes.items(), key=lambda kv: -kv[1])[:8]},
                "coverage": {"counties_with_fjc": sum(1 for f in fl if legal[f]["fjc_5y"] is not None), "counties_with_district": sum(1 for f in fl if f in assign)}}
        facts = [["Counties and county-equivalents", str(len(fl))], ["Federal judicial districts", ", ".join(dlist) or NR],
                 ["County associations tested (Spearman, Benjamini-Hochberg within the state)", str(len(ran))],
                 ["Associations that hold (adjusted p < 0.05)", str(prof["tests_hold"])]]
        facts += [["Stands out", s["text"]] for s in standouts[u][:6]]
        rows.append(writer.record(
            "state_cross_analysis", f"state:{u}", f"{meta['name']}: county and district analysis", source_url=sa_fjc.IDB_URL, subtitle=summary_line,
            cells={"kind": "state", "state": u, "title": meta["name"], "counties": len(fl), "districts": len(dlist), "tests": len(ran), "hold": prof["tests_hold"]},
            facts=facts, text=f"{meta['name']} county analysis associations districts", state=u, filters={"kind": ["state"], "state": [u]},
            badges=["Association, not cause", "Multiple tests"], links=[place_link(u)], extra={"profile": prof}))
    for cid, dr in sorted(district_rows.items()):
        a = dr["filed_by_residence"]
        n = sum(a.values())
        share = lambda k: r2(a.get(k, 0) / n * 100, 1) if n else None  # noqa: E731
        prof = {k: dr[k] for k in ("court_id", "name", "usps", "population", "land_sqmi", "density", "demographics", "median_income_range", "residents_fjc_5y",
                                   "residents_fjc_rate", "residents_core_rate", "osha_rate", "cfpb_rate", "filed_by_residence", "filed_by_residence_core", "filed_fy", "filed_5y")}
        prof["counties"] = [{"fips": f, "name": counties[f]["name"]} for f in sorted(dr["counties"])]
        prof["divisions"] = [{"name": dv["name"], "held_at": dv["held_at"], "counties": sorted(dv["counties"])} for dv in sorted(dr["divisions"].values(), key=lambda x: x["name"])]
        prof["shares"] = {k: share(k) for k in ("own_counties", "other_in_state", "in_state_no_district", "screened_code", "out_of_state", "outside_us", "unmatched_code", "missing")}
        prof["screened_counties"] = [{"fips": f, "name": counties[f]["name"]} for f in dr["screened_counties"]]
        prof["basis"] = sorted({assign[f]["source_url"] for f in dr["counties"]})
        facts = [["Counties (28 U.S.C. ch. 5)", str(len(dr["counties"]))], ["Population, July 1, 2025", fmt(dr["population"])],
                 ["Civil filings in the district, FY2021-FY2025 (FJC IDB)", fmt(n)],
                 ["  first plaintiff lives in the district's counties", fmt(prof["shares"]["own_counties"], "pct")],
                 ["  in another district of the state", fmt(prof["shares"]["other_in_state"], "pct")],
                 ["  outside the state (code 88888)", fmt(prof["shares"]["out_of_state"], "pct")],
                 ["  outside the U.S. (code 99999)", fmt(prof["shares"]["outside_us"], "pct")],
                 ["Federal civil filings by the district's residents per 100,000 a year", fmt(dr["residents_fjc_rate"], "rate")]]
        rows.append(writer.record(
            "state_cross_analysis", f"district:{cid}", f"{dr['name']}: counties, residents and where plaintiffs live", source_url=SD.USC_URL,
            subtitle=f"{len(dr['counties'])} counties · {fmt(dr['population'])} residents · {fmt(n)} civil filings FY2021-FY2025",
            cells={"kind": "district", "state": dr["usps"], "title": dr["name"], "counties": len(dr["counties"]), "population": dr["population"], "filed_5y": n,
                   "out_of_state_pct": prof["shares"]["out_of_state"]},
            facts=facts, text=f"{dr['name']} district counties residents", state=dr["usps"], filters={"kind": ["district"], "state": [dr["usps"]]},
            badges=["28 U.S.C. ch. 5", "FJC IDB"], links=[{"url": f"/courts/{cid}", "label": "Court page"}, place_link(dr["usps"])], extra={"profile": prof}))
    xt = [clean_test(t) for t in xtests]
    xran = [t for t in xt if t["rho"] is not None]
    overview = {"tests": xt, "tests_run": len(xran), "tests_hold": sum(1 for t in xran if t["holds"]), "states": state_values, "us": us_prof,
                "legal": {k: {"label": v[0], "unit": v[1]} for k, v in LEGAL.items()}, "demo": DEMO,
                "district_report": {"aliases": dreport["aliases"], "unmatched_names": dreport["unmatched_names"], "unassigned": len(dreport["unassigned"]),
                                    "conflicts": dreport["conflicts"], "partial_clauses": dreport["partial_clauses"], "invalid_court_ids": dreport["invalid_court_ids"]}}
    rows.append(writer.record(
        "state_cross_analysis", "overview:cross_state", "Across states: legal activity and demographics (Spearman, Benjamini-Hochberg)", source_url=sa_fjc.IDB_URL,
        subtitle=f"{overview['tests_hold']} of {len(xran)} associations across the 50 states and DC hold after adjustment",
        cells={"kind": "overview", "title": "Across states", "tests": len(xran), "hold": overview["tests_hold"]},
        facts=[["Tests", str(len(xran))], ["Hold (adjusted p < 0.05)", str(overview["tests_hold"])]] + [[f"{LEGAL[t['x']][0]} and {t['label']}", f"rho {t['rho']:+.2f}, adjusted p {t['p_bh']:.3f}, n {t['n']}"] for t in xran if t["holds"]],
        text="cross state associations legal activity demographics", filters={"kind": ["overview"]}, badges=["Association, not cause", "Multiple tests"], links=[],
        extra={"profile": overview}))
    summary = {
        "source": "County-level joins of county_profiles and county_legal_activity; districts from 28 U.S.C. ch. 5 (and E.D./W.D. Va. local rules for Virginia's independent cities); FJC IDB residence codes",
        "method": {"association": "Spearman rank correlation over counties (within a state) or states (across states); 95% Fisher interval; two-sided p from the t approximation; Benjamini-Hochberg within each family (one state's tests; the cross-state tests); holds when adjusted p < 0.05; tests need at least 10 counties with both values",
                   "legal_measures": {k: v[0] + " (" + v[1] + ")" for k, v in LEGAL.items()}, "demographic_measures": DEMO,
                   "stands_out": "rates need a five-year count of at least 10; a county is listed when its rate is at least twice the state's median county; concentration when one county holds at least 20% of resident filings; districts when at least 10% of filings name an out-of-state first plaintiff; trends when the yearly mean changed by +50% or -40% (both periods at least 5 a year)",
                   "district_shares": "FJC IDB COUNTY code of the first plaintiff, FY2021-FY2025 filings in the district: own counties / other districts of the state / in-state county with no recorded district / 88888 outside the state / 99999 outside the U.S. / code not a current county / missing"},
        "district_report": {"aliases": len(dreport["aliases"]), "unmatched_names": len(dreport["unmatched_names"]), "unassigned_counties": len(dreport["unassigned"]), "conflicts": len(dreport["conflicts"])},
        "caveats": ["Associations are not causes; county measures share confounders such as urbanisation and the location of courts, prisons and agencies.",
                    "Federal filings by residents count only plaintiffs living in the filing district's state."],
        "totals": {"records": len(rows)},
    }
    write("state_cross_analysis", "State, district and cross-state analysis: county associations, district residence mix and what stands out",
          rows, writer.listing([("kind", "Type"), ("title", "State, district or overview"), ("counties", "Counties"), ("tests", "Tests"), ("hold", "Hold")],
                               [("kind", "Type", {"state": "State", "district": "District", "overview": "Overview"})]), summary, built, ins)


if __name__ == "__main__":
    main()
