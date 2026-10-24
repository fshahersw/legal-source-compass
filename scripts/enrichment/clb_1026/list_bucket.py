"""Inventory every object under bulk-data/ in CourtListener's public bulk-data bucket (S3 ListObjectsV2, paginated).

Writes the raw XML pages unchanged (gzip) plus a JSON inventory to private/acq/clb_1026/listing/, with a manifest line per page
(url, path, sha256 of the response bytes, bytes, retrieved_at, http status, method). Public bucket: no account, no key.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import ssl
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "private", "acq", "clb_1026", "listing")
BUCKET = "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/"
UA = "legal-source-compass research (contact: notreelai@gmail.com)"
CA = "/root/.ccr/ca-bundle.crt"
NS = "{http://s3.amazonaws.com/doc/2006-03-01/}"


def fetch(url: str) -> tuple[int, bytes]:
    ctx = ssl.create_default_context(cafile=CA)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60, context=ctx) as r:
        return r.status, r.read()


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    token = None
    page = 0
    objects = []
    manifest = []
    while True:
        params = {"list-type": "2", "prefix": "bulk-data/", "max-keys": "1000"}
        if token:
            params["continuation-token"] = token
        url = BUCKET + "?" + urllib.parse.urlencode(params)
        status, body = fetch(url)
        retrieved = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        page += 1
        path = os.path.join(OUT, f"list-{stamp}-p{page}.xml.gz")
        with gzip.open(path, "wb") as h:
            h.write(body)
        manifest.append({"url": url, "path": os.path.relpath(path, ROOT), "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body),
                         "retrieved_at": retrieved, "http_status": status, "method": "GET"})
        root = ET.fromstring(body)
        for c in root.findall(f"{NS}Contents"):
            objects.append({"key": c.findtext(f"{NS}Key"), "size": int(c.findtext(f"{NS}Size")), "last_modified": c.findtext(f"{NS}LastModified"),
                            "etag": (c.findtext(f"{NS}ETag") or "").strip('"'), "storage_class": c.findtext(f"{NS}StorageClass")})
        truncated = root.findtext(f"{NS}IsTruncated") == "true"
        token = root.findtext(f"{NS}NextContinuationToken")
        print(f"page {page}: {len(objects)} objects so far, truncated={truncated}", flush=True)
        if not truncated:
            break
        time.sleep(1.0)
    inv = {"bucket": BUCKET, "prefix": "bulk-data/", "listed_at": manifest[-1]["retrieved_at"], "pages": page, "objects": len(objects),
           "complete": True, "items": objects}
    with open(os.path.join(OUT, f"inventory-{stamp}.json"), "w") as h:
        json.dump(inv, h, indent=1)
    with open(os.path.join(OUT, "_manifest.jsonl"), "a") as h:
        for m in manifest:
            h.write(json.dumps(m) + "\n")
    print("wrote", len(objects), "objects", stamp)


if __name__ == "__main__":
    sys.exit(main())
