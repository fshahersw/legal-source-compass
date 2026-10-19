"""Polite fetch helper for official state statute publishers (state_statutes stream).

Every response is kept unchanged (gzip-compressed on disk) with a manifest line: url, path, sha256 of the raw
bytes, bytes, retrieved_at (UTC), HTTP status and method. Requests are rate limited per host, retried with
backoff on transient errors, and never sent to a commercial legal publisher.
"""
import datetime
import gzip
import hashlib
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

UA = "legal-source-compass research (contact: notreelai@gmail.com)"
COMMERCIAL = re.compile(r"lexis|westlaw|justia|casetext|findlaw|thomsonreuters|fastcase|vlex|casemine", re.I)
_last = {}
_lock = threading.Lock()


def _wait(host, interval):
    """Space request starts to one per `interval` seconds per host, across threads."""
    with _lock:
        now = time.monotonic()
        start = max(now, _last.get(host, 0.0) + interval)
        _last[host] = start
    if start > now:
        time.sleep(start - now)


def get(url, *, interval=1.0, retries=5, timeout=120):
    """GET raw bytes; returns (status, bytes). 404 returns (404, b"") without retrying."""
    host = urllib.parse.urlsplit(url).netloc
    if COMMERCIAL.search(host):
        raise ValueError(f"refusing commercial host {host}")
    last = None
    for attempt in range(retries):
        _wait(host, interval)
        request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return 404, b""
            last = f"HTTP {error.code}"
            if error.code not in (429, 500, 502, 503, 504):
                raise RuntimeError(f"{url}: {last}") from None
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            last = str(error)[:160]
        time.sleep(min(2 ** attempt * 2, 60))
    raise RuntimeError(f"{url}: gave up after {retries} attempts ({last})")


def store(manifest_path, out_path, url, status, body, method="urllib GET"):
    """Write body gzip-compressed to out_path and append a manifest entry; returns the entry."""
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(out_path, "wb", compresslevel=9) as handle:
        handle.write(body)
    entry = {
        "url": url,
        "path": str(out_path),
        "sha256": hashlib.sha256(body).hexdigest(),
        "bytes": len(body),
        "stored_bytes": out_path.stat().st_size,
        "retrieved_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": status,
        "method": method,
        "stored_as": "gzip of the unchanged response body",
    }
    with _lock, open(manifest_path, "a") as handle:
        handle.write(json.dumps(entry) + "\n")
    return entry


def load_manifest(manifest_path):
    """Latest manifest entry per url."""
    entries = {}
    path = Path(manifest_path)
    if path.exists():
        for line in path.read_text().splitlines():
            if line.strip():
                row = json.loads(line)
                entries[row["url"]] = row
    return entries


def read_raw(entry):
    """The unchanged response bytes of a manifest entry, checked against its sha256."""
    with gzip.open(entry["path"], "rb") as handle:
        body = handle.read()
    if hashlib.sha256(body).hexdigest() != entry["sha256"]:
        raise ValueError(f"sha256 mismatch for {entry['path']}")
    return body
