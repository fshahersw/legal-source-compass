"""Register a file derived from an acquired file (for example an .xls converted to .csv) in _manifest.jsonl.

The derived file is stored under private/acq/enforcement_series/derived/ and its manifest line says which raw file (by path
and sha256) and which tool produced it, so the raw bytes stay unchanged and the derivation can be repeated.

Usage: python3 -I -B register_derived.py <derived file> <relative name under derived/> <raw path under acq/> "<tool and version>"
"""
import hashlib
import json
import os
import shutil
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "enforcement_series")


def main(src, name, raw_rel, tool):
    raw_path = os.path.join(ACQ, raw_rel)
    raw = open(raw_path, "rb").read()
    dest = os.path.join(ACQ, "derived", name)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copyfile(src, dest)
    body = open(dest, "rb").read()
    entry = {
        "url": None,
        "path": os.path.relpath(dest, ROOT),
        "sha256": hashlib.sha256(body).hexdigest(),
        "bytes": len(body),
        "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "http_status": None,
        "method": "derived: " + tool,
        "derived_from": {"path": os.path.relpath(raw_path, ROOT), "sha256": hashlib.sha256(raw).hexdigest()},
        "source_url": next((json.loads(l)["url"] for l in open(os.path.join(ACQ, "_manifest.jsonl")) if l.strip() and json.loads(l).get("path") == os.path.relpath(raw_path, ROOT)), None),
    }
    with open(os.path.join(ACQ, "_manifest.jsonl"), "a") as out:
        out.write(json.dumps(entry) + "\n")
    print(json.dumps(entry))


if __name__ == "__main__":
    main(*sys.argv[1:5])
