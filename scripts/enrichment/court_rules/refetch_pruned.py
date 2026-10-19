"""Re-fetch pruned PDFs (prune_raw.py) from their official URLs when a later step needs them again, checking that each
re-fetched file has the SHA-256 recorded at first retrieval.

  python3 -I -B scripts/enrichment/court_rules/refetch_pruned.py --used-by constitution [--dry-run]

A file whose bytes now differ is not stored under its old path; it is reported (hash_changed) so the step that needed it
can record that the publisher's file changed. Uses fetchlib (robots.txt, per-host pacing, manifest row per request).
"""
from __future__ import annotations

import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetchlib  # noqa: E402

LOG = os.path.join(fetchlib.ACQ, "_pruned.jsonl")


def main(argv):
    want = argv[argv.index("--used-by") + 1] if "--used-by" in argv else None
    dry = "--dry-run" in argv
    rows = [json.loads(line) for line in open(LOG, encoding="utf-8")]
    todo = []
    for r in rows:
        if want and not any(u.startswith(want + ":") for u in (r.get("used_by") or [])):
            continue
        if os.path.exists(os.path.join(fetchlib.ROOT, r["path"])):
            continue
        todo.append(r)
    total = sum(r["bytes"] for r in todo)
    print(json.dumps({"files": len(todo), "mb": round(total / 1048576, 1), "dry_run": dry}))
    if dry:
        return
    result = {"ok": 0, "hash_changed": [], "failed": []}
    for r in todo:
        try:
            status, body, headers = fetchlib.fetch(r["url"])
        except Exception as error:  # recorded, not raised: other files can still be re-fetched
            result["failed"].append({"path": r["path"], "error": str(error)[:200]})
            continue
        if status != 200:
            result["failed"].append({"path": r["path"], "error": f"HTTP {status}"})
            continue
        if hashlib.sha256(body).hexdigest() != r["sha256"]:
            result["hash_changed"].append(r["path"])
            # --accept-changed <path prefix>: publishers that generate the PDF on request (e.g. a timestamp inside the
            # file) never serve the same bytes twice; the new file is stored as a new retrieval with its own manifest row
            if not ("--accept-changed" in argv and r["path"].startswith(argv[argv.index("--accept-changed") + 1])):
                continue
        full = os.path.join(fetchlib.ROOT, r["path"])
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "wb") as handle:
            handle.write(body)
        fetchlib.record_manifest(r["url"], full, body, status, "refetch_after_prune", headers.get("X-Final-URL", r["url"]),
                                 headers.get("Content-Type", "") or "", stored_gzip=False)
        result["ok"] += 1
    print(json.dumps({"ok": result["ok"], "hash_changed": len(result["hash_changed"]), "failed": len(result["failed"]),
                      "examples": (result["hash_changed"] + [f["path"] + ": " + f["error"] for f in result["failed"]])[:10]}))


if __name__ == "__main__":
    main(sys.argv[1:])
