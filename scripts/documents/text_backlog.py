"""Text-extraction backlog of the documents layer (release: documents-not-extracted-backlog, owner decision 2026-10-27).

documents_refresh_v1 marks a document 'not_extracted' when corpus_ingest.pdf_texts has no row for its sha256: the PDF is
stored and open, but its text was never extracted, so it is listed and cannot be searched or quoted. This tool writes the
extractor worklist for exactly those byte sets (plus, last, the byte sets of withheld_policy listings that have no text yet:
storing their text publishes nothing, see documents-text-backlog-v1.sql) and checks a run against it. It never writes to
the corpus itself.

  worklist --out F [--page N]           documents_text_backlog_v1 (read-only RPC) -> F (JSONL, priority order) + F.summary.json
  summary  --worklist F                  counts, bytes and the checksum of F, offline
  verify   --worklist F --staging DIR    extractor + loader receipts against F, offline; writes F.retry.jsonl; exit 1 until all stored

The checksum is md5 of the worklist's sha256 values sorted and joined by '\\n'; the dry-run SQL in the release packet
computes the same value from the database, so the file can be compared with what was measured.
Credentials (worklist only) come from the environment, exactly as scripts/documents/run_pipeline.py reads them.
Run from the repository root:  python -I -B scripts/documents/text_backlog.py <command> ...
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

RPC = "documents_text_backlog_v1"
SHA_LEN = 64
HEX = set("0123456789abcdef")
# extractor statuses that mean the text pass finished for a document (stored as-is; 'no_text'/'unreadable' become no_text_layer)
EXTRACTED = ("complete", "partial_ocr_pending", "no_text", "unreadable")
# loader results that are final for an unchanged record
FINAL_LOAD = ("stored", "not_open_scope", "unknown_object")


def is_sha(value) -> bool:
    return isinstance(value, str) and len(value) == SHA_LEN and set(value) <= HEX


def priority_key(row: dict) -> tuple:
    """Court MDL-page orders first (rank 1), then CourtListener (2), then DocketBird (3), then byte sets with a withheld_policy
    listing (4); newest filing first; then sha256."""
    latest = row.get("latest_filed") or ""
    # descending date without parsing: invert each digit of YYYY-MM-DD; a missing date sorts after every dated row
    inverted = "".join(chr(ord("9") - ord(c) + ord("0")) if c.isdigit() else c for c in latest) if latest else "~"
    return (int(row.get("rank") or 9), inverted, row["sha256"])


def order_rows(rows: list[dict]) -> tuple[list[dict], dict]:
    """Keeps rows the extractor can use, in priority order. Returns (kept, dropped_counts). A row is dropped when its
    sha256 is malformed or repeated, when it has no stored object, or when the database says it has no open association
    (the writer would refuse it anyway)."""
    seen: set[str] = set()
    kept: list[dict] = []
    dropped = {"bad_sha": 0, "duplicate": 0, "no_object": 0, "not_open": 0}
    for row in rows:
        sha = row.get("sha256")
        if not is_sha(sha):
            dropped["bad_sha"] += 1
            continue
        if sha in seen:
            dropped["duplicate"] += 1
            continue
        seen.add(sha)
        if not row.get("storage_key") or row.get("bytes") is None:
            dropped["no_object"] += 1
            continue
        if row.get("open") is False:
            dropped["not_open"] += 1
            continue
        kept.append(row)
    kept.sort(key=priority_key)
    return kept, dropped


def checksum(shas) -> str:
    return hashlib.md5("\n".join(sorted(shas)).encode("ascii")).hexdigest()


def summarize(rows: list[dict]) -> dict:
    by_rank: dict[str, dict] = {}
    by_source: dict[str, int] = {}
    by_collection: dict[str, int] = {}
    mdls: set[str] = set()
    for r in rows:
        bucket = by_rank.setdefault(str(r.get("rank")), {"shas": 0, "documents": 0, "bytes": 0})
        bucket["shas"] += 1
        bucket["documents"] += int(r.get("documents") or 1)
        bucket["bytes"] += int(r.get("bytes") or 0)
        for s in r.get("sources") or []:
            by_source[s] = by_source.get(s, 0) + 1
        for c in r.get("collections") or []:
            by_collection[c] = by_collection.get(c, 0) + 1
        mdls.update(r.get("mdls") or [])
    return {
        "shas": len(rows),
        "documents": sum(int(r.get("documents") or 1) for r in rows),
        "bytes": sum(int(r.get("bytes") or 0) for r in rows),
        "by_rank": dict(sorted(by_rank.items())),
        "shas_by_source": dict(sorted(by_source.items())),
        "shas_by_collection": dict(sorted(by_collection.items())),
        "mdls_listed": len(mdls),
        # held = a withheld_policy listing of the same bytes (rank 4): text is stored, not published, until that hold is decided
        "held_shas": sum(1 for r in rows if r.get("held")),
        "md5_sorted_sha_list": checksum(r["sha256"] for r in rows),
        "md5_not_extracted_only": checksum(r["sha256"] for r in rows if not r.get("held")),
    }


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    out = []
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue  # a torn last line after a crash
    return out


def last_by_sha(rows: list[dict], field: str) -> dict[str, str]:
    """The last receipt per sha256 wins (receipts are append-only)."""
    out: dict[str, str] = {}
    for r in rows:
        sha = r.get("sha256")
        if is_sha(sha) and isinstance(r.get(field), str):
            out[sha] = r[field]
    return out


def tally(worklist: list[dict], text_receipts: list[dict], load_receipts: list[dict]) -> dict:
    """Where every worklist sha256 stands. 'stored' = text is in corpus_ingest.pdf_texts; anything else needs a retry."""
    text = last_by_sha(text_receipts, "status")
    load = last_by_sha(load_receipts, "result")
    counts = {"worklist": len(worklist), "extracted": 0, "extract_failed": 0, "not_attempted": 0, "stored": 0,
              "load_refused": 0, "load_error": 0, "not_loaded": 0}
    by_status: dict[str, int] = {}
    retry: list[dict] = []
    for row in worklist:
        sha = row["sha256"]
        status = text.get(sha)
        result = load.get(sha)
        if status in EXTRACTED:
            counts["extracted"] += 1
            by_status[status] = by_status.get(status, 0) + 1
        elif status is None:
            counts["not_attempted"] += 1
        else:
            counts["extract_failed"] += 1
        if result == "stored":
            counts["stored"] += 1
            continue
        if result in ("not_open_scope", "unknown_object"):
            counts["load_refused"] += 1
        elif result is None:
            counts["not_loaded"] += 1
        else:
            counts["load_error"] += 1
        retry.append({**row, "text_status": status, "load_result": result})
    counts["extract_status"] = dict(sorted(by_status.items()))
    counts["complete"] = counts["stored"] == len(worklist)
    return {"counts": counts, "retry": retry}


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part")
    with tmp.open("w", encoding="utf-8", newline="\n") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")
    os.replace(tmp, path)


def fetch_backlog(call, page: int = 2000) -> list[dict]:
    """Pages the read-only RPC until it returns no rows. `call(fn, body)` is run_pipeline.rpc in production, a fake in tests."""
    rows: list[dict] = []
    after = ""
    while True:
        res = call(RPC, {"p_after": after, "p_limit": page})
        batch = (res or {}).get("rows") or []
        if not batch:
            return rows
        rows.extend(batch)
        last = (res or {}).get("last")
        if not is_sha(last) or last <= after:
            raise RuntimeError("backlog paging did not advance")
        after = last


CORPUS_URL = "https://xosqzzsnhxcyehcnirpa.supabase.co"


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    w = sub.add_parser("worklist")
    w.add_argument("--out", required=True, type=Path)
    w.add_argument("--page", type=int, default=2000)
    s = sub.add_parser("summary")
    s.add_argument("--worklist", required=True, type=Path)
    v = sub.add_parser("verify")
    v.add_argument("--worklist", required=True, type=Path)
    v.add_argument("--staging", required=True, type=Path)
    a = ap.parse_args(argv)
    if a.cmd == "worklist":
        # the worklist must come from corpussite: the extractor and the loader pin the same project
        if os.environ.get("EXTERNAL_SUPABASE_URL", "").strip().rstrip("/") != CORPUS_URL:
            print("WRONG_PROJECT_OR_URL_MISSING: EXTERNAL_SUPABASE_URL must be " + CORPUS_URL, file=sys.stderr)
            return 2
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from run_pipeline import rpc  # credentials from the environment; never printed

        raw = fetch_backlog(rpc, a.page)
        rows, dropped = order_rows(raw)
        write_jsonl(a.out, rows)
        report = {"fetched": len(raw), "dropped": dropped, **summarize(rows)}
        a.out.with_name(a.out.name + ".summary.json").write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")
        print(json.dumps(report, indent=1))
        return 0
    if a.cmd == "summary":
        print(json.dumps(summarize(read_jsonl(a.worklist)), indent=1))
        return 0
    rows = read_jsonl(a.worklist)
    result = tally(rows, read_jsonl(a.staging / "text-receipts.jsonl"), read_jsonl(a.staging / "load-receipts.jsonl"))
    write_jsonl(a.worklist.with_name(a.worklist.name + ".retry.jsonl"), result["retry"])
    print(json.dumps(result["counts"], indent=1))
    return 0 if result["counts"]["complete"] else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
