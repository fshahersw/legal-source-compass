"""Seed the scheduled semantic refresh (database/contracts/semantic-refresh-v1.sql) from the batch build.

    cd <repo>
    python3 -I -B scripts/semantic/refresh_seed.py plan                                      # offline: what would be seeded
    . private/scratch/env.sh && python3 -I -B scripts/semantic/refresh_seed.py keys [--corpus ID ...] [--batch 5000]
    . private/scratch/env.sh && python3 -I -B scripts/semantic/refresh_seed.py usage [--confirm]

`keys` sends every shard row's (record_id, chunk_no, text_sha256, embed_sha256) of private/build/semantic/<dataset>/ (shard
files verified against the manifest's sha256 first) to semantic_refresh_seed_keys_v1, which stores the embed key only where
the stored passage has that text hash; so the refresh knows, without any request, which embed strings the index already
holds. Rerunnable (identical keys are left alone); progress in private/build/w1025_semantic/seed_progress.json.

`usage` seeds the token ledger with everything spent so far: tokens_used of private/build/semantic/usage.json (embed.py's
shared usage file) plus the refresh smoke check recorded in private/build/w1025_semantic/smoke_usage.json, as the single
'seed' row (replaced on a new call). Without that row the refresh embeds nothing. Prints the total; --confirm sends it.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import embed as em  # noqa: E402
import load as ld  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OWN = os.path.join(ROOT, "private", "build", "w1025_semantic")
PROGRESS = os.path.join(OWN, "seed_progress.json")
SMOKE = os.path.join(OWN, "smoke_usage.json")
USAGE = os.path.join(em.OUT, "usage.json")
DATASETS = ["us_code_sections", "ecfr_sections_full", "crs_reports", "congress_bills", "oversight_reports", "doj_oig_reports",
            "ftc_publications_index", "caselaw_scotus"]


def seed_rows(directory: str, shard: dict) -> list[dict]:
    rows = []
    for m, _vec in ld.iter_shard(directory, shard, verify=True):
        rows.append({"r": m["record_id"], "n": m["chunk_no"], "t": m["text_sha256"], "k": m["embed_sha256"]})
    return rows


def usage_total() -> dict:
    used = em.read_json(USAGE)["tokens_used"]
    smoke = em.read_json(SMOKE)["tokens"] if os.path.exists(SMOKE) else 0
    return {"usage_json_tokens_used": int(used), "smoke_tokens": int(smoke), "total": int(used) + int(smoke)}


def cmd_plan(args) -> int:
    for ds in args.corpus or DATASETS:
        m = em.read_json(os.path.join(em.OUT, ds, "manifest.json"))
        print(json.dumps({"dataset": ds, "shards": len(m["shards"]), "rows": sum(s["rows"] for s in m["shards"]), "status": m["status"]}))
    print(json.dumps({"usage": usage_total()}))
    return 0


def cmd_keys(args) -> int:
    rpc = ld.Rpc()
    done = em.read_json(PROGRESS) if os.path.exists(PROGRESS) else {}
    for ds in args.corpus or DATASETS:
        directory = os.path.join(em.OUT, ds)
        manifest = em.read_json(os.path.join(directory, "manifest.json"))
        totals = {"received": 0, "matched": 0, "written": 0, "unmatched": 0}
        for shard in manifest["shards"]:
            tag = f"{ds}/{shard['name']}"
            if done.get(tag) == shard["meta_sha256"]:
                continue
            rows = seed_rows(directory, shard)
            for i in range(0, len(rows), args.batch):
                r = rpc.call("semantic_refresh_seed_keys_v1", {"p_dataset": ds, "p_rows": rows[i : i + args.batch]})
                for k in totals:
                    totals[k] += int(r[k])
            done[tag] = shard["meta_sha256"]
            os.makedirs(OWN, exist_ok=True)
            em.atomic_write(PROGRESS, json.dumps(done, indent=1, sort_keys=True).encode())
        print(json.dumps({"dataset": ds, **totals}))
    return 0


def cmd_usage(args) -> int:
    u = usage_total()
    note = (f"batch build: private/build/semantic/usage.json tokens_used {u['usage_json_tokens_used']:,}"
            f" + refresh smoke check {u['smoke_tokens']:,}")
    print(json.dumps({**u, "note": note}))
    if not args.confirm:
        print("not sent (pass --confirm to seed the ledger)")
        return 0
    state = ld.Rpc().call("semantic_refresh_record_usage_v1", {"p_kind": "seed", "p_tokens": u["total"], "p_note": note})
    print(json.dumps(state))
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("plan")
    a.add_argument("--corpus", action="append", choices=DATASETS)
    b = sub.add_parser("keys")
    b.add_argument("--corpus", action="append", choices=DATASETS)
    b.add_argument("--batch", type=int, default=5000)
    c = sub.add_parser("usage")
    c.add_argument("--confirm", action="store_true")
    args = p.parse_args(argv)
    if getattr(args, "batch", 1) > 10000:
        raise SystemExit("--batch is at most 10000")
    return {"plan": cmd_plan, "keys": cmd_keys, "usage": cmd_usage}[args.cmd](args)


if __name__ == "__main__":
    raise SystemExit(main())
