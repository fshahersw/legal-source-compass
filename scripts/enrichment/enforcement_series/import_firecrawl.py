"""Record a Firecrawl MCP page read in the acquisition folder.

Used only for public HTML pages on hosts that bot-wall this sandbox (securities.stanford.edu answers 403 from a
Cloudflare challenge). Copies the Firecrawl JSON result unchanged to private/acq/enforcement_series/<rel> and appends a
_manifest.jsonl entry with method "Firecrawl MCP firecrawl_scrape (public HTML page read)".

Usage: python3 -I -B import_firecrawl.py <firecrawl result json file> <url> <relative/output/path>
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


def main(src, url, rel):
    dest = os.path.join(ACQ, rel)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copyfile(src, dest)
    body = open(dest, "rb").read()
    status = None
    try:
        status = json.loads(body).get("metadata", {}).get("statusCode")
    except (ValueError, AttributeError):
        pass
    entry = {
        "url": url,
        "path": os.path.relpath(dest, ROOT),
        "sha256": hashlib.sha256(body).hexdigest(),
        "bytes": len(body),
        "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "http_status": status,
        "method": "Firecrawl MCP firecrawl_scrape (public HTML page read; direct request answered 403 Cloudflare challenge)",
    }
    with open(os.path.join(ACQ, "_manifest.jsonl"), "a") as out:
        out.write(json.dumps(entry) + "\n")
    print(json.dumps(entry))


if __name__ == "__main__":
    main(*sys.argv[1:4])
