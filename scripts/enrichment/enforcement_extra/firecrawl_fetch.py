"""Fetch public FSIS pages through the Firecrawl scrape API (the sandbox's own requests get an Akamai 403).

Only public HTML pages and FSIS's own published documents are read; nothing is submitted. Requests are paced to at
most one per second. Each response is stored gzip-compressed under private/acq/enforcement_extra/fsis/ with a
manifest line (method: "Firecrawl scrape API (direct request blocked: HTTP 403 Akamai)").

  python3 -I -B firecrawl_fetch.py <url> <relative-dest> [rawHtml|markdown]

The API key is read from private/scratch/secrets.env (FIRECRAWL_API_KEY) into this process only; it is never printed.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

from common import ACQ, PRIVATE, manifest_append, utc_now

API = "https://api.firecrawl.dev/v1/scrape"
SECRETS = os.path.join(PRIVATE, "scratch", "secrets.env")
METHOD = "Firecrawl scrape API (direct request from the sandbox blocked: HTTP 403 Akamai)"
_last = [0.0]


def _key() -> str:
    if os.environ.get("FIRECRAWL_API_KEY"):
        return os.environ["FIRECRAWL_API_KEY"]
    with open(SECRETS, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("export "):
                line = line[7:].strip()
            k, _, v = line.partition("=")
            if k.strip() == "FIRECRAWL_API_KEY":
                os.environ["FIRECRAWL_API_KEY"] = v.strip().strip('"').strip("'")
                return os.environ["FIRECRAWL_API_KEY"]
    raise SystemExit("FIRECRAWL_API_KEY is not set")


def scrape(url: str, fmt: str = "rawHtml", *, parsers: list | None = None, attempts: int = 4) -> dict:
    body = {"url": url, "formats": [fmt], "onlyMainContent": False}
    if parsers:
        body["parsers"] = parsers
    data = json.dumps(body).encode()
    delay = 5.0
    for attempt in range(attempts):
        wait = _last[0] + 1.05 - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.monotonic()
        req = urllib.request.Request(API, data=data, method="POST", headers={
            "Authorization": "Bearer " + _key(), "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                out = json.loads(resp.read().decode())
        except urllib.error.HTTPError as err:
            if err.code in (408, 429, 500, 502, 503, 504) and attempt < attempts - 1:
                time.sleep(delay)
                delay *= 2
                continue
            raise RuntimeError(f"firecrawl {err.code} for {url}") from None
        if not out.get("success"):
            raise RuntimeError(f"firecrawl unsuccessful for {url}: {str(out)[:300]}")
        return out["data"]
    raise RuntimeError("unreachable")


def fetch(url: str, rel_dest: str, fmt: str = "rawHtml", *, parsers: list | None = None) -> dict:
    """Scrape url and store the returned content (exactly as returned) gzip-compressed with a manifest line."""
    data = scrape(url, fmt, parsers=parsers)
    content = data.get(fmt) or ""
    meta = data.get("metadata") or {}
    raw = content.encode("utf-8")
    dest = os.path.join(ACQ, "fsis", rel_dest)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with gzip.open(dest, "wb", compresslevel=6) as f:
        f.write(raw)
    entry = {
        "url": url,
        "path": os.path.relpath(dest, PRIVATE),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "bytes": len(raw),
        "stored_as": "gzip",
        "content": fmt,
        "origin_status": meta.get("statusCode"),
        "origin_content_type": meta.get("contentType"),
        "retrieved_at": utc_now(),
        "http_status": 200,
        "method": METHOD,
    }
    manifest_append(entry)
    return entry


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    print(json.dumps(fetch(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "rawHtml")))
