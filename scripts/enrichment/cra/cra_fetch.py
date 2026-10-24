"""Polite fetcher for the class action research report stream (slug cra).

Every response is stored gzip-compressed under private/acq/cra/raw/<host>/<safe path>.gz and listed in
private/acq/cra/_manifest.jsonl with the sha256 of the original (uncompressed) bytes. One request per second per host,
a descriptive User-Agent, retries with backoff on transient errors, and nothing is fetched twice (the manifest is the
cache). A 403, 401 or a login/challenge page is recorded and never retried through another route.

    python3 -I -B scripts/enrichment/cra/cra_fetch.py <url> [<url> ...]
"""
from __future__ import annotations

import datetime as dt
import gzip
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = "/home/user/legal-source-compass"
ACQ = os.path.join(ROOT, "private", "acq", "cra")
RAW = os.path.join(ACQ, "raw")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")
UA = "legal-source-compass research (contact: notreelai@gmail.com)"
SPACING = 1.05
_last: dict[str, float] = {}


def safe_name(url: str) -> str:
    """Stable file name for a URL: host directory plus the path, query hashed."""
    p = urllib.parse.urlsplit(url)
    path = urllib.parse.unquote(p.path).strip("/") or "index"
    path = re.sub(r"[^A-Za-z0-9._/-]+", "_", path)
    if p.query:
        path += "__q_" + hashlib.sha256(p.query.encode()).hexdigest()[:10]
    return os.path.join(p.netloc, path) + ".gz"


def load_manifest() -> dict[str, dict]:
    out: dict[str, dict] = {}
    if os.path.exists(MANIFEST):
        for line in open(MANIFEST, encoding="utf-8"):
            if line.strip():
                row = json.loads(line)
                out[row["url"]] = row
    return out


def _wait(host: str) -> None:
    gap = time.time() - _last.get(host, 0.0)
    if gap < SPACING:
        time.sleep(SPACING - gap)
    _last[host] = time.time()


def fetch(url: str, manifest: dict[str, dict] | None = None, *, refetch: bool = False) -> dict:
    """Fetch one URL (unless already recorded with status 200) and return its manifest row."""
    manifest = manifest if manifest is not None else load_manifest()
    have = manifest.get(url)
    if have and have.get("status") == 200 and not refetch and os.path.exists(os.path.join(ROOT, have["path"])):
        return have
    host = urllib.parse.urlsplit(url).netloc
    row: dict = {"url": url, "method": "direct"}
    for attempt in range(4):
        _wait(host)
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                data = r.read()
                row.update(status=r.status, content_type=r.headers.get("Content-Type", ""), final_url=r.geturl())
            break
        except urllib.error.HTTPError as e:
            row.update(status=e.code, content_type=e.headers.get("Content-Type", "") if e.headers else "")
            data = b""
            if e.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(2 ** (attempt + 2))
                continue
            break
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            row.update(status=None, error=str(e)[:200])
            data = b""
            if attempt < 3:
                time.sleep(2 ** (attempt + 2))
                continue
            break
    row["retrieved_at"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if row.get("status") == 200 and data:
        rel = os.path.join("private", "acq", "cra", "raw", safe_name(url))
        full = os.path.join(ROOT, rel)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with gzip.open(full + ".tmp", "wb", compresslevel=9) as h:
            h.write(data)
        os.replace(full + ".tmp", full)
        row.update(path=rel, sha256=hashlib.sha256(data).hexdigest(), bytes=len(data))
    with open(MANIFEST, "a", encoding="utf-8") as h:
        h.write(json.dumps(row, sort_keys=True) + "\n")
    manifest[url] = row
    return row


def read(row: dict) -> bytes:
    """Original bytes of a fetched file, checked against the manifest sha256."""
    data = gzip.open(os.path.join(ROOT, row["path"]), "rb").read()
    if hashlib.sha256(data).hexdigest() != row["sha256"]:
        raise ValueError(f"sha256 mismatch for {row['url']}")
    return data


if __name__ == "__main__":
    m = load_manifest()
    for u in sys.argv[1:]:
        r = fetch(u, m)
        print(r.get("status"), r.get("bytes"), r.get("content_type", "")[:30], u)
