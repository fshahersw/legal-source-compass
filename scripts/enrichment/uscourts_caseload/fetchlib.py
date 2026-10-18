"""Polite, manifest-recording fetcher for www.uscourts.gov (stream uscourts_caseload).

Every response body is stored unchanged under private/acq/uscourts_caseload/ and one JSON line is appended to
private/acq/uscourts_caseload/_manifest.jsonl: url, path, sha256, bytes, retrieved_at (UTC), http status, method.
Requests are rate-limited to at most 2 per second per host and retried with backoff on transient errors.
A file already on disk is reused (no request) so re-runs are offline and deterministic.
"""
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
ACQ = ROOT / "private" / "acq" / "uscourts_caseload"
MANIFEST = ACQ / "_manifest.jsonl"
UA = "legal-source-compass research (Seeger Weiss internal research)"
MIN_INTERVAL = 0.6  # seconds between requests to one host (< 2 req/s)
_lock = threading.Lock()
_last = {}


def _wait(host):
    with _lock:
        now = time.monotonic()
        nxt = _last.get(host, 0) + MIN_INTERVAL
        if nxt > now:
            time.sleep(nxt - now)
        _last[host] = time.monotonic()


def local_path(url, subdir="files"):
    """Deterministic local path for a URL: <subdir>/<host path with / kept>, query folded into the name."""
    parsed = urllib.parse.urlparse(url)
    path = urllib.parse.unquote(parsed.path).lstrip("/") or "index"
    if path.endswith("/"):
        path += "index"
    if parsed.query:
        path += "__" + re.sub(r"[^A-Za-z0-9._-]+", "_", parsed.query)
    if "." not in path.rsplit("/", 1)[-1]:
        path += ".html"
    safe = "/".join(re.sub(r"[^A-Za-z0-9._()-]+", "_", part) for part in path.split("/"))
    return ACQ / subdir / parsed.netloc / safe


def manifest_entries():
    if not MANIFEST.exists():
        return []
    return [json.loads(line) for line in MANIFEST.read_text().splitlines() if line.strip()]


def _record(entry):
    with _lock:
        ACQ.mkdir(parents=True, exist_ok=True)
        with MANIFEST.open("a") as fh:
            fh.write(json.dumps(entry, sort_keys=True) + "\n")


def fetch(url, subdir="files", attempts=4, method="direct urllib GET"):
    """Return (status, bytes, path). Reuses a stored copy when present."""
    target = local_path(url, subdir)
    if target.exists() and target.stat().st_size > 0:
        return 200, target.read_bytes(), target
    host = urllib.parse.urlparse(url).netloc
    status, data = 0, b""
    for attempt in range(attempts):
        _wait(host)
        try:
            request = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(request, timeout=120) as response:
                status, data = response.status, response.read()
                break
        except urllib.error.HTTPError as error:
            status = error.code
            if error.code in (404, 403, 410):
                break
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            status = 0
        time.sleep(1.5 * (attempt + 1))
    entry = {"url": url, "status": status, "method": method, "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    if status == 200 and data:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        entry.update({"path": str(target.relative_to(ROOT)), "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)})
    _record(entry)
    return status, data, (target if status == 200 and data else None)


def sha256_of(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


LINK = re.compile(r'href="([^"#]+)"', re.I)


def links(html, base="https://www.uscourts.gov"):
    out = []
    for href in LINK.findall(html):
        url = urllib.parse.urljoin(base + "/", href.replace("&amp;", "&"))
        if url not in out:
            out.append(url)
    return out
