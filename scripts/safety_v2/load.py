"""Load safety/1 builder chunks into the corpus through public.safety_load_v1 (THE LEAD RUNS THIS; workers never write).

  python3 -I scripts/safety_v2/load.py <build dir> [<build dir> ...] [--target T] [--dry-run] [--delete-loaded]
         [--confirm-neiss "2026-10-25 lead confirmed owner instruction"]

Each build dir holds chunks/*.jsonl.gz and chunks/index.jsonl (target, rows, sha256, opts per chunk). Chunks load in
dependency order (subjects before their series, records before their subject links); each call is one chunk. A ledger
<dir>/loaded.jsonl records every loaded chunk (file, sha256, the RPC's inserted/updated/unchanged/deleted), so a rerun
skips what is loaded. --delete-loaded removes a chunk file after its load succeeded (keeps the disk small while
streaming). Credentials: EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY from the environment only.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as c  # noqa: E402

ORDER = ["subjects", "mdl_subjects", "series", "series_patch", "breakdowns", "maude_reports",
         "nhtsa_complaints", "record_subjects", "neiss_cases", "cfpb_monthly", "cfpb_complaints", "osha_inspections",
         "osha_violations", "osha_accidents", "open_payments"]


def chunks(build_dirs, only=None):
    out = []
    for d in build_dirs:
        d = Path(d)
        for index in sorted(d.rglob("chunks/index.jsonl")):
            for line in index.read_text().splitlines():
                if not line.strip():
                    continue
                ch = json.loads(line)
                path = index.parent / ch["file"]
                if only and ch["target"] != only:
                    continue
                out.append((ORDER.index(ch["target"]), str(path), ch, index.parent.parent))
    out.sort(key=lambda t: (t[0], t[1]))
    return out


def rpc(body):
    url = os.environ["EXTERNAL_SUPABASE_URL"].rstrip("/") + "/rest/v1/rpc/safety_load_v1"
    key = os.environ["EXTERNAL_SUPABASE_KEY"]
    data = json.dumps(body).encode()
    for attempt in range(6):
        req = urllib.request.Request(url, data=data, method="POST", headers={
            "apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            detail = e.read().decode()[:800]
            if e.code in (429, 500, 502, 503, 504) and attempt < 5:
                time.sleep(2 ** attempt * 3)
                continue
            raise RuntimeError(f"safety_load_v1 -> {e.code}: {detail}") from None
        except urllib.error.URLError:
            if attempt < 5:
                time.sleep(2 ** attempt * 3)
                continue
            raise


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dirs", nargs="+")
    ap.add_argument("--target")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--delete-loaded", action="store_true")
    ap.add_argument("--confirm-neiss", default="")
    args = ap.parse_args()
    totals = {}
    for _, path, ch, build in chunks(args.dirs, args.target):
        ledger = Path(build) / "loaded.jsonl"
        done = set()
        if ledger.exists():
            done = {(x["file"], x["sha256"]) for x in map(json.loads, ledger.read_text().splitlines()) if x.get("ok")}
        if (ch["file"], ch["sha256"]) in done:
            continue
        if not Path(path).exists():
            print(json.dumps({"missing": path}))
            continue
        rows, sha = c.read_chunk(path)
        if sha != ch["sha256"] or len(rows) != ch["rows"]:
            raise SystemExit(f"{path}: sha256/rows differ from the index (got {sha}, {len(rows)} rows)")
        opts = dict(ch.get("opts") or {})
        if ch["target"] == "neiss_cases":
            if not args.confirm_neiss:
                print(json.dumps({"skipped": path, "reason": "NEISS case records are held; pass --confirm-neiss"}))
                continue
            opts["confirmed_by_lead"] = args.confirm_neiss
        if args.dry_run:
            print(json.dumps({"would_load": ch["file"], "target": ch["target"], "rows": len(rows)}))
            continue
        res = rpc({"p_target": ch["target"], "p_rows": rows, "p_opts": opts,
                   "p_meta": {"source": ch.get("source") or "", "part": ch["file"], "sha256": sha}})
        with open(ledger, "a") as f:
            f.write(json.dumps({"file": ch["file"], "sha256": sha, "ok": True, "result": res, "at": c.utc_now()}) + "\n")
        t = totals.setdefault(ch["target"], {"rows": 0, "inserted": 0, "updated": 0, "unchanged": 0, "deleted": 0})
        for k in t:
            t[k] += res.get(k, 0) if k != "rows" else len(rows)
        if args.delete_loaded:
            Path(path).unlink()
    print(json.dumps({"totals": totals}))


if __name__ == "__main__":
    main()
