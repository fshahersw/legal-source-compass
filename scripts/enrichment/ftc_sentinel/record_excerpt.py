"""Append a manifest line for a hand-saved excerpt file (not a byte-identical capture).

Usage: python3 -I -B record_excerpt.py FILE URL NOTE [METHOD]
The manifest line is labelled method='transcribed excerpt' so nobody mistakes it for an unchanged capture.
"""
import datetime as dt
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
MANIFEST = os.path.join(ROOT, "private", "acq", "ftc_sentinel", "_manifest.jsonl")


def main(path, url, note, method="transcribed excerpt of a Firecrawl MCP firecrawl_scrape result (tool returned the page inline); not a byte-identical capture"):
    raw = open(path, "rb").read()
    entry = {
        "url": url,
        "final_url": url,
        "path": os.path.relpath(os.path.abspath(path), ROOT),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "bytes": len(raw),
        "retrieved_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": 200,
        "method": method,
        "content_type": "text/plain",
        "note": note,
    }
    with open(MANIFEST, "a") as handle:
        handle.write(json.dumps(entry) + "\n")
    print(json.dumps(entry))


if __name__ == "__main__":
    main(*sys.argv[1:5])
