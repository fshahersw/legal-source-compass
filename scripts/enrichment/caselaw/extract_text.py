"""Case-law stage 1: full text of the selected CourtListener opinions -> gzip JSON Lines shards in private storage.

README
======
Pipeline (no database tables, search, UI or publishing in this stage):

    cd scripts/enrichment/caselaw
    python3 -I -B select_tiers.py                 # selection.parquet + selection_report.json (local DuckDB copies)
    python3 -I -B extract_text.py run [--limit-mb N] [--procs 3] [--workers 4]
    python3 -I -B extract_text.py status          # checkpoint, units, manifest summary
    python3 -I -B extract_text.py report          # per-tier counts, sizes, gzip ratio, throughput -> work/extract_report.json
    python3 -I -B spot_check.py [--sample 20]     # re-verify every stored shard + compare a sample with the API
    python3 -B -m unittest -v test_caselaw        # offline tests

Storage credentials (EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY) are taken from the environment or, when unset, read
from private/scratch/env.sh into the process by store.load_env_file(); the API key for spot_check.py comes from
private/scratch/secrets.env (COURTLISTENER_API_KEY). Nothing secret is printed or written.

Input: https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/opinions-2026-09-30.csv.bz2
(55,252,643,429 bytes, one bzip2 stream). It is never stored: HTTP ranges -> parallel bzip2 block decoding
(../courtlistener/pbz2.py) -> a regex CSV record scanner (PostgreSQL COPY csv, ESCAPE '\\': every non-NULL value is
quoted, quotes inside values are \\", backslashes \\\\) -> worker processes -> shard files -> storage.

Selection: only opinion ids in work/selection.parquet (tiers t1 scotus, t2 federal appellate, t3 state highest
courts). Blocked opinions (cluster or docket blocked) are extracted and carry blocked=true; later stages must not show
or index them.

Per opinion (one JSON object per line, UTF-8, keys in this order):
  opinion_id, cluster_id, docket_id, court_id, tier, date_filed, precedential_status, blocked, cluster_blocked,
  docket_blocked                                     <- selection (cluster/docket tables of the same snapshot)
  type, author_id, author_str, per_curiam, joined_by_str, page_count, extracted_by_ocr, download_url,
  date_created, date_modified, sha1                  <- the opinion's own CSV row
  fields_present     non-empty text fields, in priority order
  source_field       first non-empty of html_with_citations, html_columbia, html_lawbox, xml_harvard, html_anon_2020,
                     html, plain_text (CourtListener's order); null when every field is empty
  raw                that field unchanged; raw_sha256 / raw_bytes over its UTF-8 bytes
  text               deterministic plain-text rendering (html_text.py, RENDERER); plain_text is kept verbatim
  text_sha256, text_chars, renderer
  citations          html_with_citations citation links: [{opinion_id (cited, from data-id), cluster_id (from the
                     /opinion/<cluster>/ link), start, end}] as code-point offsets into text
  pages_source, pages, text_paginated    reporter page breaks from xml_harvard (html_text.paginate): offsets into
                     text, or into text_paginated (xml_harvard's own rendering) when they cannot be aligned exactly
  source_url         https://www.courtlistener.com/api/rest/v4/opinions/<id>/
  snapshot           2026-09-30

Shards: work units are fixed runs of UNIT_SEGMENTS compressed segments of SEGMENT_MB (unit u = segments
[u*K, (u+1)*K)); a record belongs to the unit of the segment in which it starts. Inside a unit, records are grouped by
shard group (tier/court, or tier/court/decade for the courts listed in selection_report.json) in input order, and a
group's file rolls over to a new part before it would exceed SHARD_MAX bytes. Shard object key:
  caselaw/courtlistener/2026-09-30/<tier>/<court>/<court>[-<decade>]-u<unit>-p<part>.jsonl.gz
Each shard is a concatenation of gzip members (each member = one worker batch of one group; any gzip reader reads
them as one stream). Content is deterministic for a given input, selection and EXTRACTOR version (fixed batching
thresholds that reset at every unit, gzip mtime 0), so a rerun of a unit reproduces byte-identical shards.

Why units: the CSV interleaves all courts (each 1/64 of the file holds 70-150 of the selected courts), so a shard per
court would have to stay open for the whole run (about 25 GB compressed) while the shared disk has a few GB to spare.
Per-unit shards keep at most about two units of output on local disk.

Storage and resume:
  * each closed shard is uploaded by a background thread (store.py: upload, whole-object readback, SHA-256 compare),
    then deleted locally; work/shards.jsonl gets one line per verified shard (path, tier, court, group, unit, part,
    opinions, id range, bytes, sha256, uploaded_at, readback_ok, state, extractor, partial_unit);
  * work/checkpoint.json records, per unit, its exact start (segment index + byte offset of its first record inside
    that segment's decompressed output, measured while scanning) and its status. A unit is "complete" once all its
    shards are verified; units complete in order. A restart begins at the first unit that is not complete for the
    current EXTRACTOR version, at its recorded start, and reproduces the same shard names and bytes: identical objects
    are left as they are ("already_present"), objects this pipeline wrote earlier with other bytes (a --limit trial's
    partial unit, an older extractor version) are replaced, anything else is refused. No opinion is in two shards
    of the current version.
  * --limit-mb N reads only the first N MB of the compressed file (pbz2's limit); the unit cut by the limit is
    recorded as "partial" and its shards as partial_unit=true, so the full run redoes that unit and replaces them.

Commands for the full run (after review):
  cd scripts/enrichment/caselaw
  nohup python3 -I -B extract_text.py run --procs 3 --workers 4 >> ../../../private/build/caselaw/work/run.log 2>&1 &
  (the same command resumes after any stop, starting at the first unit that is not complete; `extract_text.py status`
  shows where it is; `report` and `spot_check.py` afterwards)
"""
from __future__ import annotations

import argparse
import collections
import concurrent.futures as cf
import hashlib
import json
import multiprocessing as mp
import os
import re
import shutil
import sys
import threading
import time
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "courtlistener"))
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import html_text  # noqa: E402

SNAPSHOT = "2026-09-30"
FILE = f"opinions-{SNAPSHOT}.csv.bz2"
URL = "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/" + FILE
INPUT_BYTES = 55_252_643_429
INPUT_ETAG = '"7c4caf053f805946e812728f507fd002-6587"'
SEGMENT_MB = 48
UNIT_SEGMENTS = 60
SHARD_MAX = 200_000_000
BATCH_BYTES = 8_000_000  # record bytes per worker task for one group
MAX_PENDING = 384_000_000  # record bytes waiting in the main process across groups -> flush every group
MAX_RECORD = 1_500_000_000
GZIP_LEVEL = 6
EXTRACTOR = "caselaw-extract/2"  # 2: star-pagination spans and page-label links count as xml_harvard page markers
VERSION = EXTRACTOR + "+" + html_text.RENDERER
KEY_PREFIX = f"caselaw/courtlistener/{SNAPSHOT}"
API_URL = "https://www.courtlistener.com/api/rest/v4/opinions/{}/"

WORK = os.path.join(ROOT, "private", "build", "caselaw", "work")
SHARDS = os.path.join(ROOT, "private", "build", "caselaw", "shards")
SELECTION = os.path.join(WORK, "selection.parquet")
CHECKPOINT = os.path.join(WORK, "checkpoint.json")
MANIFEST = os.path.join(WORK, "shards.jsonl")
UNITS_DIR = os.path.join(WORK, "units")
RUNS = os.path.join(WORK, "runs.jsonl")

COLUMNS = ["id", "date_created", "date_modified", "author_str", "per_curiam", "joined_by_str", "type", "sha1", "page_count",
           "download_url", "local_path", "plain_text", "html", "html_lawbox", "html_columbia", "html_anon_2020", "xml_harvard",
           "xml_scan", "html_with_citations", "extracted_by_ocr", "author_id", "cluster_id"]
HEADER = (",".join(COLUMNS) + "\n").encode()
FIELD_PRIORITY = ["html_with_citations", "html_columbia", "html_lawbox", "xml_harvard", "html_anon_2020", "html", "plain_text"]
COL = {c: i for i, c in enumerate(COLUMNS)}

_FIELD = rb'(?>"(?:[^"\\]++|\\.)*+"|[^,"\n]*+)'
REC = re.compile(_FIELD + rb"(?:," + _FIELD + rb"){%d}\n" % (len(COLUMNS) - 1), re.S)
FLD = re.compile(rb'(?:^|(?<=,))(?>"((?:[^"\\]++|\\.)*+)"|([^,"\n]*+))(?=,|\n)', re.S)
UNESC = re.compile(rb"\\(.)", re.S)


class PipelineError(RuntimeError):
    pass


# ==================================================================================================== CSV records
def split_fields(rec: bytes) -> list[bytes | None]:
    """Values of one CSV record (bytes ending in a newline): None for NULL (unquoted empty), unescaped bytes otherwise."""
    vals: list[bytes | None] = []
    for m in FLD.finditer(rec):
        q = m.group(1)
        if q is not None:
            vals.append(UNESC.sub(rb"\1", q) if b"\\" in q else q)
        else:
            u = m.group(2)
            vals.append(u if u else None)
    return vals


def record_id(rec: bytes) -> int:
    if rec[:1] == b'"':
        return int(rec[1:rec.index(b'"', 1)])
    return int(rec[:rec.index(b",")])


class Scanner:
    """Splits the decompressed stream into CSV records and gives each record's start as (segment, offset).

    `pieces` yields (segment index, bytes) and (segment index, None) when a segment's output ends. `skip` bytes of the
    first segment's output are dropped first (the recorded start of a unit). With header=True the stream must begin with
    the CSV header line, which is checked and consumed.
    """

    def __init__(self, pieces, first_segment: int, skip: int = 0, header: bool = False):
        self.pieces = iter(pieces)
        self.seg = first_segment
        self.seg_off = 0
        self.skip = skip
        self.header = header
        self.buf = bytearray()
        self.marks: list[tuple[int, int, int]] = []  # (buffer position, segment, offset of that position in the segment)
        self.eof = False
        self.decompressed = 0
        self.trailing = b""

    def _fill(self, want: int) -> None:
        got = 0
        while got < want and not self.eof:
            try:
                seg, data = next(self.pieces)
            except StopIteration:
                self.eof = True
                return
            if data is None:
                self.seg = seg + 1
                self.seg_off = 0
                continue
            if seg != self.seg:
                self.seg, self.seg_off = seg, 0
            self.decompressed += len(data)
            if self.skip:
                cut = min(self.skip, len(data))
                self.skip -= cut
                self.seg_off += cut
                data = data[cut:]
                if not data:
                    continue
            self.marks.append((len(self.buf), seg, self.seg_off))
            self.buf += data
            self.seg_off += len(data)
            got += len(data)

    def _locate(self, pos: int) -> tuple[int, int]:
        marks = self.marks
        lo, hi = 0, len(marks) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if marks[mid][0] <= pos:
                lo = mid
            else:
                hi = mid - 1
        bpos, seg, off = marks[lo]
        return seg, off + (pos - bpos)

    def _compact(self, p: int) -> None:
        if p == 0:
            return
        keep = [m for m in self.marks if m[0] > p]
        first = None
        for m in self.marks:
            if m[0] <= p:
                first = m
        new = []
        if first is not None:
            new.append((0, first[1], first[2] + (p - first[0])))
        new.extend((m[0] - p, m[1], m[2]) for m in keep)
        self.marks = new
        del self.buf[:p]

    def records(self):
        p = 0
        if self.header:
            while len(self.buf) < len(HEADER) and not self.eof:
                self._fill(1 << 20)
            if bytes(self.buf[: len(HEADER)]) != HEADER:
                raise PipelineError("the CSV header differs from the expected opinions columns")
            p = len(HEADER)
        want = 1 << 22
        while True:
            m = REC.match(self.buf, p) if p < len(self.buf) else None
            if m is None:
                if self.eof:
                    self.trailing = bytes(self.buf[p:])
                    return
                self._compact(p)
                p = 0
                if len(self.buf) > MAX_RECORD:
                    raise PipelineError(f"no record end within {MAX_RECORD} bytes at segment {self._locate(0)}")
                # a long partial record: read at least as much again before rescanning it
                self._fill(max(want, len(self.buf)))
                continue
            start = p
            p = m.end()
            seg, off = self._locate(start)
            yield seg, off, bytes(memoryview(self.buf)[start:p])


# ==================================================================================================== worker side
def _s(b: bytes | None) -> str | None:
    return None if b is None else b.decode("utf-8")


def _int(b: bytes | None) -> int | None:
    return None if b is None or b == b"" else int(b)


def build_record(rec: bytes, meta: tuple) -> tuple[dict, dict]:
    """One output row plus per-record facts for the statistics."""
    vals = split_fields(rec)
    if len(vals) != len(COLUMNS):
        raise PipelineError(f"record with {len(vals)} fields (expected {len(COLUMNS)}) near id {meta[0]}")
    oid, cluster_id, docket_id, court_id, tier, date_filed, prec, blocked, cblocked, dblocked = meta
    if int(vals[COL["id"]]) != oid:
        raise PipelineError(f"record id {vals[COL['id']]!r} is not the selected id {oid}")
    csv_cluster = _int(vals[COL["cluster_id"]])
    present = [f for f in FIELD_PRIORITY if vals[COL[f]]]
    src = present[0] if present else None
    raw_b = vals[COL[src]] if src else b""
    raw = raw_b.decode("utf-8")
    if src:
        rnd = html_text.render_field(src, raw)
        xml = vals[COL["xml_harvard"]]
        pg = html_text.paginate(src, rnd, xml.decode("utf-8") if xml else None)
    else:
        rnd = html_text.Rendered("", [], [], {})
        pg = {"pages_source": None, "pages": [], "text_paginated": None}
    text = rnd.text
    row = {
        "opinion_id": oid,
        "cluster_id": cluster_id,
        "docket_id": docket_id,
        "court_id": court_id,
        "tier": tier,
        "date_filed": date_filed,
        "precedential_status": prec,
        "blocked": blocked,
        "cluster_blocked": cblocked,
        "docket_blocked": dblocked,
        "type": _s(vals[COL["type"]]),
        "author_id": _int(vals[COL["author_id"]]),
        "author_str": _s(vals[COL["author_str"]]),
        "per_curiam": vals[COL["per_curiam"]] == b"t",
        "joined_by_str": _s(vals[COL["joined_by_str"]]),
        "page_count": _int(vals[COL["page_count"]]),
        "extracted_by_ocr": vals[COL["extracted_by_ocr"]] == b"t",
        "download_url": _s(vals[COL["download_url"]]),
        "date_created": _s(vals[COL["date_created"]]),
        "date_modified": _s(vals[COL["date_modified"]]),
        "sha1": _s(vals[COL["sha1"]]),
        "fields_present": present,
        "source_field": src,
        "raw_sha256": hashlib.sha256(raw_b).hexdigest(),
        "raw_bytes": len(raw_b),
        "raw": raw,
        "renderer": None if src is None else "verbatim" if src == "plain_text" else html_text.RENDERER,
        "text": text,
        "text_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "text_chars": len(text),
        "citations": rnd.citations,
        "pages_source": pg["pages_source"],
        "pages": pg["pages"],
        "text_paginated": pg["text_paginated"],
        "source_url": API_URL.format(oid),
        "snapshot": SNAPSHOT,
    }
    if csv_cluster != cluster_id:
        row["csv_cluster_id"] = csv_cluster
    facts = {
        "tier": tier,
        "src": src or "none",
        "raw_bytes": len(raw_b),
        "text_chars": len(text),
        "empty_text": bool(src) and not text,
        "blocked": blocked,
        "pages_source": pg["pages_source"] or "no_xml_harvard",
        "citations": len(rnd.citations),
        "cluster_mismatch": csv_cluster != cluster_id,
        "unknown_tags": rnd.stats.get("unknown_tags") or {},
        "no_link_citations": rnd.stats.get("no_link_citations", 0),
        "stray_lt": rnd.stats.get("stray_lt", 0),
        "skipped_script_style": rnd.stats.get("skipped_script_style", 0),
        "img": rnd.stats.get("img", 0),
    }
    return row, facts


def new_stats() -> dict:
    return {"opinions": 0, "by_tier": collections.Counter(), "by_source_field": collections.Counter(), "raw_bytes": 0, "text_chars": 0,
            "json_bytes": 0, "gzip_bytes": 0, "no_text": 0, "empty_text": 0, "blocked": 0, "pages_source": collections.Counter(),
            "citations": 0, "no_link_citations": 0, "cluster_mismatch": 0, "unknown_tags": collections.Counter(), "stray_lt": 0,
            "skipped_script_style": 0, "img": 0, "raw_bytes_by_tier": collections.Counter(), "text_chars_by_tier": collections.Counter()}


def add_facts(st: dict, f: dict) -> None:
    st["opinions"] += 1
    st["by_tier"][f["tier"]] += 1
    st["by_source_field"][f["src"]] += 1
    st["raw_bytes"] += f["raw_bytes"]
    st["text_chars"] += f["text_chars"]
    st["raw_bytes_by_tier"][f["tier"]] += f["raw_bytes"]
    st["text_chars_by_tier"][f["tier"]] += f["text_chars"]
    st["no_text"] += f["src"] == "none"
    st["empty_text"] += f["empty_text"]
    st["blocked"] += f["blocked"]
    st["pages_source"][f["pages_source"]] += 1
    st["citations"] += f["citations"]
    st["no_link_citations"] += f["no_link_citations"]
    st["cluster_mismatch"] += f["cluster_mismatch"]
    st["stray_lt"] += f["stray_lt"]
    st["skipped_script_style"] += f["skipped_script_style"]
    st["img"] += f["img"]
    for k, v in f["unknown_tags"].items():
        st["unknown_tags"][k] += v


def merge_stats(a: dict, b: dict) -> None:
    for k, v in b.items():
        if isinstance(v, collections.Counter):
            a[k].update(v)
        else:
            a[k] += v


def gzip_member(data: bytes, level: int = GZIP_LEVEL) -> bytes:
    c = zlib.compressobj(level, zlib.DEFLATED, 31)  # gzip wrapper, mtime 0, no name: deterministic bytes
    return c.compress(data) + c.flush()


def work_batch(task: tuple) -> tuple:
    """Worker process: render one group's batch and return it as one gzip member plus its statistics."""
    group, items = task
    lines = []
    st = new_stats()
    lo = hi = None
    for rec, meta in items:
        row, facts = build_record(rec, meta)
        lines.append(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
        add_facts(st, facts)
        oid = meta[0]
        lo = oid if lo is None or oid < lo else lo
        hi = oid if hi is None or oid > hi else hi
    data = ("\n".join(lines) + "\n").encode("utf-8")
    member = gzip_member(data)
    st["json_bytes"] = len(data)
    st["gzip_bytes"] = len(member)
    return group, member, len(items), lo, hi, st


# ==================================================================================================== selection
class Selection:
    def __init__(self, path: str = SELECTION):
        import duckdb
        import numpy as np

        con = duckdb.connect()
        rel = f"read_parquet('{path}')"
        cols = con.execute(
            f"""SELECT opinion_id, cluster_id, docket_id, coalesce(author_id, -1) AS author_id,
                       court_id, tier, coalesce(year(date_filed) * 10000 + month(date_filed) * 100 + day(date_filed), 0) AS d,
                       coalesce(precedential_status, '') AS prec, blocked, cluster_blocked, docket_blocked, shard_group
                FROM {rel} ORDER BY opinion_id"""
        ).fetchnumpy()
        con.close()
        self.n = len(cols["opinion_id"])
        self.opinion_id = np.asarray(cols["opinion_id"], dtype=np.int64)
        self.cluster_id = np.asarray(cols["cluster_id"], dtype=np.int64)
        self.docket_id = np.asarray(cols["docket_id"], dtype=np.int64)
        self.date = np.asarray(cols["d"], dtype=np.int32)
        self.flags = (np.asarray(cols["blocked"], dtype=np.int8) | (np.asarray(cols["cluster_blocked"], dtype=np.int8) << 1)
                      | (np.asarray(cols["docket_blocked"], dtype=np.int8) << 2))

        def codes(arr):
            values, inv = np.unique(np.asarray(arr, dtype=object).astype(str), return_inverse=True)
            return [str(v) for v in values], inv.astype(np.int32)

        self.courts, self.court_code = codes(cols["court_id"])
        self.tiers, self.tier_code = codes(cols["tier"])
        self.precs, self.prec_code = codes(cols["prec"])
        self.groups, self.group_code = codes(cols["shard_group"])
        del cols
        self.dense = np.full(int(self.opinion_id.max()) + 1, -1, dtype=np.int32)
        self.dense[self.opinion_id] = np.arange(self.n, dtype=np.int32)

    def row_of(self, oid: int) -> int:
        return int(self.dense[oid]) if 0 <= oid < len(self.dense) else -1

    def meta(self, row: int) -> tuple:
        d = int(self.date[row])
        f = int(self.flags[row])
        prec = self.precs[self.prec_code[row]]
        return (int(self.opinion_id[row]), int(self.cluster_id[row]), int(self.docket_id[row]), self.courts[self.court_code[row]],
                self.tiers[self.tier_code[row]], f"{d // 10000:04d}-{d // 100 % 100:02d}-{d % 100:02d}" if d else None,
                prec or None, bool(f & 1), bool(f & 2), bool(f & 4))


def group_parts(group: str) -> tuple[str, str, str | None]:
    parts = group.split("/")
    return parts[0], parts[1], parts[2] if len(parts) > 2 else None


def shard_relpath(group: str, unit: int, part: int) -> str:
    tier, court, decade = group_parts(group)
    stem = court + (f"-{decade}" if decade else "")
    return f"{tier}/{court}/{stem}-u{unit:03d}-p{part:02d}.jsonl.gz"


# ==================================================================================================== state files
def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def write_json(path: str, obj) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w") as h:
        json.dump(obj, h, indent=1, sort_keys=True, default=lambda o: dict(o) if isinstance(o, collections.Counter) else str(o))
    os.replace(tmp, path)


def append_jsonl(path: str, obj) -> None:
    with open(path, "a") as h:
        h.write(json.dumps(obj, sort_keys=True) + "\n")
        h.flush()
        os.fsync(h.fileno())


def input_identity() -> dict:
    """The input file and unit layout a checkpoint belongs to (module settings read at call time)."""
    seg = SEGMENT_MB * 1_000_000
    segments = -(-INPUT_BYTES // seg)
    return {"url": URL, "bytes": INPUT_BYTES, "etag": INPUT_ETAG, "segment_mb": SEGMENT_MB, "unit_segments": UNIT_SEGMENTS, "segments": segments,
            "units": -(-segments // UNIT_SEGMENTS)}


def load_checkpoint(path: str | None = None, identity: dict | None = None) -> dict:
    path = path or CHECKPOINT
    identity = identity or input_identity()
    if os.path.exists(path):
        with open(path) as h:
            ck = json.load(h)
        if ck["input"] != identity:
            raise PipelineError("checkpoint.json was written for a different input file or unit layout; refusing to mix them")
        return ck
    return {"input": identity, "boundaries": {"0": {"segment": 0, "offset": 0, "header": True}}, "units": {}, "updated_at": now()}


def first_open_unit(ck: dict, version: str | None = None) -> int | None:
    version = version or VERSION
    for u in range(ck["input"]["units"]):
        st = ck["units"].get(str(u))
        if not (st and st["status"] == "complete" and st["extractor"] == version):
            return u
    return None


def manifest_keys(path: str | None = None) -> dict[str, list[dict]]:
    path = path or MANIFEST
    out: dict[str, list[dict]] = collections.defaultdict(list)
    if os.path.exists(path):
        with open(path) as h:
            for line in h:
                if line.strip():
                    e = json.loads(line)
                    out[e["path"]].append(e)
    return out


# ==================================================================================================== shard files
class ShardFile:
    def __init__(self, group: str, unit: int, part: int, root: str | None = None):
        self.group, self.unit, self.part = group, unit, part
        self.rel = shard_relpath(group, unit, part)
        self.path = os.path.join(root or SHARDS, self.rel)
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        self.h = open(self.path, "wb")
        self.sha = hashlib.sha256()
        self.bytes = 0
        self.json_bytes = 0
        self.opinions = 0
        self.members = 0
        self.lo: int | None = None
        self.hi: int | None = None
        self.stats = new_stats()

    def add(self, member: bytes, n: int, lo: int, hi: int, st: dict) -> None:
        self.h.write(member)
        self.sha.update(member)
        self.bytes += len(member)
        self.json_bytes += st["json_bytes"]
        self.opinions += n
        self.members += 1
        self.lo = lo if self.lo is None or lo < self.lo else self.lo
        self.hi = hi if self.hi is None or hi > self.hi else self.hi
        merge_stats(self.stats, st)

    def close(self) -> dict:
        self.h.close()
        tier, court, decade = group_parts(self.group)
        return {"path": f"{KEY_PREFIX}/{self.rel}", "local": self.path, "tier": tier, "court": court, "decade": decade, "group": self.group,
                "unit": self.unit, "part": self.part, "opinions": self.opinions, "min_opinion_id": self.lo, "max_opinion_id": self.hi,
                "bytes": self.bytes, "sha256": self.sha.hexdigest(), "uncompressed_bytes": self.json_bytes, "gzip_members": self.members,
                "blocked": self.stats["blocked"], "source_fields": dict(self.stats["by_source_field"])}


# ==================================================================================================== segment reader
def segment_reader(first_segment: int, limit: int | None, workers: int, stats):
    import pbz2

    class SegmentReader(pbz2.ParallelBz2Reader):
        """ParallelBz2Reader that starts at a given segment and reports segment boundaries."""

        def __init__(self, *a, **kw):
            self._hold = True
            super().__init__(*a, **kw)
            self.segments = self.segments[first_segment:]
            self._hold = False
            self._launch_more()

        def _launch_more(self) -> None:
            if getattr(self, "_hold", False):
                return
            super()._launch_more()

        def pieces(self):
            while self._current < len(self.segments):
                seg = self.segments[self._current]
                item = seg.q.get()
                if item is None:
                    if seg.error:
                        raise PipelineError(f"bz2 segment {seg.idx} failed: {seg.error!r}") from seg.error
                    self._current += 1
                    self._launch_more()
                    yield seg.idx, None
                    continue
                yield seg.idx, item

    return SegmentReader(URL, INPUT_BYTES, workers=workers, segment_mb=SEGMENT_MB, limit=limit, stats=stats)


# ==================================================================================================== the run
class Run:
    def __init__(self, args):
        self.args = args
        self.limit = args.limit_mb * 1_000_000 if args.limit_mb else None
        self.run_id = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        os.makedirs(WORK, exist_ok=True)
        os.makedirs(SHARDS, exist_ok=True)
        os.makedirs(UNITS_DIR, exist_ok=True)
        self.ck = load_checkpoint()
        self.known = manifest_keys()
        self.lock = threading.Lock()
        self.uploads: dict[int, list[cf.Future]] = collections.defaultdict(list)
        self.finalized: dict[int, dict] = {}
        self.upload_errors: list[str] = []
        self.upload_bytes = 0
        self.upload_seconds = 0.0
        self.readback_seconds = 0.0
        self.uploaded = collections.Counter()

    # --------------------------------------------------------------------------------------------- uploads
    def may_replace(self, key: str):
        prior = self.known.get(key, [])

        def ok(existing_sha: str) -> bool:
            # only bytes this pipeline recorded for the key (e.g. a trial's partial unit, an older extractor version)
            return any(e.get("sha256") == existing_sha for e in prior)

        return ok

    def _upload(self, desc: dict) -> dict:
        receipt = self.store.put_verified(desc["path"], desc["local"], desc["sha256"], desc["bytes"], may_replace=self.may_replace(desc["path"]))
        os.remove(desc["local"])
        line = {k: v for k, v in desc.items() if k != "local"}
        line.update({"uploaded_at": receipt["verified_at"], "readback_ok": receipt["readback_ok"], "readback_sha256": receipt["readback_sha256"],
                     "state": receipt["state"], "replaced_sha256": receipt["replaced_sha256"], "bucket": receipt["bucket"],
                     "upload_seconds": receipt["upload_seconds"], "readback_seconds": receipt["readback_seconds"],
                     "extractor": VERSION, "run_id": self.run_id, "snapshot": SNAPSHOT, "source_file": URL})
        with self.lock:
            append_jsonl(MANIFEST, line)
            self.known[line["path"]].append(line)
            self.upload_bytes += desc["bytes"]
            self.upload_seconds += receipt["upload_seconds"]
            self.readback_seconds += receipt["readback_seconds"]
            self.uploaded[receipt["state"]] += 1
        return line

    def submit_upload(self, desc: dict, unit: int) -> None:
        if self.args.no_upload:
            return
        self.uploads[unit].append(self.pool_up.submit(self._upload, desc))

    def pending_uploads(self) -> int:
        return sum(1 for fs in self.uploads.values() for f in fs if not f.done())

    def poll_units(self, block: bool = False) -> None:
        """Mark finalized units complete, in order, once all their shards are verified in storage."""
        for u in sorted(self.finalized):
            fin = self.finalized[u]
            fs = self.uploads.get(u, [])
            if block:
                cf.wait(fs)
            if not all(f.done() for f in fs):
                return
            errs = [f.exception() for f in fs if f.exception() is not None]
            if errs:
                self.upload_errors.extend(f"unit {u}: {type(e).__name__}: {e}" for e in errs)
                raise PipelineError(f"{len(errs)} shard upload(s) of unit {u} failed; first: {errs[0]}")
            status = "partial" if fin["partial"] else "complete"
            if self.args.no_upload:
                status = "extracted_not_uploaded"
            self.ck["units"][str(u)] = {"status": status, "extractor": VERSION, "shards": fin["shards"], "opinions": fin["opinions"],
                                        "records": fin["records"], "finished_at": now(), "run_id": self.run_id,
                                        "limit_bytes": self.limit if fin["partial"] else None}
            self.ck["updated_at"] = now()
            write_json(CHECKPOINT, self.ck)
            del self.finalized[u]
            self.uploads.pop(u, None)

    # --------------------------------------------------------------------------------------------- disk guard
    def wait_for_disk(self) -> None:
        while True:
            free = shutil.disk_usage(WORK).free
            if free >= self.args.min_free_gb * 1e9:
                return
            if not any(not f.done() for fs in self.uploads.values() for f in fs):
                raise PipelineError(f"only {free / 1e9:.1f} GB free on the work disk and no upload pending; stopping")
            time.sleep(2)
            self.poll_units()

    # --------------------------------------------------------------------------------------------- main loop
    def run(self) -> dict:
        args = self.args
        # worker processes first, before any thread exists in this process
        ctx = mp.get_context("fork")
        self.pool = ctx.Pool(args.procs)
        self.pool_up = None
        summary = {"run_id": self.run_id, "started_at": now(), "limit_mb": args.limit_mb, "version": VERSION, "sessions": []}
        ok = False
        try:
            if not args.no_upload:
                import store

                self.store = store.Storage()
            self.pool_up = cf.ThreadPoolExecutor(max_workers=args.upload_threads)
            t0 = time.time()
            self.sel = Selection()
            print(f"[caselaw] selection: {self.sel.n:,} opinions in {len(self.sel.groups)} shard groups ({time.time() - t0:.0f}s)", flush=True)
            while True:
                # a unit whose uploads are still running must be settled before a session may restart it
                self.poll_units(block=True)
                u = first_open_unit(self.ck)
                if u is None:
                    print("[caselaw] every unit is complete for", VERSION, flush=True)
                    break
                b = self.ck["boundaries"].get(str(u))
                if b is None:
                    raise PipelineError(f"unit {u} is not complete and its start was never recorded")
                if self.limit is not None and b["segment"] * SEGMENT_MB * 1_000_000 >= self.limit:
                    print(f"[caselaw] unit {u} starts beyond --limit-mb; nothing more to do in this run", flush=True)
                    break
                sess = self.session(u, b)
                summary["sessions"].append(sess)
                if sess["end"] in ("limit", "eof"):
                    break
            self.poll_units(block=True)
            ok = True
        except BaseException as exc:
            summary["error"] = f"{type(exc).__name__}: {exc}"[:2000]
            raise
        finally:
            if ok:
                self.pool.close()
                self.pool.join()
            else:
                self.pool.terminate()
            if self.pool_up is not None:
                self.pool_up.shutdown(wait=True)
            summary.update(self._upload_summary())
            append_jsonl(RUNS, summary)
        print("[caselaw] run summary", json.dumps(summary, default=str), flush=True)
        return summary

    def _upload_summary(self) -> dict:
        return {"finished_at": now(), "uploads": dict(self.uploaded), "upload_bytes": self.upload_bytes,
                "upload_seconds": round(self.upload_seconds, 1), "readback_seconds": round(self.readback_seconds, 1),
                "upload_mb_s": round(self.upload_bytes / self.upload_seconds / 1e6, 2) if self.upload_seconds else None,
                "readback_mb_s": round(self.upload_bytes / self.readback_seconds / 1e6, 2) if self.readback_seconds else None}

    def session(self, start_unit: int, boundary: dict) -> dict:
        import cl_stream

        args = self.args
        K = self.ck["input"]["unit_segments"]
        # local shard files of units this session will (re)write are regenerated: drop leftovers of a stopped run
        self._clear_local_units(start_unit)
        stream_stats = cl_stream.StreamStats()
        reader = segment_reader(boundary["segment"], self.limit, args.workers, stream_stats)
        last_segment = len(reader.segments) and reader.segments[-1].idx
        cut_by_limit = reader.size < reader.full_size
        scanner = Scanner(reader.pieces(), boundary["segment"], boundary["offset"], header=bool(boundary.get("header")))
        t0 = time.time()
        sel = self.sel
        unit = None
        ustate = None
        records = 0
        selected = 0
        end = "eof"
        last_log = t0
        inflight: collections.deque = collections.deque()

        def collect_one():
            group, member, n, lo, hi, st = inflight.popleft().get()
            sf = ustate["open"].get(group)
            if sf is not None and sf.bytes and sf.bytes + len(member) > SHARD_MAX:
                desc = sf.close()
                desc["partial_unit"] = False  # a part closed by size holds the same records in every run of this unit
                ustate["closed"].append(desc)
                self.submit_upload(desc, ustate["unit"])
                sf = None
            if sf is None:
                part = ustate["parts"][group]
                ustate["parts"][group] += 1
                sf = ustate["open"][group] = ShardFile(sel.groups[group], ustate["unit"], part)
            sf.add(member, n, lo, hi, st)
            merge_stats(ustate["stats"], st)

        def dispatch(group):
            items = ustate["pending"].pop(group)
            ustate["pending_bytes"] -= ustate["pending_size"].pop(group)
            inflight.append(self.pool.apply_async(work_batch, ((group, items),)))
            while len(inflight) > 2 * args.procs:
                collect_one()

        def flush_all():
            for g in sorted(ustate["pending"]):
                dispatch(g)

        def finalize(partial: bool):
            flush_all()
            while inflight:
                collect_one()
            for g in sorted(ustate["open"]):
                desc = ustate["open"][g].close()
                # the last part of each group: its content is final only if the unit was read to its end
                desc["partial_unit"] = partial
                ustate["closed"].append(desc)
                self.submit_upload(desc, ustate["unit"])
            u = ustate["unit"]
            st = ustate["stats"]
            report = {"unit": u, "segments": [u * K, min((u + 1) * K, self.ck["input"]["segments"]) - 1], "start": self.ck["boundaries"][str(u)],
                      "partial": partial, "records": ustate["records"], "selected": ustate["selected"], "shards": len(ustate["closed"]),
                      "extractor": VERSION, "run_id": self.run_id, "seconds": round(time.time() - ustate["t0"], 1), "stats": st,
                      "shard_files": [{k: v for k, v in d.items() if k != "local"} for d in ustate["closed"]]}
            write_json(os.path.join(UNITS_DIR, f"u{u:04d}.json"), report)
            self.finalized[u] = {"partial": partial, "shards": len(ustate["closed"]), "opinions": st["opinions"], "records": ustate["records"]}
            if self.args.no_upload:
                self.poll_units()
            print(f"[caselaw] unit {u} {'PARTIAL' if partial else 'finalized'}: {ustate['records']:,} records, {st['opinions']:,} selected, "
                  f"{len(ustate['closed'])} shards, {st['gzip_bytes'] / 1e6:,.0f} MB gz, {time.time() - ustate['t0']:,.0f}s", flush=True)

        def new_unit_state(u):
            return {"unit": u, "t0": time.time(), "records": 0, "selected": 0, "pending": {}, "pending_size": {}, "pending_bytes": 0,
                    "open": {}, "closed": [], "parts": collections.Counter(), "stats": new_stats()}

        try:
            for seg, off, rec in scanner.records():
                u = seg // K
                if u != unit:
                    if unit is None and not boundary.get("header") and (seg, off) != (boundary["segment"], boundary["offset"]):
                        raise PipelineError(f"resumed at {boundary} but the first record starts at {seg}/{off}")
                    if unit is not None:
                        finalize(partial=False)
                        self.poll_units()
                    b = self.ck["boundaries"].get(str(u))
                    if b is None:
                        self.ck["boundaries"][str(u)] = {"segment": seg, "offset": off}
                        self.ck["updated_at"] = now()
                        write_json(CHECKPOINT, self.ck)
                    elif unit is not None and (b["segment"], b["offset"]) != (seg, off):
                        raise PipelineError(f"unit {u} starts at {seg}/{off} but the checkpoint recorded {b['segment']}/{b['offset']}")
                    done = self.ck["units"].get(str(u))
                    if done and done["status"] == "complete" and done["extractor"] == VERSION:
                        end = "next_unit_complete"
                        unit = None
                        ustate = None
                        break
                    unit = u
                    ustate = new_unit_state(u)
                    self.wait_for_disk()
                records += 1
                ustate["records"] += 1
                row = sel.row_of(record_id(rec))
                if row < 0:
                    continue
                selected += 1
                ustate["selected"] += 1
                group = int(sel.group_code[row])
                lst = ustate["pending"].get(group)
                if lst is None:
                    lst = ustate["pending"][group] = []
                    ustate["pending_size"][group] = 0
                lst.append((rec, sel.meta(row)))
                ustate["pending_size"][group] += len(rec)
                ustate["pending_bytes"] += len(rec)
                if ustate["pending_size"][group] >= BATCH_BYTES:
                    dispatch(group)
                if ustate["pending_bytes"] >= MAX_PENDING:
                    flush_all()
                    self.poll_units()
                    self.wait_for_disk()
                if time.time() - last_log > 60:
                    last_log = time.time()
                    dt = last_log - t0
                    print(f"[caselaw] unit {unit} seg {seg}: {records:,} records, {selected:,} selected, "
                          f"{stream_stats.compressed / 1e6:,.0f} MB compressed read ({stream_stats.compressed / dt / 1e6:.1f} MB/s), "
                          f"{scanner.decompressed / 1e9:,.1f} GB decompressed ({scanner.decompressed / dt / 1e6:.0f} MB/s), "
                          f"uploads pending {self.pending_uploads()}, done {dict(self.uploaded)}, "
                          f"free {shutil.disk_usage(WORK).free / 1e9:.1f} GB, {dt:,.0f}s", flush=True)
                    self.poll_units()
            else:
                if ustate is not None:
                    if cut_by_limit:
                        end = "limit"
                        finalize(partial=True)
                    else:
                        if scanner.trailing.strip():
                            raise PipelineError(f"{len(scanner.trailing)} bytes after the last complete record at the end of the file")
                        end = "eof"
                        finalize(partial=False)
        finally:
            reader.close()
        self.poll_units()
        dt = time.time() - t0
        sess = {"start_unit": start_unit, "start": boundary, "end": end, "records": records, "selected": selected,
                "compressed_bytes_read": stream_stats.compressed, "retries": stream_stats.retries, "decompressed_bytes": scanner.decompressed,
                "trailing_partial_record_bytes": len(scanner.trailing), "last_segment": last_segment, "seconds": round(dt, 1),
                "compressed_mb_s": round(stream_stats.compressed / dt / 1e6, 2) if dt else None,
                "decompressed_mb_s": round(scanner.decompressed / dt / 1e6, 1) if dt else None}
        print("[caselaw] session", json.dumps(sess, default=str), flush=True)
        return sess

    def _clear_local_units(self, first_unit: int) -> None:
        pat = re.compile(r"-u(\d{3})-p\d{2}\.jsonl\.gz$")
        for dirpath, _, files in os.walk(SHARDS):
            for f in files:
                m = pat.search(f)
                if m and int(m.group(1)) >= first_unit:
                    os.remove(os.path.join(dirpath, f))


# ==================================================================================================== status
def status() -> int:
    ck = load_checkpoint()
    man = manifest_keys()
    latest = {k: v[-1] for k, v in man.items()}
    by_state = collections.Counter(e["state"] for e in latest.values())
    out = {
        "input": ck["input"],
        "boundaries_recorded": len(ck["boundaries"]),
        "units": {u: {k: s[k] for k in ("status", "extractor", "shards", "opinions")} for u, s in sorted(ck["units"].items(), key=lambda x: int(x[0]))},
        "next_unit": first_open_unit(ck),
        "manifest_keys": len(latest),
        "manifest_states": dict(by_state),
        # objects whose newest manifest line is from another extractor version (a later run replaces or supersedes them)
        "keys_from_other_versions": sum(1 for e in latest.values() if e.get("extractor") != VERSION),
        "stored_bytes": sum(e["bytes"] for e in latest.values()),
        "stored_opinions": sum(e["opinions"] for e in latest.values()),
        "readback_failures": sum(1 for e in latest.values() if not e.get("readback_ok")),
        "local_shard_files": sum(len(f) for _, _, f in os.walk(SHARDS)),
        "free_gb": round(shutil.disk_usage(WORK).free / 1e9, 1),
    }
    print(json.dumps(out, indent=1))
    return 0


def report() -> int:
    """Aggregate the unit statistics of the current extractor version, the run log and the manifest into
    work/extract_report.json (counts per tier, raw vs text size, gzip ratio, throughput, upload speed, projections)."""
    ck = load_checkpoint()
    agg = new_stats()
    units = []
    for u, s in sorted(ck["units"].items(), key=lambda x: int(x[0])):
        p = os.path.join(UNITS_DIR, f"u{int(u):04d}.json")
        if s.get("extractor") != VERSION or not os.path.exists(p):
            continue
        with open(p) as h:
            ur = json.load(h)
        st = ur["stats"]
        for k, v in st.items():
            if isinstance(v, dict):
                agg[k].update(v)
            else:
                agg[k] += v
        units.append({"unit": int(u), "status": s["status"], "records": ur["records"], "selected": ur["selected"], "shards": ur["shards"],
                      "gzip_bytes": st["gzip_bytes"], "seconds": ur["seconds"]})
    runs = []
    if os.path.exists(RUNS):
        with open(RUNS) as h:
            runs = [json.loads(line) for line in h if line.strip()]
    sessions = [s for r in runs if r.get("version") == VERSION for s in r.get("sessions", [])]
    comp = sum(s["compressed_bytes_read"] for s in sessions)
    secs = sum(s["seconds"] for s in sessions)
    covered_mb = 0.0
    for s in sessions:
        start_mb = s["start"]["segment"] * SEGMENT_MB
        end_mb = (s.get("last_segment") or 0) * SEGMENT_MB + SEGMENT_MB
        covered_mb += max(0, end_mb - start_mb)
    up_b = sum(r.get("upload_bytes", 0) for r in runs if r.get("version") == VERSION)
    up_s = sum(r.get("upload_seconds", 0) for r in runs if r.get("version") == VERSION)
    rb_s = sum(r.get("readback_seconds", 0) for r in runs if r.get("version") == VERSION)
    man = {k: v[-1] for k, v in manifest_keys().items()}
    cur = [e for e in man.values() if e.get("extractor") == VERSION]
    out = {
        "extractor": VERSION, "units": units, "opinions": agg["opinions"], "by_tier": dict(agg["by_tier"]), "by_source_field": dict(agg["by_source_field"]),
        "raw_bytes": agg["raw_bytes"], "text_chars": agg["text_chars"], "json_bytes": agg["json_bytes"], "gzip_bytes": agg["gzip_bytes"],
        "raw_bytes_by_tier": dict(agg["raw_bytes_by_tier"]), "text_chars_by_tier": dict(agg["text_chars_by_tier"]),
        "gzip_over_json": round(agg["gzip_bytes"] / agg["json_bytes"], 4) if agg["json_bytes"] else None,
        "gzip_over_raw": round(agg["gzip_bytes"] / agg["raw_bytes"], 4) if agg["raw_bytes"] else None,
        "text_chars_over_raw_bytes": round(agg["text_chars"] / agg["raw_bytes"], 4) if agg["raw_bytes"] else None,
        "no_text": agg["no_text"], "empty_text": agg["empty_text"], "blocked": agg["blocked"], "pages_source": dict(agg["pages_source"]),
        "citations": agg["citations"], "no_link_citations": agg["no_link_citations"], "cluster_mismatch": agg["cluster_mismatch"],
        "unknown_tags": dict(agg["unknown_tags"]), "stray_lt": agg["stray_lt"], "skipped_script_style": agg["skipped_script_style"], "img": agg["img"],
        "sessions": len(sessions), "compressed_bytes_downloaded": comp, "compressed_mb_covered": covered_mb, "session_seconds": round(secs, 1),
        "download_mb_s": round(comp / secs / 1e6, 2) if secs else None, "input_mb_s": round(covered_mb / secs, 2) if secs else None,
        "decompressed_bytes": sum(s["decompressed_bytes"] for s in sessions),
        "upload_bytes": up_b, "upload_mb_s": round(up_b / up_s / 1e6, 2) if up_s else None, "readback_mb_s": round(up_b / rb_s / 1e6, 2) if rb_s else None,
        "stored_shards": len(cur), "stored_bytes": sum(e["bytes"] for e in cur), "stored_opinions": sum(e["opinions"] for e in cur),
        "manifest_states": dict(collections.Counter(e["state"] for e in cur)),
        "readback_failures": sum(1 for e in cur if not e.get("readback_ok")),
    }
    write_json(os.path.join(WORK, "extract_report.json"), out)
    print(json.dumps(out, indent=1, default=str))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="extract (resumes from the checkpoint)")
    r.add_argument("--limit-mb", type=int, default=None, help="read only the first N MB of the compressed file (trial run)")
    r.add_argument("--procs", type=int, default=3, help="render/compress worker processes")
    r.add_argument("--workers", type=int, default=4, help="parallel bzip2 segment decoders")
    r.add_argument("--upload-threads", type=int, default=3)
    r.add_argument("--min-free-gb", type=float, default=3.5, help="pause (then stop) when free disk falls below this")
    r.add_argument("--no-upload", action="store_true", help="write local shards only (testing); units are not marked complete")
    sub.add_parser("status", help="checkpoint and manifest summary")
    sub.add_parser("report", help="aggregate unit statistics, throughput and upload speed into work/extract_report.json")
    a = ap.parse_args()
    if a.cmd == "status":
        return status()
    if a.cmd == "report":
        return report()
    try:
        Run(a).run()
    except BaseException:  # noqa: BLE001 - daemon decoder threads can keep the interpreter alive after an error
        import traceback

        traceback.print_exc()
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(1)
    sys.stdout.flush()
    os._exit(0)


if __name__ == "__main__":
    sys.exit(main())
