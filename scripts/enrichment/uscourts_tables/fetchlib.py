"""Polite, manifest-recording fetcher for www.uscourts.gov (stream uscourts_tables).

At most one request per second to the host (the stream brief's limit), retry with backoff on transient errors, a
User-Agent that names the project and the owner's approved contact address. Every successful response is stored
gzip-compressed under private/acq/uscourts_tables/<subdir>/ and recorded in _manifest.jsonl with its URL, sha256 of the
UNCOMPRESSED bytes (the bytes the server sent), byte counts, HTTP status, retrieval time (UTC) and headers that identify
the edition (Last-Modified, ETag, Content-Type). A stored file is reused without a request, so re-runs are offline.
A 403 or bot wall is never bypassed: the fetch returns the status and the caller reports it.
"""
import gzip
import hashlib
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ACQ = ROOT / "private" / "acq" / "uscourts_tables"
MANIFEST = ACQ / "_manifest.jsonl"
BASE = "https://www.uscourts.gov"
UA = "legal-source-compass research (contact: notreelai@gmail.com)"
MIN_INTERVAL = 1.05  # seconds between requests to the host: under 1 request per second
_lock = threading.Lock()
_last = {"t": 0.0}


def _wait():
    with _lock:
        now = time.monotonic()
        nxt = _last["t"] + MIN_INTERVAL
        if nxt > now:
            time.sleep(nxt - now)
        _last["t"] = time.monotonic()


def local_path(url, subdir):
    """Deterministic local path: <subdir>/<url path>[__query].gz (the query folded into the name)."""
    parsed = urllib.parse.urlparse(url)
    path = urllib.parse.unquote(parsed.path).strip("/") or "index"
    if parsed.query:
        path += "__" + re.sub(r"[^A-Za-z0-9._=-]+", "_", parsed.query)
    safe = "/".join(re.sub(r"[^A-Za-z0-9._()=-]+", "_", part) for part in path.split("/"))
    return ACQ / subdir / (safe + ".gz")


def manifest_entries():
    if not MANIFEST.exists():
        return []
    return [json.loads(line) for line in MANIFEST.read_text().splitlines() if line.strip()]


def _record(entry):
    with _lock:
        ACQ.mkdir(parents=True, exist_ok=True)
        with MANIFEST.open("a") as fh:
            fh.write(json.dumps(entry, sort_keys=True) + "\n")


def read_stored(path):
    return gzip.decompress(Path(path).read_bytes())


def fetch(url, subdir="files", attempts=4, method="direct urllib GET", force=False):
    """Return (status, bytes, stored_path). A stored copy is reused unless force is set."""
    target = local_path(url, subdir)
    if not force and target.exists() and target.stat().st_size > 0:
        return 200, read_stored(target), target
    status, data, headers = 0, b"", {}
    for attempt in range(attempts):
        _wait()
        try:
            request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(request, timeout=120) as response:
                status, data = response.status, response.read()
                headers = {k: response.headers.get(k) for k in ("Last-Modified", "ETag", "Content-Type")}
                break
        except urllib.error.HTTPError as error:
            status = error.code
            if error.code in (404, 403, 410):
                break
            if error.code == 429:
                time.sleep(30 * (attempt + 1))
                continue
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            status = 0
        time.sleep(2 * (attempt + 1))
    entry = {"url": url, "status": status, "method": method, "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    entry.update({k.lower().replace("-", "_"): v for k, v in headers.items() if v})
    if status == 200 and data:
        target.parent.mkdir(parents=True, exist_ok=True)
        blob = gzip.compress(data, compresslevel=9, mtime=0)
        target.write_bytes(blob)
        entry.update({"path": str(target.relative_to(ROOT)), "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "stored_bytes": len(blob)})
    _record(entry)
    return status, data, (target if status == 200 and data else None)


def sha256_of(data):
    return hashlib.sha256(data).hexdigest()
