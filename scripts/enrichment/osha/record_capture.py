"""Append a manifest line for a page capture saved by hand from an MCP tool result (e.g. Firecrawl reads).

Usage: python3 -I -B scripts/enrichment/osha/record_capture.py <relative path under private/acq/osha> <source url> <method>
"""
import hashlib
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "osha")

rel, url, method = sys.argv[1], sys.argv[2], sys.argv[3]
path = os.path.join(ACQ, rel)
data = open(path, "rb").read()
entry = {"url": url, "path": os.path.relpath(path, ROOT), "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
         "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "status": 200, "method": method}
with open(os.path.join(ACQ, "_manifest.jsonl"), "a") as manifest:
    manifest.write(json.dumps(entry) + "\n")
print(json.dumps(entry))
