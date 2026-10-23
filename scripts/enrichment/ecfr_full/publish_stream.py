"""Publish a large streamed build (rows as JSON Lines) with the same checks as private/scratch/enrich/publish_build.py.

publish_build.py loads one JSON build file into memory and reads every stored row back at once; ecfr_sections_full
is about 1.5 GB of rows, so this publisher streams instead, batch by batch, keeping the same contract:

  python3 -I -B publish_stream.py <meta.json> [...]                       validate only (no network)
  . private/scratch/env.sh && python3 -I -B publish_stream.py --check <meta.json>      + read-only live check
  . private/scratch/env.sh && python3 -I -B publish_stream.py --publish <meta.json>    write

meta.json = {"dataset", "label", "listing_block", "summary", "rows_file", ...} as written by build_ecfr_full.py /
build_ecfr_versions.py; rows_file holds one corpus row per line.
Validation (every row): dataset id format; dataset and category equal the dataset; unique ids; no ordinal; a source_url
(http(s) or root-relative); a title; JSON round trip stable. Live check: an existing dataset is replaced only if this
script published it (catalog summary.published_by == "enrich/publish_stream"); nothing else is ever touched.
Publish: catalog row written not ready; the dataset's old rows deleted (own dataset only); rows inserted in order in
size-bounded batches with ordinals; every batch read back and compared field by field with what was sent; exact
count checked; catalog marked ready with the exact count. A receipt is written next to the meta file.
--resume-from N continues an interrupted publish at ordinal N (no delete; earlier batches were already read back).
Credentials come only from the environment (EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY); nothing secret is printed.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))

MARK = "enrich/publish_stream"
FULL = "dataset,id,category,state,title,source_url,ordinal,item,detail,text,filters"
MAX_ROWS = 300
MAX_BYTES = 6 * 1024 * 1024


def rows_of(meta: dict):
    path = os.path.join(ROOT, meta["rows_file"])
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                yield json.loads(line)


def validate(meta: dict) -> dict:
    ds = meta.get("dataset", "")
    problems: list[str] = []
    if not re.fullmatch(r"[a-z0-9_]{1,80}", ds or ""):
        problems.append(f"bad dataset id {ds!r}")
    for key in ("label", "listing_block", "summary", "rows_file"):
        if key not in meta:
            problems.append(f"missing {key}")
    ids: set[str] = set()
    digest = hashlib.sha256()
    n = 0
    for r in rows_of(meta):
        rid = r.get("id")
        if rid in ids:
            problems.append(f"duplicate id {rid}")
        ids.add(rid)
        if r.get("dataset") != ds or r.get("category") != ds:
            problems.append(f"{rid}: dataset/category is not {ds}")
        if "ordinal" in r:
            problems.append(f"{rid}: carries an ordinal")
        if not str(r.get("source_url") or "").startswith(("http://", "https://", "/")):
            problems.append(f"{rid}: no source_url")
        if not str(r.get("title") or "").strip():
            problems.append(f"{rid}: empty title")
        if json.loads(json.dumps(r)) != r:
            problems.append(f"{rid}: not JSON round-trip stable")
        digest.update((("\n" if n else "") + json.dumps(r, sort_keys=True)).encode())
        n += 1
        if len(problems) > 20:
            break
    if not n:
        problems.append("no rows")
    if meta.get("rows") is not None and meta["rows"] != n:
        problems.append(f"meta says {meta['rows']} rows, file has {n}")
    if problems:
        raise SystemExit(f"{ds}: not publishable:\n  " + "\n  ".join(problems[:25]))
    return {"dataset": ds, "rows": n, "sha256": digest.hexdigest()}


def _base():
    url = os.environ.get("EXTERNAL_SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("EXTERNAL_SUPABASE_KEY", "")
    if not url or not key:
        raise SystemExit("EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_KEY must be set")
    return url + "/rest/v1/", key


def call(method: str, path: str, body=None, prefer: str = "return=minimal", headers: dict | None = None, timeout: int = 300):
    base, key = _base()
    h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": prefer}
    if headers:
        h.update(headers)
    data = json.dumps(body).encode() if body is not None else None
    delay = 2.0
    for attempt in range(6):
        req = urllib.request.Request(base + path, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw else None, dict(resp.headers)
        except urllib.error.HTTPError as e:
            detail = e.read().decode()[:600]
            if e.code in (408, 429, 500, 502, 503, 504) and attempt < 5:
                time.sleep(delay)
                delay *= 2
                continue
            raise RuntimeError(f"{method} {path[:120]} -> {e.code}: {detail}") from None
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if attempt < 5:
                time.sleep(delay)
                delay *= 2
                continue
            raise RuntimeError(f"{method} {path[:120]} -> {e}") from None


def live_catalog(ds: str):
    rows, _ = call("GET", f"corpus_datasets?id=eq.{ds}&select=id,label,ready,imported_records,manifest_sha256,metadata")
    return rows[0] if rows else None


def count(ds: str) -> int:
    _, h = call("GET", f"corpus_records?select=id&dataset=eq.{ds}&limit=1", prefer="count=exact")
    return int(h["Content-Range"].split("/")[-1])


def batches(meta: dict, start: int):
    batch: list[dict] = []
    size = 0
    for ordinal, r in enumerate(rows_of(meta)):
        if ordinal < start:
            continue
        r["ordinal"] = ordinal
        n = len(json.dumps(r))
        if batch and (len(batch) >= MAX_ROWS or size + n > MAX_BYTES):
            yield batch
            batch, size = [], 0
        batch.append(r)
        size += n
    if batch:
        yield batch


def readback(ds: str, sent: list[dict]) -> list[str]:
    lo, hi = sent[0]["ordinal"], sent[-1]["ordinal"]
    rows, _ = call("GET", f"corpus_records?select={FULL}&dataset=eq.{ds}&ordinal=gte.{lo}&ordinal=lte.{hi}&order=ordinal.asc",
                   headers={"Range": f"0-{len(sent) + 10}"})
    bad = []
    back = {r["id"]: r for r in rows}
    for s in sent:
        b = back.get(s["id"])
        if b is None or json.loads(json.dumps(s)) != b:
            bad.append(s["id"])
    if len(rows) != len(sent):
        bad.append(f"<{len(rows)} stored for {len(sent)} sent>")
    return bad


def publish(meta_path: str, meta: dict, info: dict, resume: int) -> None:
    ds = info["dataset"]
    cat = live_catalog(ds)
    if cat and ((cat.get("metadata") or {}).get("summary") or {}).get("published_by") != MARK:
        raise SystemExit(f"{ds}: exists and was not published by this script; refusing to replace it")
    summary = {**meta["summary"], "published_by": MARK, "build_file": os.path.relpath(meta_path, ROOT),
               "rows_file": meta["rows_file"], "rows_sha256": meta.get("rows_sha256")}
    metadata = {"id": ds, "label": meta["label"], "ready": False, "listing": {**meta["listing_block"], "total": info["rows"]},
                "summary": summary}
    t0 = time.time()
    if resume == 0:
        call("POST", "corpus_datasets", [{"id": ds, "label": meta["label"], "ready": False, "expected_records": info["rows"],
                                          "imported_records": 0, "manifest_sha256": info["sha256"], "metadata": metadata}],
             prefer="return=minimal,resolution=merge-duplicates")
        if cat:
            call("DELETE", f"corpus_records?dataset=eq.{ds}")
    done = resume
    nb = 0
    for batch in batches(meta, resume):
        call("POST", "corpus_records", batch, prefer="return=minimal,resolution=merge-duplicates")
        bad = readback(ds, batch)
        if bad:
            raise SystemExit(f"{ds}: readback mismatch at ordinals {batch[0]['ordinal']}-{batch[-1]['ordinal']}: {bad[:5]}"
                             f" (resume with --resume-from {batch[0]['ordinal']})")
        done = batch[-1]["ordinal"] + 1
        nb += 1
        if nb % 50 == 0:
            print(json.dumps({"dataset": ds, "rows_written": done, "of": info["rows"], "minutes": round((time.time() - t0) / 60, 1)}), flush=True)
    stored = count(ds)
    if stored != info["rows"]:
        raise SystemExit(f"{ds}: {stored} rows stored, {info['rows']} expected")
    metadata["ready"] = True
    call("PATCH", f"corpus_datasets?id=eq.{ds}", {"ready": True, "imported_records": stored, "metadata": metadata})
    cat = live_catalog(ds)
    if not cat or not cat["ready"] or cat["imported_records"] != info["rows"] or cat["manifest_sha256"] != info["sha256"]:
        raise SystemExit(f"{ds}: catalog check failed after publish")
    receipt = {"dataset": ds, "records": stored, "manifest_sha256": cat["manifest_sha256"], "readback": "ok (every batch)",
               "batches": nb, "resumed_from": resume, "minutes": round((time.time() - t0) / 60, 1), "published_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    with open(meta_path.replace(".meta.json", ".publish_receipt.json"), "w") as fh:
        json.dump(receipt, fh, indent=1)
    print(json.dumps(receipt))


def main(argv: list[str]) -> None:
    mode = "publish" if "--publish" in argv else "check" if "--check" in argv else "validate"
    resume = int(argv[argv.index("--resume-from") + 1]) if "--resume-from" in argv else 0
    files = [a for a in argv if a.endswith(".meta.json")]
    if not files:
        raise SystemExit(__doc__)
    for f in files:
        path = os.path.abspath(f)
        meta = json.load(open(path))
        info = validate(meta)
        print(json.dumps({"file": path, **info}), flush=True)
        if mode == "validate":
            continue
        cat = live_catalog(info["dataset"])
        owner = ((cat or {}).get("metadata") or {}).get("summary", {}).get("published_by") if cat else None
        print(json.dumps({"dataset": info["dataset"], "live": bool(cat), "live_records": cat and cat.get("imported_records"),
                          "published_by": owner}), flush=True)
        if cat and owner != MARK:
            raise SystemExit(f"{info['dataset']}: exists and was not published by this script; refusing")
        if mode == "check":
            continue
        publish(path, meta, info, resume)
    if mode == "validate":
        print("validated; pass --check (read-only) or --publish")
    elif mode == "check":
        print("check ok; nothing written")


if __name__ == "__main__":
    main(sys.argv[1:])
