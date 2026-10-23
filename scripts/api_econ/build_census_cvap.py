"""Citizen voting-age population (ACS 5-year table B29001) for the nation, states and counties → census_acs_cvap_counties.

Why: federal and most state juries are drawn from adult citizens (28 U.S.C. § 1865(b)(1) requires a juror to be a
citizen of the United States at least eighteen years old); the county's citizen voting-age population, by age, is the
closest published Census measure of the population a venue's jury pool is drawn from. It complements the county
demographics already published in census_acs_counties (race and Hispanic origin, age, education, income), which this
dataset does not repeat.

Source: Census Data API, ACS 5-year detailed tables, B29001_001E–005E (citizen, 18 and over: total, 18–29, 30–44,
45–64, 65 and over) with margins of error, and B01003_001E (total population, the same release) for the share. Releases
2020–2024 (latest) and 2015–2019 (the last release without overlapping years). Variable labels are read from the API's
variable metadata and must match before any value is used. Values as published; the share is CVAP ÷ total population of
the same release, rounded to 0.1 percentage point (no margin is computed for it).

  python3 -I -B scripts/api_econ/build_census_cvap.py --acquire     (CENSUS_API_KEY from private secrets; never printed)
  python3 -I -B scripts/api_econ/build_census_cvap.py
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import econ_common as ec  # noqa: E402

DATASET = "census_acs_cvap_counties"
RAW = ec.ACQ / "census_cvap"
YEARS = [2024, 2019]
API = "https://api.census.gov/data/{year}/acs/acs5"
VARS = {
    "B29001_001": ("cvap", r"^Estimate!!Total:?$"),
    "B29001_002": ("age_18_29", r"^Estimate!!Total:?!!18 to 29 years$"),
    "B29001_003": ("age_30_44", r"^Estimate!!Total:?!!30 to 44 years$"),
    "B29001_004": ("age_45_64", r"^Estimate!!Total:?!!45 to 64 years$"),
    "B29001_005": ("age_65_plus", r"^Estimate!!Total:?!!65 years and over$"),
    "B01003_001": ("population", r"^Estimate!!Total:?$"),
}
CONCEPTS = {"B29001": r"citizen,? voting-age population by age", "B01003": r"total population"}
GEOS = {"us": "us:1", "state": "state:*", "county": "county:*"}
STATE_USPS = {"01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC",
              "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
              "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT",
              "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
              "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
              "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY", "72": "PR"}


def acquire() -> None:
    key = ec.secret("CENSUS_API_KEY")
    http = ec.Http(min_interval=1.0, timeout=300)
    manifest = RAW / "_manifest.jsonl"
    for y in YEARS:
        base = API.format(year=y)
        for v in VARS:
            url = f"{base}/variables/{v}E.json"
            ec.save_raw(RAW / f"{y}_var_{v}E.json", http.get(url), url, manifest)
        get = ",".join(["NAME"] + [f"{v}E" for v in VARS] + [f"{v}M" for v in VARS])
        for level, geo in GEOS.items():
            q = f"{base}?get={get}&for={geo}" + ("&in=state:*" if level == "county" else "")
            body = http.get(q + f"&key={key}", record_url=q)
            ec.save_raw(RAW / f"{y}_{level}.json", body, q, manifest)
    print(json.dumps({"requests": len(http.requests)}))


def check_labels(year: int) -> None:
    for v, (_, pattern) in VARS.items():
        meta = json.loads((RAW / f"{year}_var_{v}E.json").read_text())
        if not re.match(pattern, meta.get("label", "")):
            raise SystemExit(f"{year} {v}E label is {meta.get('label')!r}, expected {pattern}")
        concept = meta.get("concept", "")
        if not re.search(CONCEPTS[v.split("_")[0]], concept, re.I):
            raise SystemExit(f"{year} {v}E concept is {concept!r}")


def num(v):
    if v is None:
        return None
    try:
        n = int(v)
    except ValueError:
        return None
    return None if n < 0 else n  # the API's negative sentinels (e.g. -666666666) mark a value not available


def build() -> tuple[list[dict], list[dict], dict]:
    data: dict[str, dict] = {}
    names: dict[str, str] = {}
    for y in YEARS:
        check_labels(y)
        for level in GEOS:
            table = json.loads((RAW / f"{y}_{level}.json").read_text())
            head = table[0]
            for r in table[1:]:
                rec = dict(zip(head, r))
                if level == "us":
                    gid = "US"
                elif level == "state":
                    gid = rec["state"]
                else:
                    gid = rec["state"] + rec["county"]
                if level != "us" and rec["state"] not in STATE_USPS:
                    continue
                names.setdefault(gid, rec["NAME"])
                vals = {VARS[v][0]: num(rec.get(f"{v}E")) for v in VARS}
                moes = {VARS[v][0]: num(rec.get(f"{v}M")) for v in VARS}
                data.setdefault(gid, {"level": level, "years": {}})["years"][str(y)] = {"estimate": vals, "moe": moes}
    rows = []
    order = {"us": 0, "state": 1, "county": 2}
    for gid in sorted(data, key=lambda g: (order[data[g]["level"]], g)):
        d = data[gid]
        level = d["level"]
        usps = "" if level == "us" else STATE_USPS[gid[:2]]
        latest_year = max(d["years"])
        latest = d["years"][latest_year]["estimate"]
        share = None
        if latest.get("cvap") is not None and latest.get("population"):
            share = round(latest["cvap"] / latest["population"] * 100, 1)
        shares = {}
        for y, v in d["years"].items():
            e = v["estimate"]
            shares[y] = round(e["cvap"] / e["population"] * 100, 1) if e.get("cvap") is not None and e.get("population") else None
        fmt = lambda n: ec.NOT_RECORDED if n is None else f"{n:,}"  # noqa: E731
        def with_moe(y, k):
            e, m = d["years"][y]["estimate"].get(k), d["years"][y]["moe"].get(k)
            return ec.NOT_RECORDED if e is None else f"{e:,}" + (f" ± {m:,}" if m is not None else "")
        url = API.format(year=int(latest_year)) + "?get=NAME,B29001_001E&for=" + (
            "us:1" if level == "us" else f"state:{gid}" if level == "state" else f"county:{gid[2:]}&in=state:{gid[:2]}")
        facts = [["Geography", f"{names[gid]} ({level}{', FIPS ' + gid if level != 'us' else ''})"]]
        for y in sorted(d["years"], reverse=True):
            label = f"ACS 5-year {int(y) - 4}–{y}"
            facts += [[f"Citizens 18 and over, {label}", with_moe(y, "cvap")],
                      [f"Total population, {label}", with_moe(y, "population")],
                      [f"Share of the population, {label}", f"{shares[y]}%" if shares[y] is not None else ec.NOT_RECORDED],
                      [f"By age, {label}", "; ".join(f"{lbl} {with_moe(y, k)}" for k, lbl in (("age_18_29", "18–29"), ("age_30_44", "30–44"), ("age_45_64", "45–64"), ("age_65_plus", "65+")))]]
        facts += [["Why it matters", "Jurors are drawn from adult citizens (28 U.S.C. § 1865(b)(1) for federal courts); this is the closest published Census count of that population."],
                  ["Method", "Values and margins of error as published (90% confidence); share = citizens 18+ ÷ total population of the same ACS release, rounded to 0.1 point, no margin computed."]]
        links = [{"url": url, "label": "Census Data API query"}, {"url": "https://www.census.gov/programs-surveys/acs", "label": "American Community Survey"}]
        if level == "state":
            links.append({"url": f"/places/{usps}", "label": "State page"})
        elif level == "county":
            links.append({"url": f"/places/{usps}/{gid}", "label": "County page"})
        rows.append(ec.record(
            DATASET, gid, f"Citizen voting-age population: {names[gid]}", source_url=url,
            subtitle=f"ACS 5-year {int(latest_year) - 4}–{latest_year} · {fmt(latest.get('cvap'))} citizens 18 and over",
            state=usps,
            cells={"name": names[gid], "level": level, "cvap": fmt(latest.get("cvap")), "population": fmt(latest.get("population")),
                   "share": f"{share}%" if share is not None else ec.NOT_RECORDED,
                   "cvap_2019": fmt(d["years"].get("2019", {}).get("estimate", {}).get("cvap"))},
            facts=facts,
            text=f"citizen voting age population jury pool venue {names[gid]}",
            filters={"level": [level], **({"state": [usps]} if usps else {})},
            links=links,
            extra={"kind": "cvap", "census": {"geoid": gid, "level": level, "usps": usps or None, "name": names[gid],
                                              "tables": ["B29001", "B01003"], "years": d["years"], "share_percent": shares}},
        ))
    inputs = []
    for line in (RAW / "_manifest.jsonl").read_text().splitlines():
        e = json.loads(line)
        inputs.append({"url": e["url"], "path": e["path"], "sha256": e["sha256"]})
    return rows, inputs, {"years": YEARS}


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--acquire", action="store_true")
    ap.add_argument("--out", default=str(ec.BUILD / "census_cvap"))
    a = ap.parse_args(argv)
    if a.acquire:
        acquire()
        return
    rows, inputs, extra = build()
    ec.write_build(
        Path(a.out), DATASET, "Citizen voting-age population (ACS 5-year, table B29001): nation, states and counties, 2015–2019 and 2020–2024",
        ec.listing([("name", "Geography"), ("level", "Level"), ("cvap", "Citizens 18+ (2020–2024)"), ("population", "Population"),
                    ("share", "Share"), ("cvap_2019", "Citizens 18+ (2015–2019)")],
                   [("level", "Level", {"us": "Nation", "state": "State", "county": "County"})]),
        {"source": "https://api.census.gov/data/2024/acs/acs5", "tables": ["B29001", "B01003"],
         "terms": "Census Bureau data are U.S. government works (public domain).",
         "method": "Census Data API, ACS 5-year detailed tables; variable labels checked against the API metadata before use; values and margins as published.",
         "caveats": ["ACS 5-year estimates describe the five-year period, not a single year.",
                     "Connecticut's counties are planning regions in the 2022 and later releases, so 2015–2019 and 2020–2024 county codes differ there.",
                     "Margins of error are 90% confidence intervals as published; the share has no computed margin."], **extra},
        rows, inputs)


if __name__ == "__main__":
    main(sys.argv[1:])
