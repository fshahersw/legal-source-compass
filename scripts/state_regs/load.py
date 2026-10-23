"""Load built state administrative code data into state_regs (database/contracts/state-regs-v1.sql). LEAD ONLY.

  . private/scratch/env.sh && python3 -I -B scripts/state_regs/load.py codes
  . private/scratch/env.sh && python3 -I -B scripts/state_regs/load.py state ST --run sample|full [--build ID] [--dry-run]
  . private/scratch/env.sh && python3 -I -B scripts/state_regs/load.py prune ST --build ID      (after a complete full run)

`codes` loads private/build/w1025_regs/codes.json (51 rows). `state` loads the state's nodes (nodes.jsonl.gz, else
nodes-sample.jsonl.gz) and then its rule shards (rules-sample.jsonl.gz, or every rules-full-NNNN.jsonl.gz listed in
report-full.json), in batches of at most ~1.5 MB per RPC call, then calls state_reg_finish_v1. Every call is an upsert;
re-running is safe (unchanged rows are not rewritten). Credentials only from EXTERNAL_SUPABASE_URL / _KEY.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

MAX_BATCH_BYTES = 1_500_000
MAX_BATCH_ROWS = 500


def rpc(name: str, body: dict):
    url = os.environ.get("EXTERNAL_SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("EXTERNAL_SUPABASE_KEY", "")
    if not url or not key:
        raise SystemExit("EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_KEY must be set")
    headers = {"apikey": key, "Content-Type": "application/json", "Accept": "application/json"}
    if not key.startswith("sb_"):
        headers["Authorization"] = f"Bearer {key}"
    data = json.dumps(body).encode()
    for attempt in range(5):
        req = urllib.request.Request(f"{url}/rest/v1/rpc/{name}", data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=300, context=lib.CTX) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as err:
            detail = err.read().decode()[:600]
            if err.code in (429, 500, 502, 503, 504) and attempt < 4:
                time.sleep(2 ** attempt * 2)
                continue
            raise RuntimeError(f"rpc {name} -> {err.code}: {detail}") from None


def batches(rows):
    cur, size = [], 0
    for r in rows:
        n = len(json.dumps(r, ensure_ascii=False))
        if cur and (size + n > MAX_BATCH_BYTES or len(cur) >= MAX_BATCH_ROWS):
            yield cur
            cur, size = [], 0
        cur.append(r)
        size += n
    if cur:
        yield cur


def state_files(st: str, run: str) -> tuple[str, list[str]]:
    base = os.path.join(lib.BUILD, st)
    nodes = os.path.join(base, "nodes.jsonl.gz")
    if not os.path.exists(nodes):
        nodes = os.path.join(base, "nodes-sample.jsonl.gz")
    if run == "sample":
        shards = [os.path.join(base, "rules-sample.jsonl.gz")]
    else:
        rep = json.load(open(os.path.join(base, "report-full.json")))
        shards = [os.path.join(base, s["file"]) for s in rep["shards"]]
    return nodes, [s for s in shards if os.path.exists(s)]


def load_state(st: str, run: str, build: str, dry: bool, delete_after: bool = False) -> None:
    nodes_path, shards = state_files(st, run)
    nodes = list(lib.read_jsonl_gz(nodes_path)) if os.path.exists(nodes_path) else []
    ids = {n["id"] for n in nodes}
    written = 0
    for b in batches(nodes):
        written += 0 if dry else rpc("state_reg_load_nodes_v1", {"p_build": build, "p_rows": b})
    print(json.dumps({"state": st, "nodes": len(nodes), "nodes_written": written, "file": os.path.relpath(nodes_path, lib.ROOT)}), flush=True)
    ordinal = 0
    totals = {"rows": 0, "written": 0, "unchanged": 0, "orphans": 0}
    for path in shards:
        rows = []
        for r in lib.read_jsonl_gz(path):
            r = dict(r, ordinal=ordinal)
            ordinal += 1
            if r.get("node_id") and r["node_id"] not in ids:
                totals["orphans"] += 1   # kept; the node appears once the full index is loaded
            rows.append(r)
        for b in batches(rows):
            res = {"rows": len(b), "written": 0, "unchanged": 0} if dry else rpc("state_reg_load_rules_v1", {"p_build": build, "p_rows": b})
            for k in ("rows", "written", "unchanged"):
                totals[k] += res[k]
        print(json.dumps({"state": st, "shard": os.path.basename(path), **totals}), flush=True)
        if delete_after and not dry and run == "full":
            os.remove(path)  # loaded and counted; report-full.json keeps its name, row count and sha256
    if not dry:
        print(json.dumps(rpc("state_reg_finish_v1", {"p_state": st})), flush=True)


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["codes", "state", "prune"])
    ap.add_argument("state", nargs="?")
    ap.add_argument("--run", choices=["sample", "full"], default="sample")
    ap.add_argument("--build")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--delete-after-load", action="store_true", help="full runs: remove each shard once loaded (disk)")
    a = ap.parse_args(argv)
    if a.command == "codes":
        rows = json.load(open(os.path.join(lib.BUILD, "codes.json")))
        print(json.dumps({"codes": len(rows), "written": None if a.dry_run else rpc("state_reg_load_codes_v1", {"p_rows": rows})}))
        return
    st = (a.state or "").upper()
    if len(st) != 2:
        raise SystemExit("state required")
    build = a.build or f"{st.lower()}-{a.run}-{lib.utc_now()[:10]}"
    if a.command == "prune":
        if not a.build:
            raise SystemExit("--build is required for prune")
        print(json.dumps(rpc("state_reg_prune_v1", {"p_state": st, "p_build": a.build})))
        return
    load_state(st, a.run, build, a.dry_run, a.delete_after_load)


if __name__ == "__main__":
    main(sys.argv[1:])
