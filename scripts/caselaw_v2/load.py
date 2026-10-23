"""Case law v2 step 7 (LEAD ONLY: writes production): load a run's rows through the RPCs of caselaw-v2.sql.

    python3 -I -B scripts/caselaw_v2/load.py plan   --run all                 # what would be sent (no network)
    python3 -I -B scripts/caselaw_v2/load.py load   --run all --build v2-1    # courts, objects, cases, attach, counts
    python3 -I -B scripts/caselaw_v2/load.py text   --run all --build v2-1 --scope prefix --prefix-words 1000 --tiers 4,5
    python3 -I -B scripts/caselaw_v2/load.py status

Order (each step checkpointed in <run>/load_state.json; a rerun skips finished steps, and every RPC is idempotent):
  1 courts   caselaw_load_courts_v2(rows/courts.json)
  2 objects  caselaw_load_objects_v1(rows/objects.jsonl) — only objects whose verified upload is recorded in
             <run>/objects.jsonl (state uploaded/already_present, readback_ok); anything else stops the load
  3 cases    caselaw_load_cases_v2(rows/cases-pNN.jsonl.gz), 1,000 rows per call
  4 attach   caselaw_attach_opinions_v2(rows/attach-uNN.jsonl.gz), 500 clusters per call
  5 counts   caselaw_refresh_court_counts_v2()
text: reads each object back from storage (whole object, sha256 checked), and sends every opinion's text with its
sha256 and star-page marker spans to caselaw_load_text_v2 (scope full|prefix), about 3 MB of text per call.
Credentials: EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY from the environment (source private/scratch/env.sh in the
same command); never printed.
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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import WORK, V2Error, now, read_json, read_jsonl, write_json  # noqa: E402

TEXT_BATCH_BYTES = 3_000_000


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
                r = self.s.post(f"{self.url}/rest/v1/rpc/{fn}", headers=self.h, data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                                timeout=300)
            except Exception as exc:  # noqa: BLE001 - network errors are retried
                if attempt + 1 == attempts:
                    raise V2Error(f"{fn}: network error {type(exc).__name__}") from exc
                time.sleep(delay)
                delay *= 2
                continue
            if r.status_code == 200:
                return r.json()
            if r.status_code in (408, 429, 500, 502, 503, 504, 520, 522, 524) and attempt + 1 < attempts:
                time.sleep(delay)
                delay *= 2
                continue
            raise V2Error(f"{fn} -> HTTP {r.status_code}: {r.text[:300]}")


def chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def verified_uploads(run_dir: str) -> dict[str, dict]:
    ok = {}
    for e in read_jsonl(os.path.join(run_dir, "objects.jsonl")):
        if e.get("state") in ("uploaded", "already_present", "replaced") and e.get("readback_ok"):
            ok[e["key"]] = e
    return ok


def plan(run_dir: str) -> dict:
    rows = os.path.join(run_dir, "rows")
    if not os.path.exists(os.path.join(rows, "rows_report.json")):
        raise V2Error("rows are missing: run rows.py first")
    objs = read_jsonl(os.path.join(rows, "objects.jsonl"))
    up = verified_uploads(run_dir)
    cases = sum(1 for p in glob.glob(os.path.join(rows, "cases-p*.jsonl.gz")) for _ in gzip.open(p, "rt"))
    attach = sum(1 for p in glob.glob(os.path.join(rows, "attach-u*.jsonl.gz")) for _ in gzip.open(p, "rt"))
    return {"courts": len(read_json(os.path.join(rows, "courts.json"))), "objects": len(objs),
            "objects_verified_in_storage": sum(1 for o in objs if o["key"] in up and up[o["key"]]["sha256"] == o["sha256"]),
            "case_rows": cases, "attach_rows": attach, "report": read_json(os.path.join(rows, "rows_report.json"))}


def cmd_load(a) -> int:
    run_dir = os.path.join(WORK, "runs", a.run)
    rows = os.path.join(run_dir, "rows")
    p = plan(run_dir)
    if p["objects_verified_in_storage"] != p["objects"]:
        raise V2Error(f"only {p['objects_verified_in_storage']} of {p['objects']} objects have a verified upload: run "
                      "opinions.py with --upload (or upload.py) first")
    state_path = os.path.join(run_dir, "load_state.json")
    st = read_json(state_path, {"build": a.build, "steps": {}})
    if st["build"] != a.build:
        raise V2Error(f"this run was loaded as build {st['build']}")
    rpc = Rpc()

    def done(step, info):
        st["steps"][step] = {"at": now(), **info}
        write_json(state_path, st)
        print(f"[load] {step}: {json.dumps(info)}", flush=True)

    if "courts" not in st["steps"]:
        n = sum(rpc.call("caselaw_load_courts_v2", {"p_rows": b}) for b in chunks(read_json(os.path.join(rows, "courts.json")), 2000))
        done("courts", {"rows": n})
    if "objects" not in st["steps"]:
        ids = {}
        for b in chunks(read_jsonl(os.path.join(rows, "objects.jsonl")), 2000):
            ids.update(rpc.call("caselaw_load_objects_v1", {"p_rows": b}))
        done("objects", {"registered": len(ids)})
    for path in sorted(glob.glob(os.path.join(rows, "cases-p*.jsonl.gz"))):
        step = "cases:" + os.path.basename(path)
        if step in st["steps"]:
            continue
        data = read_jsonl(path)
        n = 0
        pool = [Rpc() for _ in range(a.workers)]  # one HTTP session per thread
        with cf.ThreadPoolExecutor(max_workers=a.workers) as ex:
            calls = [ex.submit(pool[i % a.workers].call, "caselaw_load_cases_v2", {"p_build": a.build, "p_rows": b})
                     for i, b in enumerate(chunks(data, 1000))]
            for f in calls:
                n += f.result()
        done(step, {"rows": len(data), "changed": n})
    for path in sorted(glob.glob(os.path.join(rows, "attach-u*.jsonl.gz"))):
        step = "attach:" + os.path.basename(path)
        if step in st["steps"]:
            continue
        agg: dict = {}
        for b in chunks(read_jsonl(path), 500):
            for k, v in rpc.call("caselaw_attach_opinions_v2", {"p_build": a.build, "p_rows": b}).items():
                agg[k] = agg.get(k, 0) + v
        if agg.get("missing_case"):
            raise V2Error(f"{path}: {agg['missing_case']} clusters have no case row (load the cases first)")
        done(step, agg)
    done("counts", {"courts_changed": rpc.call("caselaw_refresh_court_counts_v2", {})})
    print(json.dumps(rpc.call("caselaw_status_v2", {}), indent=1))
    return 0


def page_marker_spans(text: str, pages: list) -> list[list[int]]:
    out = []
    for label, _idx, off in pages:
        marker = f"*{label}"
        if isinstance(off, int) and 0 <= off and text.startswith(marker, off) and 2 <= len(marker) <= 24:
            out.append([off, len(marker)])
    return out


def text_batches(run_dir: str, tiers: set[int], st):
    import uuid

    up = verified_uploads(run_dir)
    objs = [o for o in read_jsonl(os.path.join(run_dir, "rows", "objects.jsonl")) if int(o["key"].split("/")[3][1:]) in tiers]
    batch, size = [], 0
    for o in objs:
        data = None
        local = os.path.join(run_dir, "staged", o["key"])
        if os.path.exists(local):
            data = open(local, "rb").read()
        else:
            if o["key"] not in up:
                raise V2Error(f"{o['key']}: no verified upload")
            r = st._retry(lambda: st.s.get(st._object_url(o["key"], True), headers=st.h, params={"read": uuid.uuid4().hex}, timeout=st.timeout))
            data = r.content if r.status_code == 200 else None
        if data is None or len(data) != o["bytes"] or hashlib.sha256(data).hexdigest() != o["sha256"]:
            raise V2Error(f"{o['key']}: object bytes do not match the manifest")
        pos = 0
        while pos < len(data):
            d = zlib.decompressobj(31)
            body = d.decompress(data[pos:]) + d.flush()
            pos = len(data) - len(d.unused_data)
            rec = json.loads(body.decode("utf-8"))
            batch.append({"opinion_id": rec["opinion_id"], "cluster_id": rec["cluster_id"], "text": rec["text"],
                          "text_sha256": rec["text_sha256"], "blank": page_marker_spans(rec["text"], rec.get("pages") or [])})
            size += len(rec["text"].encode("utf-8"))
            if size >= TEXT_BATCH_BYTES or len(batch) >= 1000:
                yield o["key"], batch
                batch, size = [], 0
    if batch:
        yield None, batch


def cmd_text(a) -> int:
    import store

    run_dir = os.path.join(WORK, "runs", a.run)
    tiers = {int(t) for t in a.tiers.split(",")}
    st = store.Storage()
    rpcs = [Rpc() for _ in range(a.workers)]
    agg: dict = {}
    t0 = time.time()
    with cf.ThreadPoolExecutor(max_workers=a.workers) as ex:
        pending = set()
        for i, (_key, b) in enumerate(text_batches(run_dir, tiers, st)):
            body = {"p_build": a.build, "p_scope": a.scope, "p_rows": b, "p_prefix_words": a.prefix_words}
            pending.add(ex.submit(rpcs[i % a.workers].call, "caselaw_load_text_v2", body))
            if len(pending) >= 2 * a.workers:
                fin, pending = cf.wait(pending, return_when=cf.FIRST_COMPLETED)
                for f in fin:
                    for k, v in f.result().items():
                        agg[k] = agg.get(k, 0) + v
                print(f"[text] {json.dumps(agg)} ({time.time() - t0:,.0f}s)", flush=True)
        for f in cf.as_completed(pending):
            for k, v in f.result().items():
                agg[k] = agg.get(k, 0) + v
    print(json.dumps(agg | {"seconds": round(time.time() - t0, 1)}))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan")
    p.add_argument("--run", required=True)
    ld = sub.add_parser("load")
    ld.add_argument("--run", required=True)
    ld.add_argument("--build", required=True)
    ld.add_argument("--workers", type=int, default=3)
    tx = sub.add_parser("text")
    tx.add_argument("--run", required=True)
    tx.add_argument("--build", required=True)
    tx.add_argument("--scope", choices=["full", "prefix"], required=True)
    tx.add_argument("--prefix-words", type=int, default=1000)
    tx.add_argument("--tiers", default="4,5,6,7")
    tx.add_argument("--workers", type=int, default=3)
    sub.add_parser("status")
    a = ap.parse_args()
    if a.cmd in ("load", "text") and not all(ch.isalnum() or ch in "._-" for ch in a.build):
        raise V2Error("--build must match ^[a-z0-9_.-]{1,40}$")
    if a.cmd == "plan":
        print(json.dumps(plan(os.path.join(WORK, "runs", a.run)), indent=1))
        return 0
    if a.cmd == "load":
        return cmd_load(a)
    if a.cmd == "text":
        return cmd_text(a)
    print(json.dumps(Rpc().call("caselaw_status_v2", {}), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
