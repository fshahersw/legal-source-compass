#!/usr/bin/env python3
"""Kansas recovery, step 1: rebuild the local cache from evidence already retained in the corpus.

Re-capturing the publisher is not needed: every Kansas page fetched by earlier runs is kept,
content-addressed, in private storage and listed in corpus_ingest.publisher_code_object_sources_v2.

  inventory  -> <work>/sources.jsonl   every (sha256, source_url, retrieved_at, run_id) record
  download   -> <work>/objects/<sha>   whole-object authenticated GET, sha256 + size checked;
                                        restartable (files already present and hash-correct are skipped)

Env: EXTERNAL_SUPABASE_URL, EXTERNAL_SUPABASE_SERVICE_ROLE_KEY (never printed).
"""
import argparse, hashlib, json, os, sys, time
from concurrent.futures import ThreadPoolExecutor
import requests

BUCKET = "corpus-originals"


def headers(profile=None):
    key = os.environ["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"]
    h = {"apikey": key}
    if not key.startswith("sb_"):
        h["Authorization"] = f"Bearer {key}"
    if profile:
        h["Accept-Profile"] = profile
    return h


def inventory(work, jur):
    url = os.environ["EXTERNAL_SUPABASE_URL"].rstrip("/")
    out, off = [], 0
    while True:
        r = requests.get(f"{url}/rest/v1/publisher_code_object_sources_v2", headers=headers("corpus_ingest"), timeout=120,
                         params={"jurisdiction": f"eq.{jur}", "select": "*", "order": "sha256,source_url",
                                 "offset": off, "limit": 1000})
        r.raise_for_status()
        rows = r.json()
        if not rows:
            break
        out += rows
        off += len(rows)
    with open(os.path.join(work, "sources.jsonl"), "w", encoding="utf-8") as f:
        for row in out:
            f.write(json.dumps(row, sort_keys=True) + "\n")
    print(json.dumps({"sources": len(out), "objects": len({r["sha256"] for r in out}),
                      "urls": len({r["source_url"] for r in out})}))


def ok(path, sha):
    if not os.path.isfile(path):
        return False
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest() == sha


def download(work, workers):
    url = os.environ["EXTERNAL_SUPABASE_URL"].rstrip("/")
    os.makedirs(os.path.join(work, "objects"), exist_ok=True)
    shas = sorted({json.loads(l)["sha256"] for l in open(os.path.join(work, "sources.jsonl"))})
    s = requests.Session()
    h = headers()

    def one(sha):
        path = os.path.join(work, "objects", sha)
        if ok(path, sha):
            return "cached"
        for attempt in range(5):
            try:
                r = s.get(f"{url}/storage/v1/object/authenticated/{BUCKET}/state-codes/sha256/{sha[:2]}/{sha}", headers=h, timeout=120)
            except requests.RequestException:
                time.sleep(2 ** attempt)
                continue
            if r.status_code == 200 and hashlib.sha256(r.content).hexdigest() == sha:
                with open(path + ".part", "wb") as f:
                    f.write(r.content)
                os.replace(path + ".part", path)
                return "downloaded"
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(2 ** attempt)
                continue
            return f"error {r.status_code}"
        return "error retries"

    tally = {}
    with ThreadPoolExecutor(workers) as ex:
        for sha, res in zip(shas, ex.map(one, shas)):
            tally[res] = tally.get(res, 0) + 1
            if res.startswith("error"):
                print("missing", sha, res, file=sys.stderr)
    print(json.dumps(tally))
    return 0 if not any(k.startswith("error") for k in tally) else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("step", choices=["inventory", "download"])
    ap.add_argument("--work", default="/tmp/ks/work")
    ap.add_argument("--jurisdiction", default="KS")
    ap.add_argument("--workers", type=int, default=24)
    a = ap.parse_args()
    os.makedirs(a.work, exist_ok=True)
    sys.exit(inventory(a.work, a.jurisdiction) if a.step == "inventory" else download(a.work, a.workers))
