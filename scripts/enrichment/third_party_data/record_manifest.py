"""Append manifest lines for the verification artifacts (files made by this stream, not raw downloads) to private/acq/third_party_data/_manifest.jsonl.

A line is appended only when no line with the same path and sha256 exists, so re-running is idempotent.

Usage: python3 -I -B record_manifest.py
"""
import datetime
import hashlib
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "third_party_data")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")

FILES = [
    ("verification/firecrawl_checks.json", "Firecrawl MCP firecrawl_scrape reads of cited pages (ftc.gov and other hosts that block or bot-wall the sandbox); rendered answers recorded, raw bytes not retained"),
    ("verification/worksheet.json", "derived: deterministic match of a fixed-seed sample of SettleSignal records against the saved official pages (verify_sample.py)"),
    ("verification/verdicts.json", "derived: reviewer verdicts for the verification sample (write_verdicts.py), quoting the evidence read"),
    ("verification/catalog_spot_checks.json", "derived: reviewer readings of a fixed-seed sample of catalog entries (write_catalog_spot_checks.py)"),
]


def main():
    seen = set()
    with open(MANIFEST, encoding="utf-8") as handle:
        for raw in handle:
            if raw.strip():
                line = json.loads(raw)
                seen.add((line.get("path"), line.get("sha256")))
    added = 0
    with open(MANIFEST, "a", encoding="utf-8") as out:
        for rel, method in FILES:
            path = os.path.join(ACQ, rel)
            with open(path, "rb") as handle:
                body = handle.read()
            sha = hashlib.sha256(body).hexdigest()
            relpath = os.path.relpath(path, ROOT)
            if (relpath, sha) in seen:
                continue
            out.write(json.dumps({"url": "local://third_party_data/" + rel, "final_url": None, "path": relpath, "sha256": sha, "bytes": len(body),
                                  "retrieved_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "http_status": None,
                                  "content_type": "application/json", "method": method, "error": None}) + "\n")
            added += 1
    print("added", added)


if __name__ == "__main__":
    main()
