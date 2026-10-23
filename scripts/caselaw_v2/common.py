"""Case law v2 (courts below the Supreme Court, beyond the federal appellate and state highest-court tiers): shared
constants, court levels, paths, deterministic gzip members, JSON/checkpoint helpers and a disk guard.

The v2 pipeline reuses the stage-1 machinery of scripts/enrichment/caselaw (read only, imported, never modified):
  * extract_text.Scanner / split_fields / COLUMNS / FIELD_PRIORITY / segment_reader: the opinions CSV record scanner
    over parallel bzip2 segments (PostgreSQL COPY csv with ESCAPE '\\');
  * html_text.render_field / paginate: the deterministic plain-text rendering of CourtListener's markup;
  * store.Storage: upload with readback SHA-256 verification (the lead runs uploads; workers never write storage).

Tiers (caselaw.cases.tier): 1-3 are the existing stage-2 tiers; v2 adds 4-7, keyed on CourtListener's own court
`jurisdiction` code (courts table of the same bulk snapshot), never on names:
  4  state intermediate appellate courts            SA
  5  federal district courts                        FD
  6  other federal courts                           FS (special: Tax Court, Federal Claims, CIT, CAVC ...),
                                                    FB (bankruptcy), FBP (bankruptcy appellate panels),
                                                    MA (military appellate)
  7  other state, territorial and tribal courts     ST, SS (state trial / special), TS, TA, TT, TSP (territorial),
                                                    TRS, TRA, TRT, TRX (tribal)
Never loaded: SAG (state attorney general opinions are not court decisions), C (committees), I (international),
T (CourtListener's testing courts), and any code not listed here (reported, not guessed).
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import os
import shutil
import sys
import time
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
STAGE1_DIR = os.path.join(ROOT, "scripts", "enrichment", "caselaw")
CL_DIR = os.path.join(ROOT, "scripts", "enrichment", "courtlistener")
PYLIB = os.path.join(ROOT, "private", "scratch", "pylib")
for p in (HERE, STAGE1_DIR, CL_DIR, PYLIB):
    if p not in sys.path:
        sys.path.insert(0, p)

SNAPSHOT = "2026-09-30"
BULK = "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/"
FILES = {
    "courts": f"courts-{SNAPSHOT}.csv.bz2",
    "courthouses": f"courthouses-{SNAPSHOT}.csv.bz2",
    "clusters": f"opinion-clusters-{SNAPSHOT}.csv.bz2",
    "citations": f"citations-{SNAPSHOT}.csv.bz2",
    "opinions": f"opinions-{SNAPSHOT}.csv.bz2",
    "panel": f"search_opinioncluster_panel-{SNAPSHOT}.csv.bz2",
    "people": f"people-db-people-{SNAPSHOT}.csv.bz2",
}
# sizes of the pinned snapshot files (bytes, from the bulk-data bucket listing); a HEAD request re-checks them per run
FILE_BYTES = {
    "courts": 81_226,
    "courthouses": 17_268,
    "clusters": 2_468_000_000,  # approximate in the listing; clusters.py reads the exact size with HEAD
    "citations": 127_468_518,
    "opinions": 55_252_643_429,
}
OPINIONS_ETAG = '"7c4caf053f805946e812728f507fd002-6587"'

READ_FORMAT = "caselaw-read/1"  # the reading record the app parses (src/lib/external/caselaw.ts parseReadingRecord)
BUILDER = "caselaw-v2/1"
READ_PREFIX = f"caselaw/read/{SNAPSHOT}"  # same prefix as stage 2: the app's READ_KEY pattern and caselaw.objects check
API_URL = "https://www.courtlistener.com/api/rest/v4/opinions/{}/"
CLUSTER_URL = "https://www.courtlistener.com/opinion/{}/"

LEVEL_TIER = {
    "SA": 4,
    "FD": 5,
    "FS": 6, "FB": 6, "FBP": 6, "MA": 6, "MT": 6,
    "ST": 7, "SS": 7, "TS": 7, "TA": 7, "TT": 7, "TSP": 7, "TRS": 7, "TRA": 7, "TRT": 7, "TRX": 7,
}
EXISTING_LEVELS = {"F": (1, 2), "S": (3,)}  # loaded by stage 2 (scotus is tier 1 inside F)
EXCLUDED_LEVELS = {"SAG": "state attorney general opinions are not court decisions", "C": "committee", "I": "international",
                   "T": "CourtListener testing court"}
# Executive-branch legal opinions CourtListener files under "federal special" or similar codes: not court decisions.
# An explicit id list (a reviewed decision recorded in the handoff), never a name match.
EXCLUDED_COURTS = {
    "ag": "opinions of the U.S. Attorneys General (executive legal opinions)",
    "olc": "Department of Justice Office of Legal Counsel opinions (executive legal opinions)",
    "padeptjust": "Pennsylvania Department of Justice opinions (executive legal opinions)",
    "philadeptjust": "Philadelphia Department of Justice opinions (executive legal opinions)",
    "deptinterior": "Department of the Interior decisions filed as opinions (executive)",
    "uslandoffice": "U.S. Land Office (executive)",
    "ussurveyor": "U.S. Surveyor (executive)",
}
SYSTEM_OF_LEVEL = {"F": "federal", "FD": "federal", "FB": "federal", "FBP": "federal", "FS": "federal", "MA": "federal",
                   "MT": "federal", "S": "state", "SA": "state", "ST": "state", "SS": "state", "SAG": "state",
                   "TS": "territorial", "TA": "territorial", "TT": "territorial", "TSP": "territorial",
                   "TRS": "tribal", "TRA": "tribal", "TRT": "tribal", "TRX": "tribal"}
# levels whose courthouse state is the court's territorial jurisdiction (national courts seated in DC are not "DC")
STATE_SCOPED_LEVELS = {"S", "SA", "ST", "SS", "SAG", "FD", "FB", "FBP"}
TIER_LABEL = {1: "Supreme Court", 2: "Federal appellate", 3: "State highest court", 4: "State intermediate appellate",
              5: "Federal district", 6: "Other federal courts and tribunals", 7: "Other state, territorial and tribal courts"}
GROUPS = {  # court groups the runbook loads one at a time
    "sa": [4], "fd": [5], "fed_other": [6], "state_other": [7], "all": [4, 5, 6, 7],
}

WORK = os.path.join(ROOT, "private", "build", "w1025_caselaw")
ACQ = os.path.join(ROOT, "private", "acq", "w1025_caselaw")
DOCKET_DB = os.path.join(ROOT, "private", "acq", "courtlistener", "db", "docket.duckdb")
STAGE1_CHECKPOINT = os.path.join(ROOT, "private", "build", "caselaw", "work", "checkpoint.json")

OBJECT_TARGET = 24_000_000  # compressed bytes per reading object (same bound as stage 2)
GZIP_LEVEL = 6
UA = "LegalSourceAtlas research contact@legal-source-atlas.example"


class V2Error(RuntimeError):
    pass


# ---------------------------------------------------------------------------------------------- bytes
def gzip_member(data: bytes, level: int = GZIP_LEVEL) -> bytes:
    """Deterministic gzip member (mtime 0, no name): the same input gives the same bytes."""
    c = zlib.compressobj(level, zlib.DEFLATED, 31)
    return c.compress(data) + c.flush()


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_text(t: str) -> str:
    return hashlib.sha256(t.encode("utf-8")).hexdigest()


def sha256_file(path: str) -> tuple[str, int]:
    h = hashlib.sha256()
    n = 0
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
            n += len(block)
    return h.hexdigest(), n


def iter_gzip_members(data: bytes):
    """(offset, length, decompressed bytes) of each gzip member of a concatenation."""
    pos, n = 0, len(data)
    while pos < n:
        d = zlib.decompressobj(31)
        out = d.decompress(data[pos:]) + d.flush()
        used = n - pos - len(d.unused_data)
        if used <= 0:
            raise V2Error("empty gzip member")
        yield pos, used, out
        pos += used


# ---------------------------------------------------------------------------------------------- files
def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def write_json(path: str, obj) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as h:
        json.dump(obj, h, indent=1, ensure_ascii=False, default=str)
        h.write("\n")
    os.replace(tmp, path)


def read_json(path: str, default=None):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as h:
        return json.load(h)


def append_jsonl(path: str, obj) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as h:
        h.write(json.dumps(obj, ensure_ascii=False, separators=(",", ":"), default=str) + "\n")


def read_jsonl(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    out = []
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as h:
        for line in h.read().split("\n"):  # "\n" only: U+2028 and friends stay inside JSON strings
            if line:
                out.append(json.loads(line))
    return out


def jsonl_gz_bytes(rows) -> bytes:
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=6, mtime=0) as g:
        for r in rows:
            g.write((json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
    return buf.getvalue()


def dir_bytes(path: str) -> int:
    total = 0
    for dp, _, fs in os.walk(path):
        for f in fs:
            try:
                total += os.path.getsize(os.path.join(dp, f))
            except OSError:
                pass
    return total


class DiskGuard:
    """Stops (raises) before the work folder grows past `budget` bytes or free disk falls below `min_free`."""

    def __init__(self, root: str, budget: int, min_free: int = 600_000_000):
        self.root, self.budget, self.min_free = root, budget, min_free

    def check(self, what: str = "") -> None:
        used = dir_bytes(self.root)
        free = shutil.disk_usage(self.root).free
        if used > self.budget:
            raise V2Error(f"work folder holds {used / 1e6:,.0f} MB, over the {self.budget / 1e6:,.0f} MB budget {what}".strip())
        if free < self.min_free:
            raise V2Error(f"only {free / 1e9:.2f} GB free on the disk {what}".strip())


# ---------------------------------------------------------------------------------------------- courts
def tier_of_level(level: str | None, court_id: str | None = None) -> int | None:
    """Tier for a CourtListener jurisdiction code (None for the existing tiers 1-3 and for excluded/unknown codes)."""
    if court_id == "scotus" or level in EXISTING_LEVELS or court_id in EXCLUDED_COURTS:
        return None
    return LEVEL_TIER.get(level or "")


def tiers_for(groups: str) -> list[int]:
    out: list[int] = []
    for g in groups.split(","):
        g = g.strip()
        if g not in GROUPS:
            raise V2Error(f"unknown court group {g!r} (one of {', '.join(sorted(GROUPS))})")
        out += [t for t in GROUPS[g] if t not in out]
    return sorted(out)


def object_key(tier: int, unit: int, seq: int, sha: str, tag: str = "") -> str:
    """caselaw/read/2026-09-30/t4/v2/u07/t4-u07-0003-<sha12>.jsonl.gz (content addressed)."""
    t = f"t{tier}"
    u = f"u{unit:02d}"
    return f"{READ_PREFIX}/{t}/v2{tag}/{u}/{t}-{u}-{seq:04d}-{sha[:12]}.jsonl.gz"
