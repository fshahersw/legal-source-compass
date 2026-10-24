"""Download selected small CourtListener bulk files whole and unchanged (they are already bzip2-compressed).

    python3 -I -B fetch_bulk.py <inventory.json> <key> [<key> ...]

Each file is checked against the size and ETag in the bucket listing (single-part MD5 or S3 multipart ETag), then a
manifest line is appended to private/acq/clb_1026/bulk/_manifest.jsonl (url, path, sha256, bytes, etag, last_modified,
retrieved_at, http status, method). Large tables are never fetched here; they are streamed by the builders.
"""
from __future__ import annotations

import hashlib
import json
import os
import ssl
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "private", "acq", "clb_1026", "bulk")
BASE = "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/"
UA = "legal-source-compass research (contact: notreelai@gmail.com)"
CA = "/root/.ccr/ca-bundle.crt"
MAX_BYTES = 60_000_000


def multipart_etag(data: bytes, parts: int) -> str | None:
    for part in (8 << 20, 16 << 20, 5 << 20, 64 << 20, 100 << 20):
        if -(-len(data) // part) == parts:
            digests = b"".join(hashlib.md5(data[i:i + part]).digest() for i in range(0, len(data), part))
            return f"{hashlib.md5(digests).hexdigest()}-{parts}"
    return None


def etag_ok(data: bytes, etag: str) -> bool:
    if "-" in etag:
        return multipart_etag(data, int(etag.split("-")[1])) == etag
    return hashlib.md5(data).hexdigest() == etag


def main() -> None:
    inv = {o["key"]: o for o in json.load(open(sys.argv[1]))["items"]}
    os.makedirs(OUT, exist_ok=True)
    ctx = ssl.create_default_context(cafile=CA)
    for name in sys.argv[2:]:
        key = name if name.startswith("bulk-data/") else "bulk-data/" + name
        meta = inv[key]
        if meta["size"] > MAX_BYTES:
            raise SystemExit(f"{key} is {meta['size']:,} bytes: stream it instead")
        url = BASE + key
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=120, context=ctx) as r:
            status, data = r.status, r.read()
        retrieved = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        if len(data) != meta["size"] or not etag_ok(data, meta["etag"]):
            raise SystemExit(f"{key}: size or ETag does not match the listing")
        path = os.path.join(OUT, os.path.basename(key))
        with open(path + ".tmp", "wb") as h:
            h.write(data)
        os.replace(path + ".tmp", path)
        rec = {"url": url, "path": os.path.relpath(path, ROOT), "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "etag": meta["etag"],
               "last_modified": meta["last_modified"], "retrieved_at": retrieved, "http_status": status, "method": "GET"}
        with open(os.path.join(OUT, "_manifest.jsonl"), "a") as h:
            h.write(json.dumps(rec) + "\n")
        print(os.path.basename(key), f"{len(data):,}", rec["sha256"][:16], flush=True)
        time.sleep(1.0)


if __name__ == "__main__":
    main()
