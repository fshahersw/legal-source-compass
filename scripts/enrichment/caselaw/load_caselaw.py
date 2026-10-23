"""Case-law stage 2e: load the case metadata and the Supreme Court full-text index into Postgres (schema caselaw,
database/contracts/caselaw-read-v1.sql) through its service-role load RPCs.

    cd scripts/enrichment/caselaw
    python3 -I -B load_caselaw.py objects                # register the storage objects the case rows point to
    python3 -I -B load_caselaw.py courts
    python3 -I -B load_caselaw.py cases --build full-1 [--parts 0,1] [--workers 4]
    python3 -I -B load_caselaw.py fts --build full-1 [--tiers t1] [--workers 3]
    python3 -I -B load_caselaw.py status                 # caselaw_status_v1 -> private/build/caselaw_read/load_status.json

Rows are upserted (by cluster_id / opinion_id), so every step can be rerun. Credentials: EXTERNAL_SUPABASE_URL /
EXTERNAL_SUPABASE_KEY from the environment or private/scratch/env.sh (store.load_env_file); never printed.
fts: the text of every reading-store opinion of the requested tiers is read back from storage (whole objects), checked
against the index's text_sha256 and the member sha256, and sent to caselaw_load_fts_v1, which checks the sha256
again, computes to_tsvector('english', text) and stores only the tsvector.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import glob
import gzip
import hashlib
import json
import os
import sys
import time
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)

import read_store as rs  # noqa: E402

BUILD = os.path.join(ROOT, "private", "build", "caselaw_read")
META = os.path.join(BUILD, "meta")
OBJECT_LOGS = [os.path.join(BUILD, "read", "objects.jsonl"), os.path.join(BUILD, "citator", "objects.jsonl")]
ID_MAP = os.path.join(BUILD, "object_ids.json")
FTS_BATCH_BYTES = 3_000_000


class Rpc:
    def __init__(self):
        import requests

        import store

        store.load_env_file()
        self.url = os.environ["EXTERNAL_SUPABASE_URL"].rstrip("/")
        key = os.environ["EXTERNAL_SUPABASE_KEY"]
        self.h = {"apikey": key, "Content-Type": "application/json", "Accept": "application/json"}
        if not key.startswith("sb_"):
            self.h["Authorization"] = "Bearer " + key
        self.s = requests.Session()

    def call(self, fn: str, body: dict, attempts: int = 5):
        delay = 2.0
        for attempt in range(attempts):
            try:
                r = self.s.post(f"{self.url}/rest/v1/rpc/{fn}", headers=self.h, data=json.dumps(body, ensure_ascii=False).encode("utf-8"), timeout=180)
            except Exception as exc:  # noqa: BLE001 - network errors are retried
                if attempt + 1 == attempts:
                    raise RuntimeError(f"{fn}: network error {type(exc).__name__}") from exc
                time.sleep(delay)
                delay *= 2
                continue
            if r.status_code == 200:
                return r.json()
            if r.status_code in (408, 429, 500, 502, 503, 504, 520, 522, 524) and attempt + 1 < attempts:
                time.sleep(delay)
                delay *= 2
                continue
            raise RuntimeError(f"{fn} -> HTTP {r.status_code}: {r.text[:300]}")


def known_objects() -> dict[str, dict]:
    out = {}
    for p in OBJECT_LOGS:
        if os.path.exists(p):
            with open(p) as h:
                for line in h:
                    if line.strip():
                        o = json.loads(line)
                        if o.get("readback_ok"):
                            out[o["key"]] = o
    return out


def referenced_keys() -> set[str]:
    keys = set()
    for path in sorted(glob.glob(os.path.join(META, "cases-p*.jsonl.gz"))):
        with gzip.open(path, "rt", encoding="utf-8") as h:
            for line in h:
                r = json.loads(line)
                for o in r["opinions"]:
                    if "key" in o:
                        keys.add(o["key"])
                for ref in ("citator", "authorities_ref"):
                    if r.get(ref):
                        keys.add(r[ref][0])
    return keys


def load_objects(rpc: Rpc) -> dict:
    known = known_objects()
    keys = sorted(referenced_keys())
    missing = [k for k in keys if k not in known]
    if missing:
        raise SystemExit(f"{len(missing)} referenced objects have no verified upload receipt, e.g. {missing[:3]}")
    ids = {}
    for i in range(0, len(keys), 500):
        batch = [{"key": k, "kind": "read" if k.startswith("caselaw/read/") else "citator", "bytes": known[k]["bytes"], "sha256": known[k]["sha256"]}
                 for k in keys[i:i + 500]]
        ids.update(rpc.call("caselaw_load_objects_v1", {"p_rows": batch}))
    with open(ID_MAP, "w") as h:
        json.dump(ids, h, indent=0, sort_keys=True)
    print(json.dumps({"objects": len(ids)}))
    return ids


def load_courts(rpc: Rpc) -> None:
    with open(os.path.join(META, "courts.json")) as h:
        courts = json.load(h)
    n = rpc.call("caselaw_load_courts_v1", {"p_rows": courts})
    print(json.dumps({"courts": n}))


def to_db_row(r: dict, ids: dict[str, int]) -> dict:
    out = dict(r)
    ops = []
    for o in r["opinions"]:
        o = dict(o)
        key = o.pop("key", None)
        if key is not None:
            o["o"] = ids[key]
        ops.append(o)
    out["opinions"] = ops
    for ref in ("citator", "authorities_ref"):
        if r.get(ref):
            out[ref] = [ids[r[ref][0]], r[ref][1], r[ref][2]]
    return out


def load_cases(build: str, parts: list[int] | None, workers: int) -> None:
    with open(ID_MAP) as h:
        ids = json.load(h)
    paths = sorted(glob.glob(os.path.join(META, "cases-p*.jsonl.gz")))
    if parts:
        paths = [p for p in paths if int(p.rsplit("-p", 1)[1].split(".")[0]) in parts]
    rpcs = [Rpc() for _ in range(workers)]
    t0 = time.time()
    total = 0  # rows inserted or changed (an identical row is left alone by the RPC)
    sent = 0

    def batches():
        for path in paths:
            with gzip.open(path, "rt", encoding="utf-8") as h:
                batch = []
                for line in h:
                    batch.append(to_db_row(json.loads(line), ids))
                    if len(batch) >= 1000:
                        yield batch
                        batch = []
                if batch:
                    yield batch

    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        pending = set()
        for i, b in enumerate(batches()):
            pending.add(ex.submit(rpcs[i % workers].call, "caselaw_load_cases_v1", {"p_build": build, "p_rows": b}))
            sent += len(b)
            if len(pending) >= workers * 2:
                done, pending = cf.wait(pending, return_when=cf.FIRST_COMPLETED)
                for f in done:
                    total += f.result()
                if sent % 100000 < 1000:
                    print(f"[load] {sent:,} cases sent, {total:,} written ({time.time() - t0:.0f}s)", flush=True)
        for f in cf.as_completed(pending):
            total += f.result()
    print(json.dumps({"cases_sent": sent, "cases_written": total, "seconds": round(time.time() - t0, 1)}))


def page_marker_spans(text: str, pages: list) -> list[list[int]]:
    """[offset, length] of each star-page marker ("*710") present in the text at its recorded offset (code points), the
    same rule the reading page uses; the full-text RPC indexes them as spaces so the word after a marker stays a word."""
    out = []
    for label, _idx, off in pages:
        marker = f"*{label}"
        if isinstance(off, int) and 0 <= off and text.startswith(marker, off) and 2 <= len(marker) <= 24:
            out.append([off, len(marker)])
    return out


def fts_batches(tiers: list[str], st):
    """Yield lists of {opinion_id, cluster_id, type, text, text_sha256} for every reading-store opinion of the tiers."""
    files = sorted(f for f in glob.glob(os.path.join(BUILD, "read", "index", "*.tsv.gz")) if os.path.basename(f).split("__")[0] in tiers)
    by_key: dict[str, list[dict]] = {}
    for f in files:
        for r in rs.read_tsv_gz(f):
            by_key.setdefault(r["key"], []).append(r)
    known = known_objects()
    batch, size = [], 0
    for key in sorted(by_key):
        data = rs._download(st, key, known[key]["sha256"], known[key]["bytes"])
        for r in by_key[key]:
            off, n = int(r["offset"]), int(r["length"])
            member = data[off:off + n]
            if hashlib.sha256(member).hexdigest() != r["member_sha256"]:
                raise SystemExit(f"member sha256 mismatch for opinion {r['opinion_id']}")
            rec = json.loads(zlib.decompress(member, 31).decode("utf-8"))
            if rec["opinion_id"] != int(r["opinion_id"]) or hashlib.sha256(rec["text"].encode("utf-8")).hexdigest() != r["text_sha256"]:
                raise SystemExit(f"text sha256 mismatch for opinion {r['opinion_id']}")
            item = {"opinion_id": rec["opinion_id"], "cluster_id": rec["cluster_id"], "type": rec["type"], "text": rec["text"],
                    "text_sha256": rec["text_sha256"], "blank": page_marker_spans(rec["text"], rec.get("pages") or [])}
            batch.append(item)
            size += len(rec["text"].encode("utf-8"))
            if size >= FTS_BATCH_BYTES or len(batch) >= 1000:
                yield batch
                batch, size = [], 0
    if batch:
        yield batch


def load_fts(build: str, tiers: list[str], workers: int) -> None:
    import store

    st = store.Storage()
    rpcs = [Rpc() for _ in range(workers)]
    t0 = time.time()
    agg = {"rows": 0, "parts": 0, "stripped": 0, "truncated": 0, "unchanged": 0}
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        pending = set()
        for i, b in enumerate(fts_batches(tiers, st)):
            pending.add(ex.submit(rpcs[i % workers].call, "caselaw_load_fts_v1", {"p_build": build, "p_rows": b}))
            if len(pending) >= workers * 2:
                done, pending = cf.wait(pending, return_when=cf.FIRST_COMPLETED)
                for f in done:
                    for k, v in f.result().items():
                        agg[k] = agg.get(k, 0) + v
                print(f"[fts] {agg['rows']:,} opinions indexed, {agg['unchanged']:,} unchanged ({time.time() - t0:.0f}s)", flush=True)
        for f in cf.as_completed(pending):
            for k, v in f.result().items():
                agg[k] = agg.get(k, 0) + v
    agg["seconds"] = round(time.time() - t0, 1)
    print(json.dumps(agg))


def status(rpc: Rpc) -> None:
    s = rpc.call("caselaw_status_v1", {})
    s["checked_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with open(os.path.join(BUILD, "load_status.json"), "w") as h:
        json.dump(s, h, indent=1)
    print(json.dumps(s, indent=1))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("cmd", choices=["objects", "courts", "cases", "fts", "status"])
    ap.add_argument("--build", default="")
    ap.add_argument("--parts", default="")
    ap.add_argument("--tiers", default="t1")
    ap.add_argument("--workers", type=int, default=3)
    a = ap.parse_args(argv)
    if a.cmd in ("cases", "fts") and not a.build:
        raise SystemExit("--build is required")
    if a.cmd == "objects":
        load_objects(Rpc())
    elif a.cmd == "courts":
        load_courts(Rpc())
    elif a.cmd == "cases":
        load_cases(a.build, [int(x) for x in a.parts.split(",") if x], a.workers)
    elif a.cmd == "fts":
        load_fts(a.build, [t for t in a.tiers.split(",") if t], a.workers)
    else:
        status(Rpc())
    return 0


if __name__ == "__main__":
    sys.exit(main())
