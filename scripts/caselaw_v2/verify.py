"""Case law v2: end-to-end checks of a run's staged output against the source bytes.

    python3 -I -B scripts/caselaw_v2/verify.py --run sample [--reparse]

Checks (every failure is listed; exit status 1 when any check fails):
  objects     each staged object's bytes (local, or read back from storage with --from-storage N for a sample of
              uploaded objects) match the sha256/size in units/u*.json; it splits into gzip members exactly at
              the attach rows' (s, n) pointers; every member is one "caselaw-read/1" record whose opinion/cluster ids
              match its row, whose text hashes to text_sha256 and whose provenance names the pinned source file
  raw         for every opinion whose raw markup was kept (--keep-raw): sha256(raw) == source.raw_sha256 and the
              stage-1 renderer applied to the raw bytes gives exactly the stored text (string equality)
  stage2      opinions of tiers 1-3 in the sample were already rendered by stage 2: their text_sha256 must equal the
              stage-2 reading index (private/build/caselaw_read/read/index), byte for byte
  reparse     (--reparse) the same source window is decoded again and parsed by an independent CSV reader (pyarrow, not
              the stage-1 regex scanner): every sampled opinion's chosen field hashes to source.raw_sha256, its
              cluster_id matches and its record exists; and the number of selected records in the window is the same
  clusters    every attached opinion's cluster is in the run's selection (meta.duckdb), tier and court agree
Writes <run>/verify_report.json and the sample manifest <run>/manifest.json (objects with sha256, counts, sources).
"""
from __future__ import annotations

import argparse
import collections
import glob
import gzip
import hashlib
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (FILES, OPINIONS_ETAG, READ_FORMAT, ROOT, SNAPSHOT, WORK, iter_gzip_members, now, read_json,  # noqa: E402
                    read_jsonl, sha256_bytes, sha256_text, write_json)

STAGE2_INDEX = os.path.join(ROOT, "private", "build", "caselaw_read", "read", "index")


class Report:
    def __init__(self):
        self.counts = collections.Counter()
        self.failures: list[str] = []

    def fail(self, what: str) -> None:
        self.counts["failures"] += 1
        if len(self.failures) < 200:
            self.failures.append(what)


class StorageBytes:
    """Whole-object reads from private storage (GET; the lead's full run deletes local objects after upload)."""

    def __init__(self):
        import store

        self.st = store.Storage()

    def __call__(self, key: str) -> bytes | None:
        import uuid

        r = self.st._retry(lambda: self.st.s.get(self.st._object_url(key, True), headers=self.st.h,
                                                 params={"read": uuid.uuid4().hex}, timeout=self.st.timeout))
        return r.content if r.status_code == 200 else None


def load_records(run_dir: str, rep: Report, from_storage: int = 0) -> dict[int, dict]:
    """opinion_id -> {record, row} for every staged object (objects check included). Objects no longer on local disk
    (uploaded and deleted) are read back from storage for a deterministic sample of `from_storage` objects."""
    import random

    out: dict[int, dict] = {}
    fetch = StorageBytes() if from_storage else None
    remote_keys: set = set()
    if from_storage:
        gone = [o["key"] for up in sorted(glob.glob(os.path.join(run_dir, "units", "u*.json"))) for o in read_json(up)["objects"]
                if not os.path.exists(os.path.join(ROOT, o["path"]))]
        remote_keys = set(random.Random(20261025).sample(gone, min(from_storage, len(gone))))
    for up in sorted(glob.glob(os.path.join(run_dir, "units", "u*.json"))):
        unit = read_json(up)
        rows = collections.defaultdict(list)
        for r in read_jsonl(os.path.join(ROOT, unit["attach"])):
            rows[r["key"]].append(r)
        for o in unit["objects"]:
            path = os.path.join(ROOT, o["path"])
            if os.path.exists(path):
                data = open(path, "rb").read()
            elif o["key"] in remote_keys:
                data = fetch(o["key"])
                rep.counts["objects_read_from_storage"] += 1
                if data is None:
                    rep.fail(f"{o['key']}: not readable from storage")
                    continue
            else:
                rep.counts["objects_not_checked_uploaded"] += 1
                continue
            rep.counts["objects"] += 1
            if len(data) != o["bytes"] or sha256_bytes(data) != o["sha256"]:
                rep.fail(f"{o['key']}: bytes or sha256 differ from the unit report")
                continue
            if not o["key"].endswith(f"-{o['sha256'][:12]}.jsonl.gz"):
                rep.fail(f"{o['key']}: key does not carry the content hash")
            members = list(iter_gzip_members(data))
            krows = sorted(rows.get(o["key"], []), key=lambda r: r["s"])
            if [(m[0], m[1]) for m in members] != [(r["s"], r["n"]) for r in krows]:
                rep.fail(f"{o['key']}: gzip members do not line up with the attach rows")
                continue
            for (off, n, body), r in zip(members, krows):
                rep.counts["members"] += 1
                rec = json.loads(body.decode("utf-8"))
                if rec.get("format") != READ_FORMAT or rec.get("opinion_id") != r["opinion_id"] or rec.get("cluster_id") != r["cluster_id"]:
                    rep.fail(f"{o['key']}@{off}: record ids/format differ from the row")
                    continue
                if sha256_text(rec["text"]) != rec["text_sha256"] or rec["text_chars"] != len(rec["text"]):
                    rep.fail(f"opinion {r['opinion_id']}: text does not match text_sha256/text_chars")
                src = rec.get("source") or {}
                if not (src.get("file", "").endswith(FILES["opinions"]) and src.get("etag") == OPINIONS_ETAG
                        and len(src.get("record_sha256", "")) == 64 and len(src.get("raw_sha256", "")) == 64):
                    rep.fail(f"opinion {r['opinion_id']}: provenance incomplete")
                if rec.get("snapshot") != SNAPSHOT:
                    rep.fail(f"opinion {r['opinion_id']}: snapshot {rec.get('snapshot')}")
                for c in rec.get("citations") or []:
                    if not (0 <= c[0] < c[1] <= len(rec["text"])):
                        rep.fail(f"opinion {r['opinion_id']}: citation anchor outside the text")
                        break
                if r["opinion_id"] in out:
                    rep.fail(f"opinion {r['opinion_id']} stored twice")
                out[r["opinion_id"]] = {"rec": rec, "row": r, "unit": unit["unit"]}
    return out


def check_raw(run_dir: str, recs: dict, rep: Report) -> None:
    import html_text

    for path in sorted(glob.glob(os.path.join(run_dir, "raw", "u*", "*.raw"))):
        name = os.path.basename(path)
        oid = int(name.split(".")[0])
        field = name.split(".")[1]
        raw = open(path, "rb").read()
        e = recs.get(oid)
        rep.counts["raw_checked"] += 1
        if not e:
            rep.fail(f"raw sample {oid} has no stored record")
            continue
        rec = e["rec"]
        if sha256_bytes(raw) != rec["source"]["raw_sha256"] or len(raw) != rec["source"]["raw_bytes"]:
            rep.fail(f"opinion {oid}: raw bytes differ from source.raw_sha256")
            continue
        if field != rec["source"]["field"]:
            rep.fail(f"opinion {oid}: raw field {field} is not the recorded field")
        text = html_text.render_field(field, raw.decode("utf-8")).text
        if text != rec["text"]:
            rep.fail(f"opinion {oid}: rendering the source bytes does not give the stored text")
        else:
            rep.counts["raw_exact_text"] += 1


def check_stage2(recs: dict, rep: Report) -> None:
    want = {oid: e for oid, e in recs.items() if e["row"]["tier"] in (1, 2, 3)}
    if not want or not os.path.isdir(STAGE2_INDEX):
        return
    courts = {e["row"]["court_id"] for e in want.values()}
    found = {}
    for path in glob.glob(os.path.join(STAGE2_INDEX, "*.tsv.gz")):
        if not any(f"__{c}" in os.path.basename(path) for c in courts):
            continue
        with gzip.open(path, "rt", encoding="utf-8") as h:
            head = h.readline().rstrip("\n").split("\t")
            io_, it = head.index("opinion_id"), head.index("text_sha256")
            for line in h:
                a = line.rstrip("\n").split("\t")
                oid = int(a[io_])
                if oid in want:
                    found[oid] = a[it]
    for oid, e in want.items():
        rep.counts["stage2_candidates"] += 1
        if oid not in found:
            rep.counts["stage2_not_in_index"] += 1  # blocked in stage 2, or a cluster stage 2 did not hold
            continue
        rep.counts["stage2_compared"] += 1
        if found[oid] != e["rec"]["text_sha256"]:
            rep.fail(f"opinion {oid}: v2 text differs from the stage-2 reading store")
        else:
            rep.counts["stage2_identical"] += 1


def check_reparse(run_dir: str, recs: dict, rep: Report) -> None:
    """Decode the same windows again and parse them with pyarrow (an independent CSV reader)."""
    import io

    import numpy as np
    import pyarrow as pa
    import pyarrow.csv as pacsv

    import cl_stream
    import extract_text as et

    sel = np.load(os.path.join(run_dir, "selection.npz"))
    ids = sel["cluster_id"]
    units = read_json(os.path.join(WORK, "units.json"))
    for up in sorted(glob.glob(os.path.join(run_dir, "units", "u*.json"))):
        unit = read_json(up)
        first, stop = unit["segments"]
        b = unit["start"]
        stats = cl_stream.StreamStats()
        reader = et.segment_reader(first, unit["limit_bytes"], 3, stats)

        class Window(io.RawIOBase):
            """header + the decompressed bytes from the unit's first record to the end of the window"""

            def __init__(self):
                self.it = reader.pieces()
                self.buf = bytearray(b"" if b.get("header") else et.HEADER)
                self.skip = b["offset"]

            def readable(self):
                return True

            def readinto(self, mv):
                while not self.buf:
                    try:
                        seg, data = next(self.it)
                    except StopIteration:
                        return 0
                    if data is None:
                        continue
                    if self.skip:
                        cut = min(self.skip, len(data))
                        data = data[cut:]
                        self.skip -= cut
                    self.buf += data
                n = min(len(mv), len(self.buf))
                mv[:n] = self.buf[:n]
                del self.buf[:n]
                return n

        cols = ["id", "cluster_id"] + et.FIELD_PRIORITY
        rd = pacsv.open_csv(io.BufferedReader(Window(), 1 << 22),
                            read_options=pacsv.ReadOptions(block_size=1 << 25),
                            parse_options=pacsv.ParseOptions(quote_char='"', double_quote=False, escape_char="\\", newlines_in_values=True),
                            convert_options=pacsv.ConvertOptions(include_columns=cols, column_types={c: pa.string() for c in cols},
                                                                 strings_can_be_null=True, null_values=[""]))
        seen = 0
        selected_in_window = 0
        order: list[int] = []  # selected opinion ids in file order
        target = {oid for oid, e in recs.items() if e["unit"] == unit["unit"]}
        try:
            for batch in rd:
                t = batch.to_pydict()
                for i in range(batch.num_rows):
                    oid = int(t["id"][i])
                    cid = int(t["cluster_id"][i]) if t["cluster_id"][i] else None
                    if cid is not None:
                        j = int(np.searchsorted(ids, cid))
                        if j < len(ids) and int(ids[j]) == cid:
                            selected_in_window += 1
                            order.append(oid)
                    if oid not in target:
                        continue
                    e = recs[oid]
                    seen += 1
                    field = e["rec"]["source"]["field"]
                    val = t[field][i] if field else None
                    raw = (val or "").encode("utf-8")
                    if cid != e["rec"]["cluster_id"]:
                        rep.fail(f"opinion {oid}: reparsed cluster {cid} differs")
                    elif sha256_bytes(raw) != e["rec"]["source"]["raw_sha256"]:
                        rep.fail(f"opinion {oid}: reparsed field bytes differ from source.raw_sha256")
                    else:
                        rep.counts["reparse_identical"] += 1
        except pa.ArrowInvalid:
            pass  # the window ends inside a record (the limit cuts the last segment)
        finally:
            reader.close()
        rep.counts["reparse_seen"] += seen
        missing = len(target) - seen
        if missing:
            rep.fail(f"unit {unit['unit']}: {missing} stored opinions not found when reparsing the window")
        # completeness: the pipeline stops at a segment boundary, so its opinions must be exactly the first N selected
        # records of the window in file order (records starting in the last segment read are parsed here only)
        rep.counts[f"u{unit['unit']}_selected_pipeline"] = unit["opinions"]
        rep.counts[f"u{unit['unit']}_selected_reparse_window"] = selected_in_window
        if set(order[: unit["opinions"]]) != target or len(set(order)) != len(order):
            rep.fail(f"unit {unit['unit']}: the stored opinions are not exactly the first selected records of the window")
        else:
            rep.counts["complete_prefix_units"] += 1


def check_clusters(run_dir: str, recs: dict, rep: Report) -> None:
    import duckdb

    con = duckdb.connect(os.path.join(run_dir, "meta.duckdb"), read_only=True)
    meta = {r[0]: (r[1], r[2]) for r in con.execute("SELECT cluster_id, tier, court_id FROM clusters").fetchall()}
    for oid, e in recs.items():
        m = meta.get(e["row"]["cluster_id"])
        if not m or (m[0], m[1]) != (e["row"]["tier"], e["row"]["court_id"]):
            rep.fail(f"opinion {oid}: cluster tier/court differ from the selection")
        else:
            rep.counts["cluster_checked"] += 1


def manifest(run_dir: str, recs: dict) -> dict:
    units = [read_json(p) for p in sorted(glob.glob(os.path.join(run_dir, "units", "u*.json")))]
    clusters = read_json(os.path.join(run_dir, "clusters_report.json"))
    objs = [{"key": o["key"], "bytes": o["bytes"], "sha256": o["sha256"], "opinions": o["opinions"], "clusters": o["clusters"]}
            for u in units for o in u["objects"]]
    by_tier = collections.Counter(e["row"]["tier"] for e in recs.values())
    by_court = collections.Counter(e["row"]["court_id"] for e in recs.values())
    return {"run": os.path.basename(run_dir), "built_at": now(), "acquired_at": [u["finished_at"] for u in units],
            "sources": [{"url": units[0]["source"]["url"] if units else None, "bytes": units[0]["source"]["bytes"] if units else None,
                         "etag": OPINIONS_ETAG, "windows": [{"unit": u["unit"], "segments": u["segments"], "start": u["start"]} for u in units]},
                        {"url": clusters["snapshot_file"], "bytes": clusters["source_bytes"]}],
            "opinions": len(recs), "by_tier": dict(by_tier), "by_court": dict(by_court),
            "clusters_selected": clusters["kept"], "objects": objs,
            "object_bytes": sum(o["bytes"] for o in objs)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--reparse", action="store_true")
    ap.add_argument("--from-storage", type=int, default=0, help="read back N uploaded objects (sample) from storage")
    a = ap.parse_args()
    run_dir = os.path.join(WORK, "runs", a.run)
    t0 = time.time()
    rep = Report()
    recs = load_records(run_dir, rep, a.from_storage)
    check_raw(run_dir, recs, rep)
    check_stage2(recs, rep)
    check_clusters(run_dir, recs, rep)
    if a.reparse:
        check_reparse(run_dir, recs, rep)
    out = {"run": a.run, "checked_at": now(), "seconds": round(time.time() - t0, 1), "counts": dict(rep.counts),
           "failures": rep.failures, "ok": not rep.failures}
    write_json(os.path.join(run_dir, "verify_report.json"), out)
    write_json(os.path.join(run_dir, "manifest.json"), manifest(run_dir, recs))
    print(json.dumps(out, indent=1))
    return 0 if out["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
