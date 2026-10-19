"""Delete acquired PDF files whose text has been extracted, keeping their official URL and SHA-256 so they can be re-fetched.

  python3 -I -B scripts/enrichment/court_rules/prune_raw.py [--dry-run]

A file is deleted only when it is a PDF (by its first bytes), its manifest row names the official URL and a SHA-256
that the stored bytes still match, and either the document or constitution built from it has its text rendering under
private/build/court_rules/text/ or no build input uses it. HTML and JSON pages (small, gzipped, used by the
verification's second path) are kept. Every deletion is logged in private/acq/court_rules/_pruned.jsonl.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetchlib  # noqa: E402

ROOT = fetchlib.ROOT
WORK = os.path.join(ROOT, "private", "build", "court_rules", "work")
LOG = os.path.join(fetchlib.ACQ, "_pruned.jsonl")


def has_text(rel: str | None) -> bool:
    return bool(rel) and (os.path.exists(os.path.join(ROOT, rel)) or os.path.exists(os.path.join(ROOT, rel + ".gz")))


def main(argv):
    dry = "--dry-run" in argv
    rows = {}
    for r in fetchlib.read_manifest():
        if r.get("http_status") == 200 and r.get("path"):
            rows[r["path"]] = r  # the latest row for a path wins
    uses = {}
    for d in fetchlib.load_json(os.path.join(WORK, "documents.json"))["documents"]:
        for key in ("raw_path", "text_source_path"):
            if d.get(key):
                uses.setdefault(d[key], []).append(("document", d["id"], has_text(d.get("text_path"))))
    for s in fetchlib.load_json(os.path.join(WORK, "constitutions.json"))["states"]:
        for f in s.get("files") or []:
            if f.get("path"):
                uses.setdefault(f["path"], []).append(("constitution", s["state"], has_text(s.get("text_path"))))
    deleted = kept = freed = 0
    reasons = {}
    log = [] if dry else open(LOG, "a", encoding="utf-8")
    for dirpath, _, names in os.walk(fetchlib.ACQ):
        for name in sorted(names):
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, ROOT)
            with open(full, "rb") as handle:
                head = handle.read(5)
            if head != b"%PDF-":
                continue
            row = rows.get(rel)
            used = uses.get(rel, [])
            why = None
            if not row or not row.get("url") or not row.get("sha256"):
                why = "no_manifest_url_or_hash"
            elif hashlib.sha256(fetchlib.load_raw(rel)).hexdigest() != row["sha256"]:
                why = "hash_differs_from_manifest"
            elif used and not all(u[2] for u in used):
                why = "text_not_extracted"
            if why:
                kept += 1
                reasons[why] = reasons.get(why, 0) + 1
                continue
            size = os.path.getsize(full)
            entry = {"path": rel, "url": row["url"], "sha256": row["sha256"], "bytes": size, "retrieved_at": row.get("retrieved_at"),
                     "used_by": [f"{u[0]}:{u[1]}" for u in used] or None, "pruned_at": fetchlib.utc_now()}
            if not dry:
                os.remove(full)
                log.write(json.dumps(entry, ensure_ascii=False) + "\n")
            deleted += 1
            freed += size
    if not dry:
        log.close()
    print(json.dumps({"dry_run": dry, "deleted": deleted, "freed_mb": round(freed / 1048576, 1), "kept_pdfs": kept, "kept_reasons": reasons}))


if __name__ == "__main__":
    main(sys.argv[1:])
