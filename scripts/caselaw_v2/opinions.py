"""Case law v2 step 4: opinion text of the selected clusters -> reading-store objects + per-unit pointer rows.

    python3 -I -B scripts/caselaw_v2/opinions.py run --run all [--units all|5,6] [--procs 3] [--workers 4] [--upload]
    python3 -I -B scripts/caselaw_v2/opinions.py run --run sample --units 5 --segments 4 --tag=-sample --keep-raw 60
    python3 -I -B scripts/caselaw_v2/opinions.py status --run all

One streaming pass over opinions-2026-09-30.csv.bz2 (55.25 GB, pinned by size and ETag) serves every v2 tier at once:
CourtListener writes the table in heap order, so every court is spread over the whole file and a per-court pass would
re-read all of it. The file is read in the 20 units stage 1 measured (scripts/enrichment/caselaw/extract_text.py,
boundaries copied once into private/build/w1025_caselaw/units.json with the sha256 of their source): unit u starts at
segment 60u at a recorded record boundary, so any unit can be (re)run alone and produces the same bytes.

Per record: the opinion id and cluster id are read from the record; a record whose cluster is in the run's selection
(clusters.py: unblocked clusters of the selected tiers/courts) is rendered by the stage-1 code itself
(extract_text.build_record -> html_text, the same renderer as tiers 1-3) and turned into a reading record
(read_store.reading_record, format caselaw-read/1, the format the app reads) whose provenance names the exact source
bytes: {"file", "etag", "segment", "offset" (the record's start in that segment's decompressed output),
"record_sha256" (the whole CSV record), "field", "fields_present", "raw_sha256", "raw_bytes" (the chosen markup field),
"sha1" (CourtListener's hash of the court's file), "date_created", "date_modified", "page_count"}.
Citation anchors are marked held=1 when the cited cluster gets a page (tiers 1-3 of stage 2, or this run's clusters),
2 when it is blocked (shown as plain text), else 0; the app re-checks held links live.

Packing: one gzip member per opinion (one HTTP Range read), appended in input order to one open object per tier; an
object closes at a cluster change once it reaches OBJECT_TARGET bytes, so opinions of one cluster that are adjacent in
the file share an object. Opinions of one cluster that the file holds far apart can land in different objects; the
case page reads each object's range (src/lib/external/caselaw.functions.ts). Keys are content addressed:
  caselaw/read/2026-09-30/t<tier>/v2<tag>/u<unit>/t<tier>-u<unit>-<seq>-<sha256[:12]>.jsonl.gz
Outputs per unit under private/build/w1025_caselaw/runs/<run>/:
  staged/<key>                  the object (deleted after a verified upload)
  attach/u<unit>.jsonl.gz       one row per opinion: cluster_id, opinion_id, tier, court_id, key, s, n, type,
                                author_str, author_id, per_curiam, text_chars, source_field (load.py turns them into
                                caselaw.cases.opinions entries; text and source hashes stay in the record itself)
  omap/u<unit>.npy              (opinion_id, cluster_id) int32 pairs of EVERY record of the unit (citedby.py needs the
                                citing opinions' clusters; about 4.5 MB per unit)
  units/u<unit>.json            counts, objects (key, bytes, sha256, opinions, clusters), source window, seconds
  objects.jsonl                 one line per object state change (staged / uploaded with readback)
  checkpoint.json               unit status: complete (all objects staged and rows written) / uploaded
A unit that did not complete is rerun from its start; its leftovers are removed first. --segments N reads only the first
N segments of a unit (a bounded sample: records starting in the last segment read are left out, marked partial).
"""
from __future__ import annotations

import argparse
import collections
import gzip
import hashlib
import json
import multiprocessing as mp
import os
import queue
import shutil
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (BUILDER, FILE_BYTES, OBJECT_TARGET, OPINIONS_ETAG, ROOT, STAGE1_CHECKPOINT, WORK, DiskGuard,  # noqa: E402
                    V2Error, append_jsonl, gzip_member, now, object_key, read_json, sha256_bytes, write_json)

BATCH_BYTES = 8_000_000
SEGMENT_MB = 48
UNIT_SEGMENTS = 60
UNITS_FILE = os.path.join(WORK, "units.json")
STAGE1_SELECTION = os.path.join(ROOT, "private", "build", "caselaw", "work", "selection.parquet")


# ---------------------------------------------------------------------------------------------- sorted id sets
class IdSet:
    """Membership over a sorted int64 array (frozenset of millions of Python ints costs gigabytes)."""

    def __init__(self, ids):
        import numpy as np

        self.a = np.unique(np.asarray(ids, dtype=np.int64))

    def __contains__(self, x) -> bool:
        if x is None:
            return False
        import numpy as np

        i = int(np.searchsorted(self.a, x))
        return i < len(self.a) and int(self.a[i]) == int(x)

    def __len__(self) -> int:
        return len(self.a)


class Selection:
    def __init__(self, path: str):
        import numpy as np

        z = np.load(path, allow_pickle=False)
        self.ids = z["cluster_id"]
        self.tier = z["tier"]
        self.court = z["court"]
        self.courts = [str(c) for c in z["courts"]]

    def find(self, cid: int) -> int:
        import numpy as np

        i = int(np.searchsorted(self.ids, cid))
        return i if i < len(self.ids) and int(self.ids[i]) == cid else -1


def held_and_blocked(run: str):
    """Clusters that get a page (stage-2 tiers 1-3 unblocked + this run's selection) and every blocked cluster known."""
    import duckdb
    import numpy as np

    con = duckdb.connect()
    con.execute("PRAGMA threads=2")
    held = []
    blocked = []
    if os.path.exists(STAGE1_SELECTION):
        held.append(con.execute(f"SELECT DISTINCT cluster_id FROM read_parquet('{STAGE1_SELECTION}') WHERE NOT blocked").fetchnumpy()["cluster_id"])
        blocked.append(con.execute(f"SELECT DISTINCT cluster_id FROM read_parquet('{STAGE1_SELECTION}') WHERE blocked").fetchnumpy()["cluster_id"])
    sel = np.load(os.path.join(WORK, "runs", run, "selection.npz"), allow_pickle=False)
    held.append(sel["cluster_id"])
    meta = os.path.join(WORK, "runs", run, "meta.duckdb")
    con.execute(f"ATTACH '{meta}' AS m (READ_ONLY)")
    blocked.append(con.execute("SELECT DISTINCT cluster_id FROM m.blocked_ids").fetchnumpy()["cluster_id"])
    con.close()
    return np.concatenate(held) if held else np.zeros(0, np.int64), np.concatenate(blocked) if blocked else np.zeros(0, np.int64)


# ---------------------------------------------------------------------------------------------- workers
_W: dict = {}


def init_worker(held, blocked) -> None:
    import extract_text  # noqa: F401  (stage-1 renderer, read only)
    import read_store  # noqa: F401

    _W["held"] = IdSet(held)
    _W["blocked"] = IdSet(blocked)


def cluster_of(rec: bytes) -> int | None:
    """Last CSV field (cluster_id) of an opinions record: `"123"\\n` or empty for NULL."""
    tail = rec[rec.rindex(b",", 0, len(rec) - 1) + 1:].strip()
    if tail.startswith(b'"'):
        tail = tail[1:-1]
    return int(tail) if tail else None


def render_one(rec: bytes, meta: tuple, seg: int, off: int, url: str) -> tuple[bytes, dict, dict]:
    """(gzip member, attach row, facts) for one selected record."""
    import extract_text as et
    import read_store as rs

    oid, cid, tier, court = meta
    st_meta = (oid, cid, None, court, f"t{tier}", None, None, False, False, False)
    row, facts = et.build_record(rec, st_meta)
    rr = rs.reading_record(row, _W["held"], None, None, _W["blocked"])
    rr.pop("stage1", None)
    rr["source"] = {"file": url, "etag": OPINIONS_ETAG, "segment": seg, "offset": off, "record_sha256": sha256_bytes(rec),
                    "field": row["source_field"], "fields_present": row["fields_present"], "raw_sha256": row["raw_sha256"],
                    "raw_bytes": row["raw_bytes"], "sha1": row["sha1"], "date_created": row["date_created"],
                    "date_modified": row["date_modified"], "page_count": row["page_count"]}
    rr["builder"] = BUILDER
    body = json.dumps(rr, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    member = gzip_member(body)
    # lean on purpose: the lead keeps every unit's rows until the load (hashes stay in the record itself)
    attach = {"cluster_id": cid, "opinion_id": oid, "tier": tier, "court_id": court, "type": rr["type"], "author_str": rr["author_str"],
              "author_id": rr["author_id"], "per_curiam": rr["per_curiam"], "text_chars": rr["text_chars"],
              "source_field": row["source_field"]}
    f = {"tier": tier, "src": facts["src"], "raw_bytes": facts["raw_bytes"], "text_chars": facts["text_chars"],
         "empty_text": facts["empty_text"], "pages_source": facts["pages_source"], "citations": facts["citations"],
         "json_bytes": len(body), "gzip_bytes": len(member), "ocr": bool(rr["extracted_by_ocr"]),
         "held_anchors": sum(1 for c in rr["citations"] if c[4] == 1), "blocked_anchors": sum(1 for c in rr["citations"] if c[4] == 2)}
    return member, attach, f


def render_batch(task: tuple) -> list:
    items, url = task
    out = []
    for rec, meta, seg, off, keep in items:
        member, attach, facts = render_one(rec, meta, seg, off, url)
        raw = None
        if keep:
            import extract_text as et

            vals = et.split_fields(rec)
            src = attach["source_field"]
            raw = vals[et.COL[src]] if src else b""
        out.append((member, attach, facts, raw))
    return out


# ---------------------------------------------------------------------------------------------- objects
class ObjectWriter:
    def __init__(self, run_dir: str, tier: int, unit: int, tag: str, target: int = OBJECT_TARGET):
        self.run_dir, self.tier, self.unit, self.tag, self.target = run_dir, tier, unit, tag, target
        self.seq = 0
        self.members: list[tuple[bytes, dict]] = []
        self.size = 0
        self.last_cluster = None

    def add(self, member: bytes, attach: dict) -> dict | None:
        closed = None
        if self.members and self.size >= self.target and attach["cluster_id"] != self.last_cluster:
            closed = self.close()
        self.members.append((member, attach))
        self.size += len(member)
        self.last_cluster = attach["cluster_id"]
        return closed

    def close(self) -> dict | None:
        if not self.members:
            return None
        blob = b"".join(m for m, _ in self.members)
        sha = hashlib.sha256(blob).hexdigest()
        key = object_key(self.tier, self.unit, self.seq, sha, self.tag)
        path = os.path.join(self.run_dir, "staged", key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path + ".tmp", "wb") as h:
            h.write(blob)
        os.replace(path + ".tmp", path)
        rows = []
        off = 0
        for m, a in self.members:
            rows.append({**a, "key": key, "s": off, "n": len(m)})
            off += len(m)
        desc = {"key": key, "path": path, "tier": self.tier, "unit": self.unit, "seq": self.seq, "bytes": len(blob), "sha256": sha,
                "opinions": len(rows), "clusters": len({r["cluster_id"] for r in rows}), "rows": rows}
        self.seq += 1
        self.members, self.size, self.last_cluster = [], 0, None
        return desc


# ---------------------------------------------------------------------------------------------- units
def ensure_units() -> dict:
    u = read_json(UNITS_FILE)
    if u:
        return u
    ck = read_json(STAGE1_CHECKPOINT)
    if not ck:
        raise V2Error("no unit boundaries: units.json is missing and the stage-1 checkpoint cannot be read")
    raw = open(STAGE1_CHECKPOINT, "rb").read()
    u = {"input": ck["input"], "boundaries": ck["boundaries"], "source": os.path.relpath(STAGE1_CHECKPOINT, ROOT),
         "source_sha256": hashlib.sha256(raw).hexdigest(), "copied_at": now(),
         "note": "unit u = records starting in segments [60u, 60u+60) of 48 MB compressed; offset = start of its first record"}
    if u["input"]["bytes"] != FILE_BYTES["opinions"] or u["input"]["etag"] != OPINIONS_ETAG:
        raise V2Error("stage-1 boundaries belong to another input file")
    if len(u["boundaries"]) != u["input"]["units"]:
        raise V2Error("stage-1 boundaries are incomplete")
    write_json(UNITS_FILE, u)
    return u


def parse_units(spec: str, n: int) -> list[int]:
    if spec == "all":
        return list(range(n))
    out = sorted({int(x) for x in spec.split(",") if x.strip()})
    if any(u < 0 or u >= n for u in out):
        raise V2Error(f"units must be between 0 and {n - 1}")
    return out


class Uploader:
    """Background verified uploads (store.Storage.put_verified: upload, full readback, SHA-256 compare); the local
    object is deleted only after a verified receipt. Only the lead runs this (--upload)."""

    def __init__(self, run_dir: str, threads: int = 2):
        import store

        self.st = store.Storage()
        self.run_dir = run_dir
        self.q: queue.Queue = queue.Queue()
        self.errors: list[str] = []
        self.done = collections.Counter()
        self.lock = threading.Lock()
        self.threads = [threading.Thread(target=self._loop, daemon=True) for _ in range(threads)]
        for t in self.threads:
            t.start()

    def _loop(self) -> None:
        while True:
            desc = self.q.get()
            if desc is None:
                return
            try:
                r = self.st.put_verified(desc["key"], desc["path"], desc["sha256"], desc["bytes"], may_replace=lambda _sha: False)
                with self.lock:
                    append_jsonl(os.path.join(self.run_dir, "objects.jsonl"),
                                 {"key": desc["key"], "unit": desc["unit"], "bytes": desc["bytes"], "sha256": desc["sha256"],
                                  "state": r.get("state", "uploaded"), "readback_ok": True, "at": now()})
                    self.done[r.get("state", "uploaded")] += 1
                os.remove(desc["path"])
            except Exception as exc:  # noqa: BLE001 - recorded; the unit is not marked uploaded
                with self.lock:
                    self.errors.append(f"{desc['key']}: {type(exc).__name__}: {str(exc)[:200]}")
            finally:
                self.q.task_done()

    def submit(self, desc: dict) -> None:
        self.q.put(desc)

    def drain(self) -> None:
        self.q.join()

    def close(self) -> None:
        for _ in self.threads:
            self.q.put(None)


def run_unit(a, u: int, units: dict, sel: Selection, pool, run_dir: str, uploader, guard: DiskGuard) -> dict:
    import extract_text as et

    K = units["input"]["unit_segments"]
    b = units["boundaries"][str(u)]
    url = units["input"]["url"]
    first = b["segment"]
    last_seg = min((u + 1) * K, units["input"]["segments"]) - 1
    partial = False
    limit = None
    stop_seg = last_seg  # records starting after this segment belong to the next unit
    if a.segments:
        stop_seg = min(last_seg, first + a.segments - 2)  # the last segment read only completes straddling records
        limit = (first + a.segments) * SEGMENT_MB * 1_000_000
        partial = stop_seg < last_seg
    # leftovers of an incomplete earlier attempt at this unit
    for sub, ext in (("attach", ".jsonl.gz"), ("raw", ""), ("omap", ".npy")):
        p = os.path.join(run_dir, sub, f"u{u:02d}{ext}")
        if os.path.isdir(p):
            shutil.rmtree(p)
        elif os.path.exists(p):
            os.remove(p)
    import cl_stream

    stats = cl_stream.StreamStats()
    reader = et.segment_reader(first, limit, a.workers, stats)
    scanner = et.Scanner(reader.pieces(), first, b["offset"], header=bool(b.get("header")))
    writers: dict[int, ObjectWriter] = {}
    attach_path = os.path.join(run_dir, "attach", f"u{u:02d}.jsonl.gz")
    os.makedirs(os.path.dirname(attach_path), exist_ok=True)
    ah = gzip.open(attach_path + ".tmp", "wt", encoding="utf-8", compresslevel=6)
    objects: list[dict] = []
    counts = collections.Counter()
    by_tier = collections.defaultdict(collections.Counter)
    by_court = collections.Counter()
    src_fields = collections.Counter()
    pages_src = collections.Counter()
    inflight: collections.deque = collections.deque()
    batch: list = []
    batch_bytes = 0
    t0 = time.time()
    last_log = t0
    raw_dir = os.path.join(run_dir, "raw", f"u{u:02d}")
    import array

    omap = array.array("i")  # opinion_id, cluster_id of every record (int32; checked below)

    def finish_object(desc):
        if desc is None:
            return
        for r in desc.pop("rows"):
            ah.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")
        objects.append({k: v for k, v in desc.items() if k != "path"} | {"path": os.path.relpath(desc["path"], ROOT)})
        append_jsonl(os.path.join(run_dir, "objects.jsonl"), {"key": desc["key"], "unit": u, "bytes": desc["bytes"],
                                                              "sha256": desc["sha256"], "opinions": desc["opinions"],
                                                              "state": "staged", "at": now()})
        if uploader:
            uploader.submit(desc)
        guard.check(f"after staging {desc['key']}")

    def collect_one():
        for member, attach, facts, raw in inflight.popleft().get():
            t = attach["tier"]
            w = writers.get(t)
            if w is None:
                w = writers[t] = ObjectWriter(run_dir, t, u, a.tag)
            finish_object(w.add(member, attach))
            counts["opinions"] += 1
            bt = by_tier[t]
            bt["opinions"] += 1
            bt["raw_bytes"] += facts["raw_bytes"]
            bt["text_chars"] += facts["text_chars"]
            bt["json_bytes"] += facts["json_bytes"]
            bt["gzip_bytes"] += facts["gzip_bytes"]
            bt["empty_text"] += int(facts["empty_text"])
            bt["no_text_field"] += int(facts["src"] == "none")
            bt["ocr"] += int(facts["ocr"])
            bt["citations"] += facts["citations"]
            bt["held_anchors"] += facts["held_anchors"]
            bt["blocked_anchors"] += facts["blocked_anchors"]
            by_court[attach["court_id"]] += 1
            src_fields[facts["src"]] += 1
            pages_src[facts["pages_source"]] += 1
            if raw is not None:
                os.makedirs(raw_dir, exist_ok=True)
                with open(os.path.join(raw_dir, f"{attach['opinion_id']}.{attach['source_field'] or 'none'}.raw"), "wb") as h:
                    h.write(raw)

    def dispatch():
        nonlocal batch, batch_bytes
        if batch:
            inflight.append(pool.apply_async(render_batch, ((batch, url),)))
            batch, batch_bytes = [], 0
        while len(inflight) > 2 * a.procs:
            collect_one()

    end = "eof"
    try:
        for seg, off, rec in scanner.records():
            if seg > stop_seg:
                end = "unit_end" if not partial else "segment_limit"
                break
            counts["records"] += 1
            cid = cluster_of(rec)
            oid = et.record_id(rec)
            if cid is None:
                counts["no_cluster"] += 1
                continue
            if oid >= 2**31 or cid >= 2**31:
                raise V2Error(f"opinion {oid} / cluster {cid} exceeds the int32 map")
            omap.append(oid)
            omap.append(cid)
            i = sel.find(cid)
            if i < 0:
                continue
            keep = counts["kept_raw"] < a.keep_raw  # the first --keep-raw selected opinions of the unit, input order
            counts["kept_raw"] += int(keep)
            batch.append((rec, (oid, cid, int(sel.tier[i]), sel.courts[int(sel.court[i])]), seg, off, keep))
            batch_bytes += len(rec)
            if batch_bytes >= BATCH_BYTES:
                dispatch()
            if time.time() - last_log > 60:
                last_log = time.time()
                print(f"[opinions] unit {u} seg {seg}: {counts['records']:,} records, {counts['opinions']:,} rendered, "
                      f"{stats.compressed / 1e6:,.0f} MB read ({stats.rate_mb_s():.1f} MB/s), {last_log - t0:,.0f}s", flush=True)
        else:
            if scanner.trailing.strip() and not limit:
                raise V2Error(f"{len(scanner.trailing)} bytes after the last complete record at the end of the file")
        dispatch()
        while inflight:
            collect_one()
        for t in sorted(writers):
            finish_object(writers[t].close())
    finally:
        reader.close()
        ah.close()
    os.replace(attach_path + ".tmp", attach_path)
    import numpy as np

    om_path = os.path.join(run_dir, "omap", f"u{u:02d}.npy")
    os.makedirs(os.path.dirname(om_path), exist_ok=True)
    np.save(om_path + ".tmp.npy", np.frombuffer(omap, dtype=np.int32).reshape(-1, 2))
    os.replace(om_path + ".tmp.npy", om_path)
    report = {"unit": u, "run": a.run, "partial": partial, "end": end, "segments": [first, stop_seg], "start": b,
              "limit_bytes": limit, "source": {"url": url, "bytes": units["input"]["bytes"], "etag": units["input"]["etag"]},
              "builder": BUILDER, "records": counts["records"], "records_without_cluster": counts["no_cluster"],
              "opinions": counts["opinions"], "raw_kept": counts["kept_raw"], "by_tier": {str(k): dict(v) for k, v in sorted(by_tier.items())},
              "by_court": dict(by_court.most_common()), "source_fields": dict(src_fields), "pages_source": dict(pages_src),
              "objects": objects, "attach": os.path.relpath(attach_path, ROOT), "omap": os.path.relpath(om_path, ROOT),
              "omap_records": len(omap) // 2,
              "compressed_bytes_read": stats.compressed, "decompressed_bytes": scanner.decompressed,
              "seconds": round(time.time() - t0, 1), "finished_at": now()}
    write_json(os.path.join(run_dir, "units", f"u{u:02d}.json"), report)
    return report


def cmd_run(a) -> int:
    run_dir = os.path.join(WORK, "runs", a.run)
    if not os.path.exists(os.path.join(run_dir, "selection.npz")):
        raise V2Error(f"run {a.run!r} has no selection: run clusters.py --run {a.run} first")
    units = ensure_units()
    wanted = parse_units(a.units, units["input"]["units"])
    ck_path = os.path.join(run_dir, "checkpoint.json")
    ck = read_json(ck_path, {"units": {}})
    sel = Selection(os.path.join(run_dir, "selection.npz"))
    held, blocked = held_and_blocked(a.run)
    guard = DiskGuard(run_dir, a.budget_mb * 1_000_000)
    uploader = Uploader(run_dir) if a.upload else None
    print(f"[opinions] run {a.run}: {len(sel.ids):,} selected clusters, {len(held):,} held, {len(blocked):,} blocked; units {wanted}", flush=True)
    ctx = mp.get_context("fork")
    with ctx.Pool(a.procs, initializer=init_worker, initargs=(held, blocked)) as pool:
        for u in wanted:
            st = ck["units"].get(str(u))
            if st and st.get("status") in ("complete", "uploaded") and st.get("builder") == BUILDER and not st.get("partial"):
                print(f"[opinions] unit {u} already {st['status']}", flush=True)
                continue
            rep = run_unit(a, u, units, sel, pool, run_dir, uploader, guard)
            ck["units"][str(u)] = {"status": "complete", "builder": BUILDER, "partial": rep["partial"], "opinions": rep["opinions"],
                                   "objects": len(rep["objects"]), "finished_at": rep["finished_at"]}
            write_json(ck_path, ck)
            if uploader:
                uploader.drain()
                if uploader.errors:
                    raise V2Error(f"uploads failed: {uploader.errors[:3]}")
                ck["units"][str(u)]["status"] = "uploaded"
                write_json(ck_path, ck)
            print(f"[opinions] unit {u} {'PARTIAL ' if rep['partial'] else ''}done: {rep['opinions']:,} opinions in "
                  f"{len(rep['objects'])} objects, {rep['seconds']:,.0f}s", flush=True)
    if uploader:
        uploader.close()
    return 0


def cmd_status(a) -> int:
    run_dir = os.path.join(WORK, "runs", a.run)
    ck = read_json(os.path.join(run_dir, "checkpoint.json"), {"units": {}})
    print(json.dumps(ck, indent=1))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--run", required=True)
    r.add_argument("--units", default="all")
    r.add_argument("--segments", type=int, default=None, help="read only the first N segments of each unit (bounded sample)")
    r.add_argument("--tag", default="", help="key tag after v2 (e.g. -sample); empty for the production run")
    r.add_argument("--procs", type=int, default=3)
    r.add_argument("--workers", type=int, default=4, help="parallel bzip2 segment downloads")
    r.add_argument("--keep-raw", type=int, default=0, help="keep raw markup of the first N selected opinions per unit")
    r.add_argument("--budget-mb", type=int, default=1500, help="stop if the run folder grows past this (staged objects)")
    r.add_argument("--upload", action="store_true", help="lead only: verified upload, then delete each staged object")
    s = sub.add_parser("status")
    s.add_argument("--run", required=True)
    a = ap.parse_args()
    if a.cmd == "run" and a.tag and not all(ch.isalnum() or ch in "-_" for ch in a.tag):
        raise V2Error("--tag may hold letters, digits, - and _ only")
    return cmd_run(a) if a.cmd == "run" else cmd_status(a)


if __name__ == "__main__":
    sys.exit(main())
