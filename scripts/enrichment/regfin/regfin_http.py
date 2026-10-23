"""Polite, manifest-writing HTTP for the regulatory-finance stream.

Every response body is stored unchanged (optionally gzip-compressed) under private/acq/regfin/ and recorded in
private/acq/regfin/_manifest.jsonl (url, path, sha256 of the response bytes, bytes, retrieved_at, http status, method).
Host politeness: SEC <= 4 requests/s overall (SEC fair-access limit is 10/s); every other host <= 1 request/s.
"""
import gzip
import hashlib
import json
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ACQ = ROOT / "private" / "acq" / "regfin"
MANIFEST = ACQ / "_manifest.jsonl"
USER_AGENT = "legal-source-compass research (contact: notreelai@gmail.com)"

_lock = threading.Lock()
_last = {}


def _interval(host):
    return 0.25 if host.endswith("sec.gov") else 1.0


def _throttle(host):
    with _lock:
        now = time.monotonic()
        slot = max(now, _last.get(host, 0.0) + _interval(host))
        _last[host] = slot
    wait = slot - now
    if wait > 0:
        time.sleep(wait)


def fetch(url, dest, *, gz=False, refresh=False, timeout=120, headers=None, method="direct", record_errors=True):
    """GET url, store the unchanged body at ACQ/dest (+.gz when gz) on HTTP 200, append a manifest row.

    Returns (status, body_bytes). A cached file (same dest) is returned without a request unless refresh=True.
    """
    path = ACQ / (dest + (".gz" if gz else ""))
    if path.exists() and not refresh:
        raw = path.read_bytes()
        return 200, (gzip.decompress(raw) if gz else raw)
    path.parent.mkdir(parents=True, exist_ok=True)
    host = url.split("/")[2]
    hdr = {"User-Agent": USER_AGENT, "Accept-Encoding": "identity"}
    hdr.update(headers or {})
    body, status = b"", 0
    for attempt in range(5):
        _throttle(host)
        req = urllib.request.Request(url, headers=hdr)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read()
                status = resp.status
            break
        except urllib.error.HTTPError as err:
            if err.code in (429, 500, 502, 503, 504) and attempt < 4:
                time.sleep(3 + 3**attempt)
                continue
            body = err.read()
            status = err.code
            break
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt < 4:
                time.sleep(3 + 3**attempt)
                continue
            raise
    row = {
        "url": url,
        "path": str(path.relative_to(ROOT)),
        "sha256": hashlib.sha256(body).hexdigest(),
        "bytes": len(body),
        "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "http_status": status,
        "method": method,
    }
    if status == 200:
        path.write_bytes(gzip.compress(body, 9) if gz else body)
    if status == 200 or record_errors:
        with _lock:
            with MANIFEST.open("a") as handle:
                handle.write(json.dumps(row) + "\n")
    return status, body
