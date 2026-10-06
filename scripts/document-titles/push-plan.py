#!/usr/bin/env python3
"""Drive public.corpus_admin_title_projection_v1 over PostgREST (service role from the environment). Requires database/contracts/document-titles-v1.sql
to be installed by the administrative role first. Dry by default: --execute is required to write anything.

  push-plan.py status
  push-plan.py plan   --plan plan.jsonl [--execute]      # open_run (idempotent) then plan in batches of 500
  push-plan.py apply  [--execute] [--batch 500]          # dry run unless --execute; loops until nothing is planned
  push-plan.py verify | rollback [--execute] | close
"""
import argparse, json, os, sys, time, urllib.error, urllib.request

URL = os.environ["EXTERNAL_SUPABASE_URL"].rstrip("/")
KEY = os.environ["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"]


def call(op, args=None):
    body = json.dumps({"p_op": op, "p_args": args or {}}).encode()
    last = None
    for attempt in range(6):
        try:
            req = urllib.request.Request(f"{URL}/rest/v1/rpc/corpus_admin_title_projection_v1", data=body,
                                         headers={"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            raise SystemExit(f"{op} failed: HTTP {e.code} {e.read()[:300].decode('utf-8', 'replace')}")
        except Exception as e:
            last = e
            time.sleep(min(2 ** attempt, 20))
    raise last


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["status", "plan", "apply", "verify", "rollback", "close"])
    ap.add_argument("--plan")
    ap.add_argument("--execute", action="store_true")
    ap.add_argument("--batch", type=int, default=500)
    a = ap.parse_args()
    if a.cmd in ("status", "verify"):
        print(json.dumps(call(a.cmd), indent=1))
    elif a.cmd == "close":
        print(json.dumps(call("close_run")))
    elif a.cmd == "rollback":
        print(json.dumps(call("rollback", {"dry": not a.execute})))
    elif a.cmd == "plan":
        rows = [json.loads(l) for l in open(a.plan) if l.strip()]
        if not a.execute:
            print(f"dry: {len(rows)} rows would be planned; pass --execute to open the run and plan them")
            return
        print(json.dumps(call("open_run")))
        total, rejected = 0, []
        for i in range(0, len(rows), 500):
            res = call("plan", {"rows": rows[i:i + 500]})
            total += res["planned"]
            rejected += res["rejected"]
        print(json.dumps({"planned": total, "rejected": len(rejected), "rejected_sample": rejected[:10]}))
    elif a.cmd == "apply":
        while True:
            res = call("apply", {"limit": a.batch, "dry": not a.execute})
            print(json.dumps(res), flush=True)
            if not a.execute or res["remaining_planned"] == 0 or (res["applied"] + res["skipped"]) == 0:
                break


if __name__ == "__main__":
    main()
