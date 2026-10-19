"""Polite HTTP fetch helper for the court_locations stream.

Every response body is saved unchanged under private/acq/court_locations/ and recorded in _manifest.jsonl
(url, final_url, path, sha256, bytes, retrieved_at UTC, http status, method). At most two requests per second per host,
retry with exponential backoff on transient errors, robots.txt honoured, identifying User-Agent with the owner-supplied
contact address. Thread-safe (one lock per host for pacing, one for the manifest).
"""
from __future__ import annotations

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
ACQ = os.path.join(ROOT, "private", "acq", "court_locations")
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


def slug(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    tail = re.sub(r"[^A-Za-z0-9]+", "_", (parsed.path + ("_" + parsed.query if parsed.query else "")).strip("/"))[:60] or "index"
    digest = hashlib.sha1(url.encode()).hexdigest()[:8]
    return f"{tail}_{digest}"


def record_manifest(url: str, path: str, body: bytes, status: int, method: str, final_url: str = "", content_type: str = "", retrieved_at: str | None = None) -> dict:
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
        parser = urllib.robotparser.RobotFileParser()
        try:
            status, body, _ = fetch(f"{parsed.scheme}://{host}/robots.txt", f"robots/{host}.robots.txt", retries=1, check_robots=False, timeout=30, accept_statuses=(200, 404))
            if status == 200:
                parser.parse(body.decode("utf-8", "replace").splitlines())
            else:
                parser = None
        except Exception:
            parser = None
        with _guard:
            _robots[host] = parser
    parser = _robots[host]
    return True if parser is None else parser.can_fetch(USER_AGENT, url)


def fetch(url: str, rel_path: str | None = None, *, data: bytes | None = None, headers: dict | None = None,
          timeout: int = 60, retries: int = 3, save: bool = True, accept_statuses: tuple = (200,), check_robots: bool = True):
    """GET (or POST when data is given). Returns (status, body bytes, response headers incl. X-Final-URL). Saves body when rel_path is set."""
    if check_robots and not robots_allows(url):
        raise PermissionError(f"robots.txt disallows {url}")
    host = urllib.parse.urlparse(url).netloc
    hdrs = {"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,application/json,*/*;q=0.8"}
    if headers:
        hdrs.update(headers)
    last_error = None
    for attempt in range(retries + 1):
        with _host_lock(host):
            _pace(host)
        request = urllib.request.Request(url, data=data, headers=hdrs, method="POST" if data is not None else "GET")
        try:
            with urllib.request.urlopen(request, timeout=timeout, context=CTX) as response:
                body = response.read()
                status = response.status
                resp_headers = dict(response.headers)
                resp_headers["X-Final-URL"] = response.geturl()
        except urllib.error.HTTPError as error:
            body = error.read() if hasattr(error, "read") else b""
            status = error.code
            resp_headers = dict(error.headers or {})
            resp_headers["X-Final-URL"] = error.geturl() if hasattr(error, "geturl") else url
            if status in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(min(30, 2 ** attempt * 2))
                last_error = f"HTTP {status}"
                continue
        except (urllib.error.URLError, TimeoutError, ConnectionError, ssl.SSLError, OSError) as error:
            last_error = repr(error)
            if attempt < retries:
                time.sleep(min(30, 2 ** attempt * 2))
                continue
            raise RuntimeError(f"{url}: {last_error}") from None
        if save and rel_path and status in accept_statuses:
            path = os.path.join(ACQ, rel_path)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as handle:
                handle.write(body)
            record_manifest(url, path, body, status, "direct", resp_headers.get("X-Final-URL", url), resp_headers.get("Content-Type", ""))
        return status, body, resp_headers
    raise RuntimeError(f"{url}: {last_error}")
