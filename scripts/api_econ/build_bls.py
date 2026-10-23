"""BLS bulk time-series files (download.bls.gov/pub/time.series) → two datasets:

  econ_bls_cpi_areas  CPI-U, all items, for every area BLS publishes (U.S. city average, regions, divisions, size
                      classes and metropolitan areas), not seasonally and seasonally adjusted: one row per BLS series with
                      every observation as published (year, period, value, footnote codes). Files cu.series, cu.area,
                      cu.footnote, cu.data.1.AllItems.
  econ_bls_oews       Occupational Employment and Wage Statistics, cross-industry, for the nation, every state and
                      metropolitan area: one row per area with every occupation's employment and wages as published
                      (employment, hourly and annual mean, annual 10th/25th/median/75th/90th percentiles, hourly median).
                      oe.data.0.Current (about 330 MB) is streamed once and filtered as it is read; it is not kept.

The BLS public API answered "daily threshold ... reached" for this environment (no registration key), so the official
bulk files BLS publishes for the same series are used. Values stay text exactly as published ("-" and other special
values included, with their footnote codes). BLS data are U.S. government works (public domain).

  python3 -I -B scripts/api_econ/build_bls.py --acquire-cpi           small CPI files (raw kept)
  python3 -I -B scripts/api_econ/build_bls.py --acquire-oews [--areas S06,M0031080]   stream and filter OEWS
  python3 -I -B scripts/api_econ/build_bls.py [--only cpi|oews]       build
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import econ_common as ec  # noqa: E402

BASE = "https://download.bls.gov/pub/time.series"
RAW = ec.ACQ / "bls"
CPI_DATASET = "econ_bls_cpi_areas"
OEWS_DATASET = "econ_bls_oews"
CPI_FILES = ["cu.series", "cu.area", "cu.footnote", "cu.period", "cu.data.1.AllItems"]
OE_FILES = ["oe.area", "oe.areatype", "oe.datatype", "oe.footnote", "oe.occupation", "oe.release", "oe.txt"]
# datatype code -> field (oe.datatype)
OE_TYPES = {"01": "employment", "03": "hourly_mean", "04": "annual_mean", "08": "hourly_median", "11": "annual_p10",
            "12": "annual_p25", "13": "annual_median", "14": "annual_p75", "15": "annual_p90"}
OE_FIELDS = list(OE_TYPES.values())
CPI_PAGE = "https://www.bls.gov/cpi/"
OEWS_PAGE = "https://www.bls.gov/oes/"


def tsv(path: Path) -> list[dict[str, str]]:
    lines = path.read_text(encoding="latin-1").splitlines()
    head = [h.strip() for h in lines[0].split("\t")]
    return [dict(zip(head, [c.strip() for c in line.split("\t")])) for line in lines[1:] if line.strip()]


def acquire(files: list[str], survey: str) -> None:
    http = ec.Http(min_interval=2.0)
    manifest = RAW / "_manifest.jsonl"
    for f in files:
        url = f"{BASE}/{survey}/{f}"
        ec.save_raw(RAW / f, http.get(url), url, manifest)
    print(json.dumps({"files": len(files)}))


def acquire_oews_stream(areas: set[str] | None) -> None:
    """Read oe.data.0.Current once, keep only cross-industry rows of the wanted data types (N/S/M areas)."""
    url = f"{BASE}/oe/oe.data.0.Current"
    out = RAW / ("oe.filtered.tsv" if not areas else "oe.filtered.sample.tsv")
    req = urllib.request.Request(url, headers={"User-Agent": ec.UA})
    sha = hashlib.sha256()
    total = kept = 0
    pat = re.compile(r"^OEU([NSM])(\d{7})000000(\d{6})(\d{2})$")
    with urllib.request.urlopen(req, timeout=600) as res, out.open("w") as fh:
        header = None
        buf = b""
        while True:
            chunk = res.read(1 << 20)
            if not chunk:
                break
            sha.update(chunk)
            total += len(chunk)
            buf += chunk
            *lines, buf = buf.split(b"\n")
            for raw in lines:
                line = raw.decode("latin-1")
                if header is None:
                    header = line
                    fh.write(line + "\n")
                    continue
                sid = line.split("\t", 1)[0].strip()
                m = pat.match(sid)
                if not m or m.group(4) not in OE_TYPES:
                    continue
                if areas and f"{m.group(1)}{m.group(2)}" not in areas and m.group(1) != "N":
                    continue
                fh.write(line + "\n")
                kept += 1
    entry = {"url": url, "path": str(out.relative_to(ec.ROOT)), "sha256_of_stream": sha.hexdigest(), "bytes_streamed": total,
             "lines_kept": kept, "retrieved_at": ec.utc_now(), "method": "streamed; only matching lines kept",
             "filter": "series OEU[N|S|M]<area>000000<occupation><datatype in " + ",".join(OE_TYPES) + ">"}
    with (RAW / "_manifest.jsonl").open("a") as fh:
        fh.write(json.dumps(entry, sort_keys=True) + "\n")
    print(json.dumps(entry))


def manifest_inputs(names: list[str]) -> list[dict]:
    out = []
    for line in (RAW / "_manifest.jsonl").read_text().splitlines():
        e = json.loads(line)
        if any(e["url"].endswith("/" + n) for n in names):
            out.append({"url": e["url"], "path": e["path"], "sha256": e.get("sha256") or e.get("sha256_of_stream")})
    return out


# ------------------------------------------------------------------------------------------------ CPI by area
def build_cpi() -> tuple[list[dict], list[dict], dict]:
    areas = {a["area_code"]: a for a in tsv(RAW / "cu.area")}
    notes = {f["footnote_code"]: f["footnote_text"] for f in tsv(RAW / "cu.footnote")}
    series = {s["series_id"]: s for s in tsv(RAW / "cu.series") if s["item_code"] == "SA0"}
    obs: dict[str, list[list[str]]] = {}
    for d in tsv(RAW / "cu.data.1.AllItems"):
        if d["series_id"] in series:
            obs.setdefault(d["series_id"], []).append([d["year"], d["period"], d["value"], d.get("footnote_codes", "")])
    rows = []
    for sid in sorted(series, key=lambda k: (int(areas[series[k]["area_code"]]["sort_sequence"]), series[k]["seasonal"], k)):
        s = series[sid]
        o = sorted(obs.get(sid, []), key=lambda x: (x[0], x[1]))
        if not o:
            continue
        a = areas[s["area_code"]]
        level = {"0": "national or region", "1": "division or size class"}.get(a["display_level"], "metropolitan area or size class")
        url = f"https://data.bls.gov/timeseries/{sid}"
        monthly = [x for x in o if re.fullmatch(r"M(0[1-9]|1[0-2])", x[1])]
        latest = monthly[-1] if monthly else o[-1]
        used_notes = sorted({c for x in o for c in x[3].split(",") if c})
        sa = "Seasonally adjusted" if s["seasonal"] == "S" else "Not seasonally adjusted"
        rows.append(ec.record(
            CPI_DATASET, f"cpi:{sid}", s["series_title"], source_url=url,
            subtitle=f"{a['area_name']} · {sa} · base {s['base_period']}",
            state="",
            cells={"area": a["area_name"], "series_id": sid, "seasonal": "SA" if s["seasonal"] == "S" else "NSA",
                   "base": s["base_period"], "first": f"{s['begin_year']} {s['begin_period']}",
                   "last": f"{s['end_year']} {s['end_period']}", "latest": f"{latest[2]} ({latest[0]} {latest[1]})"},
            facts=[["Series", f"{s['series_title']} ({sid})"], ["Area", a["area_name"]], ["Seasonal adjustment", sa],
                   ["Base period", s["base_period"]], ["Periods", f"{s['begin_year']} {s['begin_period']} to {s['end_year']} {s['end_period']} ({len(o)} values; M13 is the annual average, S01/S02 the half-year averages)"],
                   ["Footnotes used", "; ".join(f"{c}: {notes.get(c, ec.NOT_RECORDED)}" for c in used_notes) or "None"],
                   ["Source file", f"{BASE}/cu/cu.data.1.AllItems"]],
            text=f"consumer price index CPI-U all items {a['area_name']} {sid}",
            filters={"seasonal": ["SA" if s["seasonal"] == "S" else "NSA"], "level": [a["display_level"]]},
            links=[{"url": url, "label": "Series on BLS"}, {"url": CPI_PAGE, "label": "BLS CPI"}],
            extra={"kind": "cpi_area", "cpi": {"series_id": sid, "area_code": s["area_code"], "area": a["area_name"],
                                               "seasonal": s["seasonal"], "base_period": s["base_period"], "level": level,
                                               "obs": o, "footnotes": {c: notes.get(c) for c in used_notes}}},
        ))
    return rows, manifest_inputs(CPI_FILES), {"series": len(rows)}


# ------------------------------------------------------------------------------------------------ OEWS
def build_oews(filtered: Path) -> tuple[list[dict], list[dict], dict]:
    areas = {(a["areatype_code"], a["area_code"]): a for a in tsv(RAW / "oe.area")}
    occs = {o["occupation_code"]: o for o in tsv(RAW / "oe.occupation")}
    release = tsv(RAW / "oe.release")[0]["description"]
    notes = {f["footnote_code"]: f["footnote_text"] for f in tsv(RAW / "oe.footnote")}
    pat = re.compile(r"^OEU([NSM])(\d{7})000000(\d{6})(\d{2})$")
    data: dict[tuple[str, str], dict[str, dict[str, list[str]]]] = {}
    years = set()
    for d in tsv(filtered):
        m = pat.match(d["series_id"])
        if not m:
            continue
        years.add(d["year"])
        key = (m.group(1), m.group(2))
        occ = data.setdefault(key, {}).setdefault(m.group(3), {})
        occ[OE_TYPES[m.group(4)]] = [d["value"], d.get("footnote_codes", "")]
    if len(years) != 1:
        raise SystemExit(f"expected one survey year in the current file, found {sorted(years)}")
    year = years.pop()
    rows = []
    order = {"N": 0, "S": 1, "M": 2}
    for key in sorted(data, key=lambda k: (order[k[0]], areas[k]["area_name"] if k in areas else k[1])):
        a = areas.get(key)
        if not a:
            raise SystemExit(f"area {key} missing from oe.area")
        occ = data[key]
        table = {}
        for code in sorted(occ, key=lambda c: int(occs[c]["sort_sequence"]) if c in occs else 10**9):
            vals = occ[code]
            table[code] = [vals.get(f, [None, ""])[0] for f in OE_FIELDS] + [";".join(sorted({c for f in OE_FIELDS for c in (vals.get(f, [None, ""])[1] or "").split(",") if c}))]
        allocc = table.get("000000")
        kind = {"N": "nation", "S": "state", "M": "metropolitan area"}[key[0]]
        usps = None
        if key[0] == "S":
            usps = STATE_FIPS.get(a["state_code"])
        rid = f"oews:{key[0]}{key[1]}"
        # BLS publishes the May <year> area tables in its OEWS data viewer, one page per area code
        url = f"https://data.bls.gov/oes/#/area/{key[1]}/{year}"
        facts = [
            ["Area", f"{a['area_name']} ({kind})"],
            ["Survey", f"Occupational Employment and Wage Statistics, {release} estimates"],
            ["Industry", "Cross-industry (all industries, private, federal, state and local government)"],
            ["Occupations", f"{len(table)} with at least one published estimate"],
            ["All occupations: employment", (allocc or [ec.NOT_RECORDED])[0] or ec.NOT_RECORDED],
            ["All occupations: annual median wage", (allocc[OE_FIELDS.index("annual_median")] if allocc else None) or ec.NOT_RECORDED],
            ["All occupations: annual mean wage", (allocc[OE_FIELDS.index("annual_mean")] if allocc else None) or ec.NOT_RECORDED],
            ["Values", "As published in BLS's bulk file (\"-\" marks an estimate BLS did not release; see footnotes)."],
            ["Footnotes", " ".join(f"({k}) {v}" for k, v in notes.items())],
            ["Source file", f"{BASE}/oe/oe.data.0.Current (series OEU{key[0]}{key[1]}000000<occupation><datatype>)"],
        ]
        rows.append(ec.record(
            OEWS_DATASET, rid, f"Occupational employment and wages, {a['area_name']}, {release}", source_url=url,
            subtitle=f"{kind.capitalize()} · {len(table)} occupations · BLS OEWS {release}",
            state=usps or "",
            cells={"area": a["area_name"], "kind": kind, "occupations": str(len(table)),
                   "employment": (allocc or [ec.NOT_RECORDED])[0] or ec.NOT_RECORDED,
                   "annual_median": (allocc[OE_FIELDS.index("annual_median")] if allocc else None) or ec.NOT_RECORDED},
            facts=facts,
            text=f"occupational employment wages OEWS {a['area_name']} {kind}",
            filters={"kind": [key[0]], **({"state": [usps]} if usps else {})},
            links=[{"url": url, "label": "Area tables on BLS"}, {"url": OEWS_PAGE, "label": "BLS OEWS"}]
                  + ([{"url": f"/places/{usps}", "label": "State page"}] if usps else []),
            extra={"kind": "oews_area", "oews": {"areatype": key[0], "area_code": key[1], "area": a["area_name"],
                                                 "state_code": a["state_code"], "usps": usps, "release": release,
                                                 "year": year, "fields": OE_FIELDS + ["footnotes"], "occupations": table}},
        ))
    # occupation titles, one unlisted row
    used = sorted({c for r in rows for c in r["item"]["oews"]["occupations"]}, key=lambda c: int(occs[c]["sort_sequence"]))
    rows.append(ec.record(
        OEWS_DATASET, "oews:occupations", f"OEWS occupation codes and titles ({release})", source_url=f"{BASE}/oe/oe.occupation",
        subtitle="Standard Occupational Classification codes as BLS lists them", cells={"occupations": str(len(used))},
        facts=[["Occupations", str(len(used))], ["Source file", f"{BASE}/oe/oe.occupation"]],
        text="OEWS occupation codes titles SOC", filters={"_listing": ["no"], "kind": ["codes"]},
        extra={"kind": "oews_codes", "codes": {c: [occs[c]["occupation_name"], occs[c]["display_level"]] for c in used}},
    ))
    return rows, manifest_inputs(OE_FILES + ["oe.data.0.Current"]), {"areas": len(rows) - 1, "release": release, "year": year}


STATE_FIPS = {"01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC",
              "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
              "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT",
              "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
              "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
              "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY", "66": "GU", "72": "PR", "78": "VI"}


def verification(key: str) -> dict | None:
    path = ec.BUILD / "bls" / "verify_bls.json"
    if not path.exists():
        return None
    v = json.loads(path.read_text()).get(key)
    return {k: x for k, x in v.items() if k not in ("differences", "value_differences")} if v else None


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--acquire-cpi", action="store_true")
    ap.add_argument("--acquire-oews", action="store_true")
    ap.add_argument("--areas", default="")
    ap.add_argument("--only", default="")
    ap.add_argument("--sample", action="store_true", help="build OEWS from the sample filter file")
    ap.add_argument("--out", default=str(ec.BUILD / "bls"))
    a = ap.parse_args(argv)
    if a.acquire_cpi:
        acquire(CPI_FILES, "cu")
        return
    if a.acquire_oews:
        acquire(OE_FILES, "oe")
        acquire_oews_stream({x for x in a.areas.split(",") if x} or None)
        return
    if a.only in ("", "cpi"):
        rows, inputs, extra = build_cpi()
        ec.write_build(Path(a.out), CPI_DATASET, "BLS Consumer Price Index (CPI-U), all items, by area: nation, regions, divisions, size classes and metropolitan areas",
                       ec.listing([("area", "Area"), ("seasonal", "Adjustment"), ("base", "Base"), ("first", "First"), ("last", "Last"), ("latest", "Latest")],
                                  [("seasonal", "Seasonal adjustment", {"NSA": "Not seasonally adjusted", "SA": "Seasonally adjusted"}),
                                   ("level", "Area level", {"0": "Nation and regions", "1": "Divisions and size classes", "2": "Metropolitan areas and size classes"})]),
                       {"source": f"{BASE}/cu/", "page": CPI_PAGE, "terms": "BLS data are U.S. government works (public domain).",
                        "method": "cu.series (item SA0, all items) joined to cu.data.1.AllItems; every observation as published with its footnote codes.",
                        "note": "The BLS public API refused this environment's requests (daily threshold for unregistered use reached); the bulk files carry the same series.",
                        "verification": verification("cpi_us_vs_fred"), **extra}, rows, inputs)
    if a.only in ("", "oews"):
        filtered = RAW / ("oe.filtered.sample.tsv" if a.sample else "oe.filtered.tsv")
        rows, inputs, extra = build_oews(filtered)
        ec.write_build(Path(a.out), OEWS_DATASET, f"BLS Occupational Employment and Wage Statistics ({extra['release']}): employment and wages by occupation, nation, states and metropolitan areas",
                       ec.listing([("area", "Area"), ("kind", "Area type"), ("occupations", "Occupations"), ("employment", "Employment"), ("annual_median", "Annual median wage ($)")],
                                  [("kind", "Area type", {"N": "Nation", "S": "State", "M": "Metropolitan area"})]),
                       {"source": f"{BASE}/oe/", "page": OEWS_PAGE, "terms": "BLS data are U.S. government works (public domain).",
                        "method": "oe.data.0.Current streamed once; cross-industry rows of the listed data types kept for national, state and metropolitan areas; one row per area.",
                        "fields": OE_FIELDS, "sample": a.sample, "verification": verification("oews_national"),
                        "caveats": ["Broad SOC groups (e.g. 11-1010) are not in BLS's bulk time-series file and are not listed; major, minor and detailed occupations are.",
                                    "\"-\" is BLS's mark for an estimate it did not release (the Excel tables print \"*\")."],
                        **extra}, rows, inputs)


if __name__ == "__main__":
    main(sys.argv[1:])
