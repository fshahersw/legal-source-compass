"""Remove an acquired file whose source terms forbid storing it, and log the removal in _manifest.jsonl.

Usage: python3 -I -B withdraw.py <relative path under private/acq/enforcement_series> <reason>
"""
import hashlib
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "enforcement_series")


def main(rel, reason):
    path = os.path.join(ACQ, rel)
    body = open(path, "rb").read()
    os.remove(path)
    entry = {
        "path": os.path.relpath(path, ROOT),
        "sha256": hashlib.sha256(body).hexdigest(),
        "bytes": len(body),
        "removed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "action": "removed",
        "reason": reason,
    }
    with open(os.path.join(ACQ, "_manifest.jsonl"), "a") as out:
        out.write(json.dumps(entry) + "\n")
    print(json.dumps(entry))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
