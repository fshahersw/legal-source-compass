"""Case law v2 step 1: the court registry (which CourtListener courts each tier holds, and their jurisdictions).

    python3 -I -B scripts/caselaw_v2/courts.py [--profiles private/build/courtlistener/clb_court_profiles.json.gz]

Downloads the two small bulk files of the pinned snapshot (courts, courthouses; under 100 KB together) into
private/acq/w1025_caselaw/ with their sha256, and writes private/build/w1025_caselaw/courts.json:

  {"snapshot", "sources": [{url, path, bytes, sha256, acquired_at}], "courts": [
     {court_id, level (CourtListener jurisdiction code), tier (4-7, or null for tiers 1-3 / excluded), full_name,
      short_name, citation_string, parent_court_id, in_use, start_date, end_date, url, system (federal / state /
      territorial / tribal, from the level code), jurisdiction (two-letter state when the level is state-scoped (S, SA,
      ST, SS, FD, FB, FBP) and every courthouse CourtListener records for the court is in one state; else null = Not
      recorded), expected_clusters (clb_court_profiles count, when given), excluded (reason, when never loaded)}],
   "levels": {code: {tier, courts, expected_clusters}}, "excluded": {...}, "unknown_levels": [...]}

Nothing is inferred from names: the tier comes from the `jurisdiction` code, the state from courthouse rows.
"""
from __future__ import annotations

import argparse
import collections
import gzip
import hashlib
import io
import json
import os
import sys
import urllib.request
import ssl

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (ACQ, BULK, EXCLUDED_COURTS, EXCLUDED_LEVELS, EXISTING_LEVELS, FILES, LEVEL_TIER, SNAPSHOT,  # noqa: E402
                    STATE_SCOPED_LEVELS, SYSTEM_OF_LEVEL, UA, WORK, now, tier_of_level, write_json)

CA = "/root/.ccr/ca-bundle.crt"
PROFILES = os.path.join(os.path.dirname(WORK), "courtlistener", "clb_court_profiles.json.gz")


def fetch(name: str) -> tuple[bytes, dict]:
    url = BULK + FILES[name]
    path = os.path.join(ACQ, FILES[name])
    if os.path.exists(path):
        data = open(path, "rb").read()
    else:
        ctx = ssl.create_default_context(cafile=CA if os.path.exists(CA) else None)
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60, context=ctx) as r:
            data = r.read()
        os.makedirs(ACQ, exist_ok=True)
        with open(path + ".tmp", "wb") as h:
            h.write(data)
        os.replace(path + ".tmp", path)
    src = {"url": url, "path": os.path.relpath(path, os.path.dirname(os.path.dirname(ACQ))), "bytes": len(data),
           "sha256": hashlib.sha256(data).hexdigest(), "acquired_at": now()}
    return data, src


def parse_csv(bz2_bytes: bytes) -> list[dict]:
    """CourtListener bulk CSV (PostgreSQL COPY csv, ESCAPE '\\') -> list of dicts of strings (None for NULL)."""
    import bz2

    import pyarrow as pa
    import pyarrow.csv as pacsv

    raw = bz2.decompress(bz2_bytes)
    header = raw.split(b"\n", 1)[0].decode().split(",")
    tbl = pacsv.read_csv(io.BytesIO(raw), parse_options=pacsv.ParseOptions(quote_char='"', double_quote=False, escape_char="\\",
                                                                           newlines_in_values=True),
                         convert_options=pacsv.ConvertOptions(column_types={c: pa.string() for c in header}, strings_can_be_null=True,
                                                              null_values=[""]))
    return tbl.to_pylist()


def clean(v):
    if v is None:
        return None
    v = v.strip()
    return v or None


def court_states(courthouses: list[dict]) -> dict[str, str | None]:
    by = collections.defaultdict(set)
    for h in courthouses:
        c = clean(h.get("court_id"))
        st = clean(h.get("state"))
        if c and st:
            by[c].add(st.upper())
    return {c: (next(iter(s)) if len(s) == 1 else None) for c, s in by.items()}


def load_profiles(path: str) -> dict[str, int]:
    if not path or not os.path.exists(path):
        return {}
    d = json.load(gzip.open(path))
    return {r["id"]: int(r["item"]["cells"].get("clusters") or 0) for r in d.get("rows", [])}


def build_registry(courts: list[dict], courthouses: list[dict], profiles: dict[str, int]) -> dict:
    states = court_states(courthouses)
    out = []
    unknown = collections.Counter()
    for c in courts:
        cid = clean(c.get("id"))
        level = clean(c.get("jurisdiction"))
        if not cid:
            continue
        tier = tier_of_level(level, cid)
        if level not in LEVEL_TIER and level not in EXISTING_LEVELS and level not in EXCLUDED_LEVELS:
            unknown[level or "null"] += 1
        # the courthouse state is a jurisdiction only for state-scoped levels; national courts seated in DC get none
        st = states.get(cid) if level in STATE_SCOPED_LEVELS else None
        out.append({
            "court_id": cid, "level": level, "tier": tier, "full_name": clean(c.get("full_name")),
            "short_name": clean(c.get("short_name")), "citation_string": clean(c.get("citation_string")),
            "parent_court_id": clean(c.get("parent_court_id")), "in_use": c.get("in_use") == "t",
            "start_date": clean(c.get("start_date")), "end_date": clean(c.get("end_date")), "url": clean(c.get("url")),
            "system": SYSTEM_OF_LEVEL.get(level or ""), "jurisdiction": st, "expected_clusters": profiles.get(cid),
            "excluded": EXCLUDED_COURTS.get(cid) or EXCLUDED_LEVELS.get(level or ""),
        })
    out.sort(key=lambda r: (r["tier"] or 0, r["level"] or "", r["court_id"]))
    levels: dict = {}
    for r in out:
        lv = levels.setdefault(r["level"] or "null", {"tier": r["tier"], "courts": 0, "expected_clusters": 0})
        lv["courts"] += 1
        lv["expected_clusters"] += r["expected_clusters"] or 0
    return {"snapshot": SNAPSHOT, "courts": out, "levels": levels, "excluded": {"levels": EXCLUDED_LEVELS, "courts": EXCLUDED_COURTS},
            "unknown_levels": sorted(unknown)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--profiles", default=PROFILES)
    a = ap.parse_args()
    cdata, csrc = fetch("courts")
    hdata, hsrc = fetch("courthouses")
    reg = build_registry(parse_csv(cdata), parse_csv(hdata), load_profiles(a.profiles))
    reg["sources"] = [csrc, hsrc]
    if os.path.exists(a.profiles):
        reg["sources"].append({"path": os.path.relpath(a.profiles, os.path.dirname(os.path.dirname(WORK))),
                               "note": "expected cluster counts per court (CourtListener bulk 2026-09-30, published dataset clb_court_profiles)"})
    reg["built_at"] = now()
    write_json(os.path.join(WORK, "courts.json"), reg)
    print(json.dumps({k: v for k, v in reg["levels"].items()}, indent=0))
    print("unknown levels:", reg["unknown_levels"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
