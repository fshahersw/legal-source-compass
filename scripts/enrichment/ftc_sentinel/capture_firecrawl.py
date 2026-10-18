"""Store a Firecrawl MCP scrape result (the tool-result JSON file, bytes unchanged) under private/acq/ftc_sentinel/firecrawl/.

ftc.gov answers this sandbox with an Akamai bot wall (HTTP 403 for curl, 404 for our User-Agent on every path,
including the home page), so FTC pages and PDFs are read through the Firecrawl MCP scrape tool. The tool-result
file it writes is kept exactly as returned; the manifest line records the requested URL, the Firecrawl scrape id,
cache state, page count and the sha256 of the stored bytes.

Usage: python3 -I -B capture_firecrawl.py TOOL_RESULT_FILE NAME URL
"""
import datetime as dt
import hashlib
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "ftc_sentinel")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")


def main(src, name, url):
    dst = os.path.join(ACQ, "firecrawl", name)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copyfile(src, dst)
    raw = open(dst, "rb").read()
    doc = json.loads(raw)
    meta = doc.get("metadata", {})
    if meta.get("statusCode") != 200:
        os.remove(dst)
        raise SystemExit(f"status {meta.get('statusCode')} for {url}")
    if url not in (meta.get("sourceURL"), meta.get("url")):
        os.remove(dst)
        raise SystemExit(f"capture is for {meta.get('sourceURL')}, not {url}")
    entry = {
        "url": url,
        "final_url": meta.get("url"),
        "path": os.path.relpath(dst, ROOT),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "bytes": len(raw),
        "retrieved_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": meta.get("statusCode"),
        "method": "Firecrawl MCP firecrawl_scrape (ftc.gov blocks this sandbox: Akamai 403/404); tool-result JSON stored unchanged",
        "content_type": meta.get("contentType"),
        "firecrawl": {k: meta.get(k) for k in ("scrapeId", "cacheState", "cachedAt", "numPages", "totalPages", "proxyUsed", "modifiedTime", "title")},
        "markdown_chars": len(doc.get("markdown") or ""),
    }
    with open(MANIFEST, "a") as man:
        man.write(json.dumps(entry) + "\n")
    print(json.dumps(entry))


if __name__ == "__main__":
    main(*sys.argv[1:4])
