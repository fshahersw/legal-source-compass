"""Shared paths, polite HTTP, raw-file manifest and corpus row helpers for the oversight stream.

Every fetch goes through `Fetcher.get`: a per-host minimum interval between request starts (oversight.gov
publishes `Crawl-delay: 5`, so that host is paced at 5.2 s), a descriptive User-Agent with the owner's contact
address, retries with backoff on 429/5xx/network errors, and no retry on 401/403 (a bot wall is reported, never
bypassed). Raw response bytes are kept unchanged (gzip-compressed) under private/acq/oversight/ and each file is
recorded in private/acq/oversight/_manifest.jsonl with its URL and sha256.
"""
import gzip
import hashlib
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
PRIVATE = os.path.join(ROOT, "private")
ACQ = os.path.join(PRIVATE, "acq", "oversight")
BUILD = os.path.join(PRIVATE, "build", "oversight")
SCRATCH = os.path.join(PRIVATE, "scratch", "enrich", "oversight")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")

CONTACT = "notreelai@gmail.com"
USER_AGENT = f"LegalSourceAtlas/1.0 (legal-source-compass research; contact: {CONTACT})"
NOT_RECORDED = "Not recorded"

# Seconds between request starts per host. oversight.gov: robots.txt Crawl-delay 5.
RATES = {
    "www.oversight.gov": 5.2,
    "oversight.gov": 5.2,
    "oig.justice.gov": 1.1,
    "www.osc.gov": 1.1,
    "www.justice.gov": 1.1,
    "catalog.archives.gov": 1.1,
}

_manifest_lock = threading.Lock()


def now_utc():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def rel(path):
    return os.path.relpath(path, ROOT)


def record_manifest(url, path, data, status, method="direct GET"):
    entry = {
        "url": url,
        "path": rel(path),
        "sha256": sha256(data),
        "bytes": len(data),
        "retrieved_at": now_utc(),
        "status": status,
        "method": method,
    }
    with _manifest_lock:
        os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
        with open(MANIFEST, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry) + "\n")
    return entry


def write_gz(path, data: bytes):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with gzip.open(tmp, "wb", compresslevel=6) as handle:
        handle.write(data)
    os.replace(tmp, path)


def read_gz(path) -> bytes:
    with gzip.open(path, "rb") as handle:
        return handle.read()


def load_jsonl(path):
    out = []
    if not os.path.exists(path):
        return out
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


class Blocked(Exception):
    """The host answered 401/403 or a bot wall; never retried or bypassed."""


class Fetcher:
    """Per-host polite fetcher. `rates` maps host -> minimum seconds between request starts."""

    def __init__(self, default_interval=1.1, rates=None, timeout=90, retries=5, extra_headers=None):
        self.default_interval = default_interval
        self.rates = dict(RATES if rates is None else rates)
        self.timeout = timeout
        self.retries = retries
        self.extra_headers = dict(extra_headers or {})
        self._next = {}
        self._lock = threading.Lock()
        self.stats = {"requests": 0, "retries": 0, "errors": 0}

    def _wait(self, host):
        interval = self.rates.get(host, self.default_interval)
        with self._lock:
            now = time.monotonic()
            start = max(now, self._next.get(host, 0.0))
            self._next[host] = start + interval
        delay = start - time.monotonic()
        if delay > 0:
            time.sleep(delay)

    def get(self, url, headers=None):
        """Return (status, body bytes, final url, response headers). Raises Blocked on 401/403."""
        host = urllib.parse.urlsplit(url).hostname or ""
        hdrs = {"User-Agent": USER_AGENT, "Accept-Encoding": "identity", **self.extra_headers, **(headers or {})}
        last = None
        for attempt in range(self.retries):
            self._wait(host)
            self.stats["requests"] += 1
            request = urllib.request.Request(url, headers=hdrs)
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    body = response.read()
                    return response.status, body, response.geturl(), dict(response.headers)
            except urllib.error.HTTPError as error:
                body = error.read() or b""
                if error.code in (401, 403):
                    raise Blocked(f"{error.code} {url}") from None
                if error.code in (404, 410, 400):
                    return error.code, body, url, dict(error.headers or {})
                last = f"HTTP {error.code}"
                retry_after = (error.headers or {}).get("Retry-After") if error.headers else None
                wait = min(120, float(retry_after)) if retry_after and str(retry_after).isdigit() else 2 ** (attempt + 2)
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as error:
                last = f"{type(error).__name__}: {error}"
                wait = 2 ** (attempt + 2)
            self.stats["retries"] += 1
            time.sleep(wait)
        self.stats["errors"] += 1
        raise RuntimeError(f"giving up on {url}: {last}")


def log(name, message):
    os.makedirs(SCRATCH, exist_ok=True)
    with open(os.path.join(SCRATCH, f"{name}.log"), "a", encoding="utf-8") as handle:
        handle.write(f"{now_utc()} {message}\n")
