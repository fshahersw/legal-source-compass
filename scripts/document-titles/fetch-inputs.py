#!/usr/bin/env python3
"""Read-only: snapshot the placeholder-titled records and their artifact rows through PostgREST (service role from the environment).

Writes to --out-dir: court_documents.jsonl (all rows of the dataset), court_documents_artifacts.json,
saved_pages_untitled.jsonl, uscourts_pages_untitled.jsonl. Nothing is written to the corpus.
"""
import argparse, json, os, time, urllib.error, urllib.parse, urllib.request

URL = os.environ["EXTERNAL_SUPABASE_URL"].rstrip("/")
KEY = os.environ["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"]


def get(path, params):
    q = urllib.parse.urlencode(params, safe="*.,()")
    last = None
    for attempt in range(8):
        try:
            req = urllib.request.Request(f"{URL}/rest/v1/{path}?{q}", headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.load(r)
        except Exception as e:
            last = e
            time.sleep(min(2 ** attempt, 30))
    raise last


def keyset(path, select, flt, order, page):
    after = None
    while True:
        conds = list(flt) + ([f"{order}.gt.{after}"] if after else [])
        params = {"select": select, "order": order + ".asc", "limit": page}
        if conds:
            params["and"] = "(" + ",".join(conds) + ")"
        rows = get(path, params)
        if not rows:
            return
        yield from rows
        after = rows[-1][order]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", required=True)
    a = ap.parse_args()
    os.makedirs(a.out_dir, exist_ok=True)
    cols = "id,title,source_url,category,state,filters,item,detail,text"
    n = 0
    with open(os.path.join(a.out_dir, "court_documents.jsonl"), "w") as f:
        for r in keyset("corpus_records", cols, ["dataset.eq.court_documents"], "id", 400):
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
            n += 1
    print("court_documents rows", n)
    arts = list(keyset("corpus_artifacts", "route,sha256,object_key,bytes,mime,filename,ready", ["route.like./supplement-files/court_documents/*"], "route", 1000))
    json.dump(arts, open(os.path.join(a.out_dir, "court_documents_artifacts.json"), "w"))
    print("court_documents artifacts", len(arts))
    for ds in ("saved_pages", "uscourts_pages"):
        n = 0
        with open(os.path.join(a.out_dir, f"{ds}_untitled.jsonl"), "w") as f:
            for r in keyset("corpus_records", cols, [f"dataset.eq.{ds}", "title.ilike.*untitled*"], "id", 100):
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
                n += 1
        print(ds, "placeholder rows", n)


if __name__ == "__main__":
    main()
