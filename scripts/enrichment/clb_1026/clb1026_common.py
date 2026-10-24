"""Shared pure helpers for the wave-1026 CourtListener builders (no network, no DuckDB; safe to unit-test).

* `pg_rows(path)` reads a CourtListener bulk CSV (PostgreSQL COPY CSV with backslash escapes, bzip2) row by row.
* `show_date(value, granularity)` renders a date only to the precision CourtListener recorded (%Y, %Y-%m, %Y-%m-%d).
* `legends()` returns CourtListener's own code legends (choices and display names) from the archived OPTIONS responses.
* `bulk_input(name)` / `api_inputs(...)` give the provenance entries (url, path, sha256) for a build file's `inputs`.
"""
from __future__ import annotations

import bz2
import csv
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
for p in (HERE, os.path.join(ROOT, "scripts", "enrichment")):
    if p not in sys.path:
        sys.path.insert(0, p)

ACQ = os.path.join(ROOT, "private", "acq", "clb_1026")
BULK_DIR = os.path.join(ACQ, "bulk")
OUT = os.path.join(ROOT, "private", "build", "clb_1026")
LOOK = os.path.join(OUT, "lookups")
SPINE = os.path.join(ROOT, "private", "build", "fjc_idb", "lookups", "court_spine.json")
SNAPSHOT = "2026-09-30"
BULK_BASE = "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/"
BULK_HELP = "https://www.courtlistener.com/help/api/bulk-data/"
TERMS = ("CourtListener (Free Law Project) publishes these bulk files for download without an account and the REST API to "
         "registered users; see https://www.courtlistener.com/terms/ and the bulk-data help page.")
GRANULARITY = {"%Y": 4, "%Y-%m": 7, "%Y-%m-%d": 10}

csv.field_size_limit(1 << 30)


def pg_rows(path: str):
    """Yield dicts from a bzip2 PostgreSQL CSV export. COPY writes a quote inside a field as \\" and a backslash as \\\\;
    an empty unquoted field and an empty quoted field both arrive as '' here (both mean "nothing recorded" for display)."""
    with bz2.open(path, "rt", encoding="utf-8", newline="") as h:
        reader = csv.reader(h, escapechar="\\", doublequote=False)
        header = next(reader)
        for row in reader:
            if len(row) != len(header):
                raise ValueError(f"{os.path.basename(path)}: row with {len(row)} fields, header has {len(header)}")
            yield dict(zip(header, row))


def blank(v):
    """'' -> None; other strings stripped."""
    if v is None:
        return None
    s = v.strip()
    return s or None


def as_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def as_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def show_date(value: str | None, granularity: str | None) -> str | None:
    """The stored ISO date cut to the recorded precision; without a recorded granularity the full stored date is shown.
    A date that is not ISO is returned as None (never repaired)."""
    v = blank(value)
    if not v or len(v) < 10 or v[4] != "-" or v[7] != "-":
        return None
    n = GRANULARITY.get(blank(granularity) or "", 10)
    return v[:n]


def bool_flag(v) -> bool | None:
    return True if v == "t" else False if v == "f" else None


def clip(v, n: int = 300):
    if v is None:
        return None
    s = " ".join(str(v).split())
    if not s:
        return None
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def compact(v):
    """Drop None, empty strings, empty lists/dicts and False flags from nested dicts (lists keep their order; numbers 0 stay)."""
    if isinstance(v, dict):
        out = {}
        for k, x in v.items():
            x = compact(x)
            if x is None or x is False or x == "" or x == [] or x == {}:
                continue
            out[k] = x
        return out
    if isinstance(v, list):
        return [compact(x) for x in v]
    return v


def facts(pairs):
    return [[k, "Not recorded" if v is None or v == "" else str(v)] for k, v in pairs]


def fmt_int(n) -> str:
    return "Not recorded" if n is None else f"{int(n):,}"


# ---- provenance -------------------------------------------------------------------------------------------------------

def _manifest(path: str) -> list[dict]:
    return [json.loads(line) for line in open(path)] if os.path.exists(path) else []


def bulk_input(name: str) -> dict:
    """The latest manifest entry for a downloaded bulk file: {url, path, sha256, bytes, retrieved_at, last_modified}."""
    hits = [m for m in _manifest(os.path.join(BULK_DIR, "_manifest.jsonl")) if m["url"].endswith("/" + name)]
    if not hits:
        raise SystemExit(f"{name} is not in the bulk manifest: run fetch_bulk.py first")
    m = hits[-1]
    return {k: m[k] for k in ("url", "path", "sha256", "bytes", "retrieved_at", "last_modified")}


def bulk_path(name: str) -> str:
    return os.path.join(ROOT, bulk_input(name)["path"])


# ---- CourtListener's code legends -------------------------------------------------------------------------------------

def legends() -> dict:
    """{endpoint: {field: {code: display_name}}} from the archived OPTIONS responses, plus help texts under '_help'."""
    import cl_api  # noqa: PLC0415

    out: dict = {}
    for (method, url), rec in cl_api.load_index().items():
        if method != "OPTIONS":
            continue
        ep = url.replace(cl_api.API, "").strip("/")
        body = json.loads(cl_api.read_raw(rec["sha256"]))
        fields = (body.get("actions") or {}).get("POST") or {}
        ent = {"_help": {}, "_source": {"url": url, "sha256": rec["sha256"], "retrieved_at": rec["retrieved_at"], "method": "OPTIONS"}}
        for name, f in fields.items():
            if f.get("choices"):
                ent[name] = {str(c["value"]): c["display_name"] for c in f["choices"]}
            if f.get("help_text"):
                ent["_help"][name] = f["help_text"]
        out[ep] = ent
    return out


def label(leg: dict, endpoint: str, field: str, code) -> str | None:
    """CourtListener's display name for a stored code, or None when the code is blank or not in its legend."""
    c = blank(code) if isinstance(code, str) else code
    if c is None:
        return None
    return (leg.get(endpoint) or {}).get(field, {}).get(str(c))


def spine_ids() -> set[str]:
    return set(json.load(open(SPINE))["ids"])


def court_link(cid, spine: set[str]):
    return f"/courts/{cid}" if cid and cid in spine else None


def write_build(spec: dict) -> str:
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, spec["dataset"] + ".json")
    with open(path + ".tmp", "w") as h:
        json.dump(spec, h, ensure_ascii=False, sort_keys=True, default=str)
    os.replace(path + ".tmp", path)
    print(spec["dataset"], len(spec["rows"]), "rows", os.path.getsize(path) // 1024, "KB", flush=True)
    return path
