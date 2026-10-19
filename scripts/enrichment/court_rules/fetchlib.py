"""Polite HTTP fetch helper for the court_rules stream (adapted from scripts/enrichment/court_locations/fetchlib.py).

Every saved response body is kept unchanged under private/acq/court_rules/ and recorded in _manifest.jsonl
(url, final_url, path, sha256, bytes, retrieved_at UTC, http status, content type, method). At most two requests per
second per host (MIN_INTERVAL), retry with exponential backoff on transient errors, robots.txt honoured, identifying
User-Agent with the owner-supplied contact address. Thread-safe (one lock per host for pacing, one for the manifest).
Bodies of HTML/text responses may be stored gzip-compressed (path ends in .gz); the manifest sha256 is always the hash of
the uncompressed response bytes, so a re-fetch can be verified byte for byte.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "court_rules")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")
USER_AGENT = "legal-source-compass research (contact: notreelai@gmail.com)"
MIN_INTERVAL = 0.6  # seconds between requests to one host (< 2 req/s)

_last_hit: dict[str, float] = {}
_host_locks: dict[str, threading.Lock] = {}
_guard = threading.Lock()
_manifest_lock = threading.Lock()
_robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}


def _context():
    bundle = os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE") or "/root/.ccr/ca-bundle.crt"
    if os.path.exists(bundle):
        return ssl.create_default_context(cafile=bundle)
    return ssl.create_default_context()


CTX = _context()


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _host_lock(host: str) -> threading.Lock:
    with _guard:
        return _host_locks.setdefault(host, threading.Lock())


def _pace(host: str) -> None:
    now = time.monotonic()
    wait = _last_hit.get(host, 0.0) + MIN_INTERVAL - now
    if wait > 0:
        time.sleep(wait)
    _last_hit[host] = time.monotonic()


def slug(url: str, limit: int = 70) -> str:
    parsed = urllib.parse.urlparse(url)
    tail = re.sub(r"[^A-Za-z0-9.]+", "_", (parsed.path + ("_" + parsed.query if parsed.query else "")).strip("/"))[-limit:] or "index"
    digest = hashlib.sha1(url.encode()).hexdigest()[:8]
    return f"{tail.strip('_.')}_{digest}"


def read_manifest() -> list[dict]:
    if not os.path.exists(MANIFEST):
        return []
    with open(MANIFEST, encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def record_manifest(url: str, path: str, body: bytes, status: int, method: str, final_url: str = "", content_type: str = "",
                    retrieved_at: str | None = None, stored_gzip: bool = False) -> dict:
    entry = {
        "url": url,
        "final_url": final_url or url,
        "path": os.path.relpath(path, ROOT),
        "sha256": hashlib.sha256(body).hexdigest(),
        "bytes": len(body),
        "retrieved_at": retrieved_at or utc_now(),
        "http_status": status,
        "content_type": content_type,
        "method": method,
        "stored_gzip": stored_gzip,
    }
    os.makedirs(ACQ, exist_ok=True)
    with _manifest_lock:
        with open(MANIFEST, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, sort_keys=True) + "\n")
    return entry


def robots_allows(url: str) -> bool:
    """True when the host's robots.txt allows our user agent to fetch url (unreadable robots.txt means allowed)."""
    parsed = urllib.parse.urlparse(url)
    host = parsed.netloc
    with _guard:
        known = host in _robots
    if not known:
        parser: urllib.robotparser.RobotFileParser | None = urllib.robotparser.RobotFileParser()
        try:
            status, body, _ = fetch(f"{parsed.scheme}://{host}/robots.txt", f"robots/{host}.robots.txt", retries=1,
                                    check_robots=False, timeout=30, accept_statuses=(200,))
            if status == 200 and b"<html" not in body[:400].lower():
                parser.parse(body.decode("utf-8", "replace").splitlines())  # type: ignore[union-attr]
            else:
                parser = None
        except Exception:
            parser = None
        with _guard:
            _robots[host] = parser
    parser = _robots[host]
    return True if parser is None else parser.can_fetch(USER_AGENT, url)


def save_body(rel_path: str, body: bytes, gz: bool) -> str:
    path = os.path.join(ACQ, rel_path + (".gz" if gz else ""))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if gz:
        with gzip.open(path, "wb", compresslevel=9) as handle:
            handle.write(body)
    else:
        with open(path, "wb") as handle:
            handle.write(body)
    return path


def fetch(url: str, rel_path: str | None = None, *, data: bytes | None = None, headers: dict | None = None,
          timeout: int = 90, retries: int = 3, accept_statuses: tuple = (200,), check_robots: bool = True,
          gz: bool | None = None, max_bytes: int = 60_000_000):
    """GET (or POST when data is given). Returns (status, body bytes, response headers incl. X-Final-URL).

    Saves the body under rel_path when the status is accepted; gz=None compresses HTML/text/XML bodies automatically."""
    if check_robots and not robots_allows(url):
        raise PermissionError(f"robots.txt disallows {url}")
    host = urllib.parse.urlparse(url).netloc
    hdrs = {"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,application/pdf,application/json,*/*;q=0.8"}
    if headers:
        hdrs.update(headers)
    last_error = None
    for attempt in range(retries + 1):
        with _host_lock(host):
            _pace(host)
        request = urllib.request.Request(url, data=data, headers=hdrs, method="POST" if data is not None else "GET")
        try:
            with urllib.request.urlopen(request, timeout=timeout, context=CTX) as response:
                body = response.read(max_bytes + 1)
                status = response.status
                resp_headers = dict(response.headers)
                resp_headers["X-Final-URL"] = response.geturl()
        except urllib.error.HTTPError as error:
            body = error.read() if hasattr(error, "read") else b""
            status = error.code
            resp_headers = dict(error.headers or {})
            resp_headers["X-Final-URL"] = error.geturl() if hasattr(error, "geturl") else url
            if status in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(min(30, 2 ** attempt * 3))
                last_error = f"HTTP {status}"
                continue
        except (urllib.error.URLError, TimeoutError, ConnectionError, ssl.SSLError, OSError) as error:
            last_error = repr(error)
            if attempt < retries:
                time.sleep(min(30, 2 ** attempt * 3))
                continue
            raise RuntimeError(f"{url}: {last_error}") from None
        if len(body) > max_bytes:
            raise RuntimeError(f"{url}: larger than {max_bytes} bytes; not stored")
        if rel_path and status in accept_statuses:
            ctype = resp_headers.get("Content-Type", "") or ""
            use_gz = gz if gz is not None else bool(re.search(r"html|text|xml|json", ctype, re.I))
            path = save_body(rel_path, body, use_gz)
            record_manifest(url, path, body, status, "direct", resp_headers.get("X-Final-URL", url), ctype, stored_gzip=use_gz)
        return status, body, resp_headers
    raise RuntimeError(f"{url}: {last_error}")


def load_raw(path: str) -> bytes:
    """Read a stored raw body (transparently gunzipping .gz files)."""
    full = path if os.path.isabs(path) else os.path.join(ROOT, path)
    if full.endswith(".gz"):
        with gzip.open(full, "rb") as handle:
            return handle.read()
    with open(full, "rb") as handle:
        return handle.read()


def open_text(path: str):
    """Open a build/work text file for reading; when only its gzipped copy (<path>.gz) exists, read that instead."""
    full = path if os.path.isabs(path) else os.path.join(ROOT, path)
    if not os.path.exists(full) and os.path.exists(full + ".gz"):
        return gzip.open(full + ".gz", "rt", encoding="utf-8")
    return open(full, encoding="utf-8")


def load_json(path: str):
    with open_text(path) as handle:
        return json.load(handle)
