"""Streamed county aggregations of large official files already acquired by other streams (read-only):

  * EPA ECHO Exporter (private/acq/epa_echo/echo_exporter.zip, https://echo.epa.gov/files/echodownloads/echo_exporter.zip):
    facility rows keyed by the reported county FIPS (FAC_FIPS_CODE).
  * OSHA inspections (private/acq/osha/dol/inspection/*.csv.gz, members of https://data.dol.gov/data-catalog/OSHA/inspection/OSHA_inspection.zip):
    inspections opened in FY2021-FY2025, keyed by site ZIP -> county.
  * CFPB Consumer Complaint Database (private/acq/cfpb/bulk/complaints.csv.zip, https://files.consumerfinance.gov/ccdb/complaints.csv.zip):
    complaints received 2021-2025, keyed by consumer ZIP -> county.

ZIP -> county uses the Census 2020 ZCTA-to-county relationship file (sa_sources.assign_zcta): a ZIP is placed in the county
holding the largest land share of its ZCTA; whether the ZCTA lies wholly in that county is counted separately so every
county figure states how much of it rests on a split ZCTA. A ZIP with no ZCTA, a masked ZIP (e.g. '606XX') or a county
in another state than the record's own state is not assigned and is counted in the exclusions.

Results are cached in private/build/state_analysis/cache/<name>.json keyed by the input files' sizes and mtimes.
"""
from __future__ import annotations

import csv
import gzip
import io
import json
import os
import sys
import zipfile

import sa_sources as S

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CACHE = os.path.join(ROOT, "private", "build", "state_analysis", "cache")
ECHO_ZIP = os.path.join(ROOT, "private", "acq", "epa_echo", "echo_exporter.zip")
OSHA_DIR = os.path.join(ROOT, "private", "acq", "osha", "dol", "inspection")
CFPB_ZIP = os.path.join(ROOT, "private", "acq", "cfpb", "bulk", "complaints.csv.zip")
csv.field_size_limit(1 << 24)


def _stamp(paths: list[str]) -> list:
    return [[os.path.relpath(p, ROOT), os.path.getsize(p), int(os.path.getmtime(p))] for p in paths]


def cached(name: str, inputs: list[str], fn):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name + ".json")
    stamp = _stamp(inputs)
    if os.path.exists(path):
        data = json.load(open(path))
        if data.get("inputs") == stamp:
            return data["result"]
    result = fn()
    with open(path, "w") as h:
        json.dump({"inputs": stamp, "result": result}, h)
    return result


def _int(text: str) -> int:
    t = (text or "").strip()
    try:
        return int(float(t)) if t else 0
    except ValueError:
        return 0


def echo_counties() -> dict:
    def run():
        out: dict[str, dict[str, int]] = {}
        stats = {"rows": 0, "no_county": 0, "derived_agrees": 0, "derived_present": 0}
        z = zipfile.ZipFile(ECHO_ZIP)
        with z.open("ECHO_EXPORTER.csv") as h:
            reader = csv.DictReader(io.TextIOWrapper(h, encoding="latin-1", newline=""))
            for r in reader:
                stats["rows"] += 1
                fips = (r.get("FAC_FIPS_CODE") or "").strip()
                derived = (r.get("FAC_DERIVED_STCTY_FIPS") or "").strip()
                if len(fips) != 5 or not fips.isdigit():
                    stats["no_county"] += 1
                    continue
                if len(derived) == 5:
                    stats["derived_present"] += 1
                    stats["derived_agrees"] += derived == fips
                rec = out.setdefault(fips, {"facilities": 0, "active": 0, "inspections_5y": 0, "formal_actions": 0,
                                            "with_formal_action": 0, "snc": 0})
                rec["facilities"] += 1
                rec["active"] += (r.get("FAC_ACTIVE_FLAG") or "") == "Y"
                rec["inspections_5y"] += _int(r.get("FAC_INSPECTION_COUNT", ""))
                fa = _int(r.get("FAC_FORMAL_ACTION_COUNT", ""))
                rec["formal_actions"] += fa
                rec["with_formal_action"] += fa > 0
                rec["snc"] += (r.get("FAC_SNC_FLG") or "") == "Y"
        return {"counties": out, "stats": stats}

    return cached("echo_counties", [ECHO_ZIP], run)


def _zip_assigner(zcta_path: str):
    rel = S.read_zcta_county(zcta_path)
    table = {z: S.assign_zcta(parts) for z, parts in rel.items()}
    return table


def osha_counties(zcta_path: str, fy_lo: int = 2021, fy_hi: int = 2025) -> dict:
    files = sorted(os.path.join(OSHA_DIR, f) for f in os.listdir(OSHA_DIR) if f.endswith(".csv.gz"))

    def run():
        assign = _zip_assigner(zcta_path)
        seen: set[str] = set()
        out: dict[str, dict] = {}
        stats = {"rows": 0, "duplicates": 0, "in_window": 0, "no_zip": 0, "zip_not_zcta": 0, "tie": 0, "state_mismatch": 0, "assigned": 0, "split_zcta": 0}
        for path in files:
            with gzip.open(path, "rt", encoding="utf-8-sig", newline="") as h:
                for r in csv.DictReader(h):
                    stats["rows"] += 1
                    act = r.get("ACTIVITY_NR", "")
                    if act in seen:
                        stats["duplicates"] += 1
                        continue
                    seen.add(act)
                    d = (r.get("OPEN_DATE") or "")[:10]
                    if len(d) != 10 or not d[:4].isdigit():
                        continue
                    y, m = int(d[:4]), int(d[5:7])
                    fy = y + (1 if m >= 10 else 0)
                    if not fy_lo <= fy <= fy_hi:
                        continue
                    stats["in_window"] += 1
                    z = S.zip5(r.get("SITE_ZIP", ""))
                    if not z:
                        stats["no_zip"] += 1
                        continue
                    if z not in assign:
                        stats["zip_not_zcta"] += 1
                        continue
                    county, whole = assign[z]
                    if county is None:
                        stats["tie"] += 1
                        continue
                    st = (r.get("SITE_STATE") or "").strip().upper()
                    if S.FIPS_TO_USPS.get(county[:2]) != st:
                        stats["state_mismatch"] += 1
                        continue
                    stats["assigned"] += 1
                    rec = out.setdefault(county, {"fy": {}, "split": 0})
                    rec["fy"][str(fy)] = rec["fy"].get(str(fy), 0) + 1
                    if not whole:
                        rec["split"] += 1
                        stats["split_zcta"] += 1
        return {"counties": out, "stats": stats}

    return cached("osha_counties", files + [zcta_path], run)


def cfpb_counties(zcta_path: str, y_lo: int = 2021, y_hi: int = 2025) -> dict:
    def run():
        assign = _zip_assigner(zcta_path)
        out: dict[str, dict] = {}
        stats = {"rows": 0, "in_window": 0, "no_zip": 0, "masked_zip": 0, "zip_not_zcta": 0, "tie": 0, "state_mismatch": 0, "assigned": 0, "split_zcta": 0}
        z = zipfile.ZipFile(CFPB_ZIP)
        with z.open("complaints.csv") as h:
            reader = csv.reader(io.TextIOWrapper(h, encoding="utf-8", newline=""))
            header = next(reader)
            i_date, i_prod, i_state, i_zip = (header.index(c) for c in ("Date received", "Product", "State", "ZIP code"))
            for r in reader:
                stats["rows"] += 1
                if len(r) <= i_zip:
                    continue
                y = r[i_date][:4]
                if not y.isdigit() or not y_lo <= int(y) <= y_hi:
                    continue
                stats["in_window"] += 1
                raw = r[i_zip].strip()
                if not raw:
                    stats["no_zip"] += 1
                    continue
                zc = S.zip5(raw)
                if not zc:
                    stats["masked_zip"] += 1
                    continue
                if zc not in assign:
                    stats["zip_not_zcta"] += 1
                    continue
                county, whole = assign[zc]
                if county is None:
                    stats["tie"] += 1
                    continue
                if S.FIPS_TO_USPS.get(county[:2]) != r[i_state].strip().upper():
                    stats["state_mismatch"] += 1
                    continue
                stats["assigned"] += 1
                rec = out.setdefault(county, {"y": {}, "credit_reporting": 0, "split": 0})
                rec["y"][y] = rec["y"].get(y, 0) + 1
                if r[i_prod].startswith("Credit reporting"):
                    rec["credit_reporting"] += 1
                if not whole:
                    rec["split"] += 1
                    stats["split_zcta"] += 1
        return {"counties": out, "stats": stats}

    return cached("cfpb_counties", [CFPB_ZIP, zcta_path], run)


if __name__ == "__main__":
    zcta = os.path.join(ROOT, "private", "acq", "state_analysis", "census", "tab20_zcta520_county20_natl.txt")
    which = sys.argv[1:] or ["echo", "osha", "cfpb"]
    if "echo" in which:
        print("echo", json.dumps(echo_counties()["stats"]))
    if "osha" in which:
        print("osha", json.dumps(osha_counties(zcta)["stats"]))
    if "cfpb" in which:
        print("cfpb", json.dumps(cfpb_counties(zcta)["stats"]))
