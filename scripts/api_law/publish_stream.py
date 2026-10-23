"""Publish a large api-law build (gzip JSONL rows + header) through scripts/enrichment/corpus_writer.py, streaming (lead only).

  python3 -I -B scripts/api_law/publish_stream.py <header.json> [...]                               validate only
  . private/scratch/env.sh && python3 -I -B scripts/api_law/publish_stream.py --check <header.json>   + read-only live check
  . private/scratch/env.sh && python3 -I -B scripts/api_law/publish_stream.py --publish <header.json>

A header is {"dataset", "label", "listing_block", "summary", "built_at", "inputs", "output": {"path", "rows", "sha256"}}
beside <dataset>.rows.jsonl.gz (rows exactly as corpus_writer.publish receives them, in dataset order). This is
corpus_writer.publish without holding every row in memory: the same catalog row (ready false while writing, then ready
with the stored count), the same manifest digest (sha256 of the rows' sort_keys JSON joined by newlines), ordinals 0..n-1
in file order, 500 rows a request. An existing dataset is replaced only when an api-law or enrich/publish_build build
published it; its old rows are deleted in ordinal ranges of 5,000 (no single long delete). After the write every stored
row is read back in ordinal order and compared with the file.
"""
import gzip
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "enrichment"))

MARK = "api_law/publish_stream"
ACCEPTED_OWNERS = {MARK, "enrich/publish_build"}
FULL = "dataset,id,category,state,title,source_url,ordinal,item,detail,text,filters"
BATCH = 500
DELETE_SPAN = 5000


def relative(path):
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def rows_of(path):
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def rows_path(header_path, header):
    return header_path.parent / f"{header['dataset']}.rows.jsonl.gz"


def validate(header_path):
    header = json.loads(header_path.read_text())
    problems = []
    ds = header.get("dataset", "")
    if not re.fullmatch(r"[a-z0-9_]{1,80}", ds or ""):
        problems.append(f"bad dataset id {ds!r}")
    for key in ("label", "listing_block", "summary"):
        if key not in header:
            problems.append(f"missing {key}")
    path = rows_path(header_path, header)
    if not path.exists():
        return header, path, [f"rows file {path} is missing"], None, 0
    seen = set()
    digest = hashlib.sha256()
    count = 0
    for row in rows_of(path):
        rid = row.get("id")
        if rid in seen:
            problems.append(f"duplicate id {rid}")
        seen.add(rid)
        if row.get("dataset") != ds or row.get("category") != ds:
            problems.append(f"{rid}: dataset/category is not {ds}")
        if "ordinal" in row:
            problems.append(f"{rid}: carries an ordinal")
        if not str(row.get("source_url") or "").startswith(("http://", "https://", "/")):
            problems.append(f"{rid}: no source_url")
        if not str(row.get("title") or "").strip():
            problems.append(f"{rid}: empty title")
        if re.search(r"[?&](api[_-]?key|apikey|access_token|token|key)=", json.dumps(row), re.I):
            problems.append(f"{rid}: carries a credential-like URL parameter")
        if json.loads(json.dumps(row)) != row:
            problems.append(f"{rid}: not JSON round-trip stable")
        digest.update(((b"\n") if count else b"") + json.dumps(row, sort_keys=True).encode())
        count += 1
        if len(problems) > 20:
            break
    if not count:
        problems.append("no rows")
    expected = (header.get("output") or {}).get("rows")
    if expected is not None and expected != count:
        problems.append(f"header says {expected} rows, file has {count}")
    return header, path, problems, digest.hexdigest(), count


def live_catalog(cw, ds):
    rows = cw._call("GET", f"corpus_datasets?id=eq.{ds}&select=id,label,ready,imported_records,manifest_sha256,metadata")
    return rows[0] if rows else None


def ordinal_bounds(cw, ds):
    lo = cw._call("GET", f"corpus_records?select=ordinal&dataset=eq.{ds}&order=ordinal.asc&limit=1") or []
    hi = cw._call("GET", f"corpus_records?select=ordinal&dataset=eq.{ds}&order=ordinal.desc&limit=1") or []
    return (lo[0]["ordinal"], hi[0]["ordinal"]) if lo and hi else (None, None)


def publish(cw, header, path, digest, count):
    ds = header["dataset"]
    summary = {**header["summary"], "published_by": MARK, "build_file": relative(path)}
    metadata = {"id": ds, "label": header["label"], "ready": False, "listing": {**header["listing_block"], "total": count}, "summary": summary}
    cw._call("POST", "corpus_datasets", [{"id": ds, "label": header["label"], "ready": False, "expected_records": count,
                                          "imported_records": 0, "manifest_sha256": digest, "metadata": metadata}],
             prefer="return=minimal,resolution=merge-duplicates")
    lo, hi = ordinal_bounds(cw, ds)
    if lo is not None:
        start = lo
        while start <= hi:
            cw._call("DELETE", f"corpus_records?dataset=eq.{ds}&ordinal=gte.{start}&ordinal=lt.{start + DELETE_SPAN}")
            start += DELETE_SPAN
        if cw._count(ds) != 0:
            raise SystemExit(f"{ds}: old rows remain after the ranged delete")
    batch, ordinal = [], 0
    for row in rows_of(path):
        row["ordinal"] = ordinal
        ordinal += 1
        batch.append(row)
        if len(batch) == BATCH:
            cw._call("POST", "corpus_records", batch, prefer="return=minimal,resolution=merge-duplicates")
            batch = []
    if batch:
        cw._call("POST", "corpus_records", batch, prefer="return=minimal,resolution=merge-duplicates")
    stored = cw._count(ds)
    if stored != count:
        raise SystemExit(f"{ds}: wrote {count} rows but {stored} are stored")
    metadata["ready"] = True
    cw._call("PATCH", f"corpus_datasets?id=eq.{ds}", {"ready": True, "imported_records": stored, "metadata": metadata})
    return stored


def readback(cw, ds, path):
    sent = rows_of(path)
    differ, n, after = [], 0, -1
    while True:
        page = cw._call("GET", f"corpus_records?select={FULL}&dataset=eq.{ds}&order=ordinal.asc&ordinal=gt.{after}&limit=1000")
        if not page:
            break
        for got in page:
            want = next(sent, None)
            got = {k: v for k, v in got.items() if k != "ordinal"}
            if want is None or {k: v for k, v in want.items()} != got:
                differ.append(got["id"])
            n += 1
        after = page[-1]["ordinal"]
    leftover = sum(1 for _ in sent)
    return n, differ, leftover


def main(argv):
    mode = "publish" if "--publish" in argv else "check" if "--check" in argv else "validate"
    files = [Path(a).absolute() for a in argv if not a.startswith("--")]
    if not files or any(a.startswith("--") and a not in ("--check", "--publish") for a in argv):
        raise SystemExit(__doc__)
    checked = []
    for f in files:
        header, path, problems, digest, count = validate(f)
        if problems:
            raise SystemExit(f"{f}: not publishable:\n  " + "\n  ".join(problems))
        checked.append((header, path, digest, count))
        print(json.dumps({"header": str(f), "dataset": header["dataset"], "rows": count, "sha256": digest}))
    if mode == "validate":
        print("validated; pass --check (read-only) or --publish")
        return
    import corpus_writer as cw  # credentials from the environment only

    for header, _, _, _ in checked:
        cat = live_catalog(cw, header["dataset"])
        owner = ((cat or {}).get("metadata") or {}).get("summary", {}).get("published_by")
        if cat and owner not in ACCEPTED_OWNERS:
            raise SystemExit(f"{header['dataset']}: exists and was published by {owner!r}; refusing to replace it")
        print(json.dumps({"dataset": header["dataset"], "live": bool(cat), "live_records": cat and cat.get("imported_records")}))
    if mode == "check":
        print("check ok; nothing written")
        return
    for header, path, digest, count in checked:
        ds = header["dataset"]
        stored = publish(cw, header, path, digest, count)
        n, differ, leftover = readback(cw, ds, path)
        cat = live_catalog(cw, ds)
        if n != count or differ or leftover or not cat or not cat["ready"] or cat["imported_records"] != count:
            raise SystemExit(f"{ds}: readback mismatch ({n} stored, {len(differ)} differ e.g. {differ[:3]}, {leftover} unsent; ready {cat and cat.get('ready')})")
        print(json.dumps({"dataset": ds, "records": stored, "manifest_sha256": digest, "readback": "ok"}))


if __name__ == "__main__":
    main(sys.argv[1:])
