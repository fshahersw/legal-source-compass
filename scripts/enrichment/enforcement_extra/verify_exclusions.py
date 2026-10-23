"""Independent check of sam_exclusions and oig_leie_exclusions against the raw files (second code path).

The raw CSVs are re-read with the csv module only (no builder code) and compared with the streamed build rows:
  - record counts equal the source data-row counts; ids unique; every SAM record number present exactly once
  - every row's name, classification/kind, agency/category, exclusion type/code and dates equal the raw values
  - no row carries a street address, ZIP code or (LEIE) date of birth from the raw file
  - per-agency (SAM) and per-exclusion-type (LEIE) counts equal the raw counts

  python3 -I -B verify_exclusions.py    exits 1 when any check fails
"""
from __future__ import annotations

import collections
import csv
import glob
import gzip
import io
import json
import os
import sys
import zipfile

from common import ACQ, BUILD, iter_build_rows

failures: list[str] = []


def fail(msg: str) -> None:
    if len(failures) < 200:
        failures.append(msg)
    else:
        failures.append("...")


def sp(s: str) -> str:
    return " ".join((s or "").split())


def sam_name(r: dict) -> str:
    if sp(r["Name"]):
        return sp(r["Name"])
    prefix = sp(r["Prefix"])
    parts = ([prefix] if prefix and not any(c.isdigit() for c in prefix) else []) + [sp(r[k]) for k in ("First", "Middle", "Last", "Suffix")]
    return " ".join(p for p in parts if p)


def verify_sam() -> dict:
    path = sorted(glob.glob(os.path.join(ACQ, "sam", "SAM_Exclusions_Public_Extract_V2_*.ZIP")))[-1]
    raw = {}
    agency = collections.Counter()
    private = {}
    with zipfile.ZipFile(path) as z, z.open(z.infolist()[0]) as f:
        for r in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8", newline="")):
            key = r["SAM Number"].strip().lower()
            raw[key] = r
            agency[sp(r["Excluding Agency"])] += 1
            # individuals' street addresses and ZIP codes must not appear anywhere in their row
            if sp(r["Classification"]) == "Individual":
                sensitive = [sp(r[k]) for k in ("Address 1", "Address 2", "Address 3", "Address 4") if len(sp(r[k])) >= 8]
                if len(sp(r["Zip Code"])) >= 5:
                    sensitive.append(sp(r["Zip Code"])[:5])
                if sensitive:
                    private[key] = sensitive
    seen = set()
    built_agency = collections.Counter()
    n = 0
    for row in iter_build_rows(os.path.join(BUILD, "sam_exclusions.json")):
        n += 1
        key = row["id"].removeprefix("sam:")
        if key in seen:
            fail(f"sam duplicate {key}")
        seen.add(key)
        r = raw.get(key)
        if not r:
            fail(f"sam {key} not in the extract")
            continue
        d = row["detail"]
        if row["title"] != sam_name(r):
            fail(f"sam {key} name {row['title']!r} != {sam_name(r)!r}")
        expect = {
            "classification": sp(r["Classification"]) or None, "excluding_agency": sp(r["Excluding Agency"]) or None,
            "exclusion_type": sp(r["Exclusion Type"]) or None, "program": sp(r["Exclusion Program"]) or None,
            "active_date": sp(r["Active Date"]) or None,
            "termination_date": "Indefinite" if sp(r["Termination Date"]).lower() == "indefinite" else (sp(r["Termination Date"]) or None),
        }
        for k, v in expect.items():
            if d.get(k) != v:
                fail(f"sam {key} {k} {d.get(k)!r} != {v!r}")
        if row["source_url"] != f"https://sam.gov/exclusion/{key}/view":
            fail(f"sam {key} source_url")
        blob = json.dumps({k: v for k, v in row.items() if k not in ("id", "source_url")}, ensure_ascii=False)
        blob = blob.replace(key, "")  # the record UUID may contain five-digit runs
        for s in private.get(key, []):
            if s.lower() in blob.lower():
                fail(f"sam {key} (individual) carries a street address or ZIP code")
        built_agency[d.get("excluding_agency") or ""] += 1
    if n != len(raw):
        fail(f"sam rows {n} != extract rows {len(raw)}")
    if built_agency != agency:
        fail("sam per-agency counts differ")
    return {"dataset": "sam_exclusions", "rows": n, "source_rows": len(raw), "agencies": len(agency)}


def leie_name(r: dict) -> str:
    last, first, mid = sp(r["LASTNAME"]), sp(r["FIRSTNAME"]), sp(r["MIDNAME"])
    if last or first:
        given = " ".join(p for p in (first, mid) if p)
        return f"{last}, {given}" if last and given else (last or given)
    return sp(r["BUSNAME"])


def iso(v: str) -> str | None:
    v = sp(v)
    return None if not v or set(v) <= {"0"} else f"{v[:4]}-{v[4:6]}-{v[6:]}"


def verify_leie() -> dict:
    raw_keys = collections.Counter()
    codes = collections.Counter()
    dobs, addrs = {}, {}
    rows_raw = 0
    with gzip.open(os.path.join(ACQ, "leie", "UPDATED.csv.gz"), "rt", encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            rows_raw += 1
            k = (leie_name(r), sp(r["BUSNAME"]), sp(r["EXCLTYPE"]), iso(r["EXCLDATE"]), sp(r["CITY"]), sp(r["STATE"]))
            raw_keys[k] += 1
            codes[sp(r["EXCLTYPE"])] += 1
            if iso(r["DOB"]):
                dobs.setdefault(k, set()).update({sp(r["DOB"]), iso(r["DOB"])})
            if len(sp(r["ADDRESS"])) >= 8:
                addrs.setdefault(k, set()).add(sp(r["ADDRESS"]))
    built_keys = collections.Counter()
    built_codes = collections.Counter()
    n = 0
    ids = set()
    for row in iter_build_rows(os.path.join(BUILD, "oig_leie_exclusions.json")):
        n += 1
        if row["id"] in ids:
            fail(f"leie duplicate id {row['id']}")
        ids.add(row["id"])
        c, d = row["item"]["cells"], row["detail"]
        place = c.get("place", "")
        city, _, state = place.rpartition(", ") if ", " in place else (place, "", "")
        if not state and place and len(place) == 2:
            city, state = "", place
        k = (row["title"], c.get("business", ""), c.get("code", ""), c.get("excluded"), city, state)
        built_keys[k] += 1
        built_codes[c.get("code", "")] += 1
        blob = json.dumps(row, ensure_ascii=False)
        for s in dobs.get(k, ()):
            if s and s != c.get("excluded") and s in blob:
                fail(f"leie {row['id']} carries a date of birth")
        # entities' names can themselves be addresses ("1951 FLATBUSH AVENUE PHARMACY"); the check is for people
        if c.get("kind") == "Individual":
            for s in addrs.get(k, ()):
                if s in blob:
                    fail(f"leie {row['id']} (individual) carries a street address")
        if d.get("exclusion_date") != c.get("excluded"):
            fail(f"leie {row['id']} exclusion date differs between detail and cells")
    if n != rows_raw:
        fail(f"leie rows {n} != file rows {rows_raw}")
    missing = raw_keys - built_keys
    extra = built_keys - raw_keys
    if missing or extra:
        fail(f"leie published-field tuples differ: {sum(missing.values())} missing, {sum(extra.values())} extra; e.g. {list(missing)[:2]} {list(extra)[:2]}")
    if built_codes != codes:
        fail("leie per-code counts differ")
    return {"dataset": "oig_leie_exclusions", "rows": n, "source_rows": rows_raw, "codes": len(codes)}


if __name__ == "__main__":
    results = [verify_sam(), verify_leie()]
    print(json.dumps({"results": results, "failures": len(failures)}, indent=1))
    for f in failures[:50]:
        print("FAIL", f)
    with open(os.path.join(BUILD, "verify_exclusions.json"), "w", encoding="utf-8") as fh:
        json.dump({"results": results, "failures": failures}, fh, indent=1)
    sys.exit(1 if failures else 0)
