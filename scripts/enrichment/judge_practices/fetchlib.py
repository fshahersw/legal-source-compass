"""Polite HTTP fetching for the judge_practices stream (court websites, one request per second per court site).

Every request (robots.txt, listing pages, judge pages, documents; successful or not) is one line in
private/acq/judge_practices/_manifest.jsonl: url, final_url, status, bytes, sha256, retrieved_at (UTC), content type, kind, error.
The line count is the request count against the stream's budget (BUDGET). HTML bodies are kept unchanged and gzip-compressed under
private/acq/judge_practices/pages/<court site>/; the manifest sha256 is always the hash of the uncompressed response bytes.

Politeness rules enforced here, not left to callers:
  * robots.txt is fetched once per host and obeyed (a Crawl-delay above the base interval is honoured up to 10 s);
  * at most one request per MIN_INTERVAL seconds to one court site, across threads (a court site is the "<code>.uscourts.gov" label,
    so www., ecf. and apps. hosts of one court share one clock);
  * a 401/403 is recorded as blocked and never retried or worked around; 429/503 are retried at most twice, after Retry-After;
  * identifying User-Agent with the owner-supplied contact address.
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
from dataclasses import dataclass, field
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "judge_practices")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")
USER_AGENT = "legal-source-compass research (contact: notreelai@gmail.com)"
MIN_INTERVAL = 1.05
BUDGET = 15000
MAX_PAGE_BYTES = 5_000_000
MAX_DOC_BYTES = 60_000_000

BLOCK_MARKERS = re.compile(
    r"just a moment|attention required|cf-browser-verification|access denied|errors\.edgesuite\.net|akamai|incapsula|"
    r"request unsuccessful|pardon our interruption|are you a robot|captcha|bot detection", re.I)

_guard = threading.Lock()
_clock: dict[str, float] = {}
_locks: dict[str, threading.Lock] = {}
_robots: dict[str, "Robots"] = {}
_manifest_lock = threading.Lock()
_counter = {"n": None}


def _context():
    bundle = os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE") or "/root/.ccr/ca-bundle.crt"
    return ssl.create_default_context(cafile=bundle) if os.path.exists(bundle) else ssl.create_default_context()


CTX = _context()


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def pace_key(host: str) -> str:
    """One clock per court site: the label in front of uscourts.gov (www.cand.uscourts.gov, ecf.cand.uscourts.gov -> cand)."""
    host = host.lower().split(":")[0]
    m = re.match(r"^(?:[a-z0-9-]+\.)*?([a-z0-9-]+)\.uscourts\.gov$", host)
    if m and m.group(1) not in ("www",):
        return m.group(1)
    return host


def _lock_for(key: str) -> threading.Lock:
    with _guard:
        return _locks.setdefault(key, threading.Lock())


def request_count() -> int:
    with _manifest_lock:
        if _counter["n"] is None:
            n = 0
            if os.path.exists(MANIFEST):
                with open(MANIFEST, encoding="utf-8") as handle:
                    n = sum(1 for line in handle if line.strip())
            _counter["n"] = n
        return _counter["n"]


def _log(entry: dict) -> None:
    os.makedirs(ACQ, exist_ok=True)
    with _manifest_lock:
        if _counter["n"] is None:
            _counter["n"] = 0
            if os.path.exists(MANIFEST):
                with open(MANIFEST, encoding="utf-8") as handle:
                    _counter["n"] = sum(1 for line in handle if line.strip())
        with open(MANIFEST, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, sort_keys=True) + "\n")
        _counter["n"] += 1


def read_manifest() -> list[dict]:
    if not os.path.exists(MANIFEST):
        return []
    with open(MANIFEST, encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


class BudgetExhausted(RuntimeError):
    pass


@dataclass
class Result:
    url: str
    final_url: str = ""
    status: int | None = None
    body: bytes = b""
    ctype: str = ""
    headers: dict = field(default_factory=dict)
    error: str | None = None
    blocked: str | None = None   # "forbidden" | "robots" | "bot_wall" | None
    path: str | None = None      # stored copy (pages only)
    cached: bool = False
    sha256: str | None = None

    @property
    def ok(self) -> bool:
        return self.status == 200 and not self.blocked and self.error is None


class Robots:
    def __init__(self, parser: urllib.robotparser.RobotFileParser | None, delay: float, status: int | None):
        self.parser, self.delay, self.status = parser, delay, status

    def allows(self, url: str) -> bool:
        return True if self.parser is None else self.parser.can_fetch(USER_AGENT, url)


def _pace(key: str, interval: float) -> None:
    with _lock_for(key):
        now = time.monotonic()
        wait = _clock.get(key, 0.0) + interval - now
        if wait > 0:
            time.sleep(wait)
        _clock[key] = time.monotonic()


def _raw_get(url: str, *, timeout: int, max_bytes: int, interval: float, accept: str = "*/*") -> Result:
    """One paced GET. Redirects are followed by urllib. Logged in the manifest whatever the outcome."""
    if request_count() >= BUDGET:
        raise BudgetExhausted(f"request budget of {BUDGET} reached")
    host = urllib.parse.urlparse(url).netloc
    _pace(pace_key(host), interval)
    headers = {"User-Agent": USER_AGENT, "Accept": accept, "Accept-Language": "en-US,en;q=0.8"}
    result = Result(url=url)
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout, context=CTX) as response:
            result.status = response.status
            result.final_url = response.geturl()
            result.headers = dict(response.headers)
            result.body = response.read(max_bytes + 1)
    except urllib.error.HTTPError as error:
        result.status = error.code
        result.final_url = error.geturl() if hasattr(error, "geturl") else url
        result.headers = dict(error.headers or {})
        try:
            result.body = error.read(200_000)
        except Exception:  # noqa: BLE001
            result.body = b""
    except (urllib.error.URLError, TimeoutError, ConnectionError, ssl.SSLError, OSError) as error:
        result.error = type(error).__name__ + ": " + str(getattr(error, "reason", error))[:160]
    result.ctype = (result.headers.get("Content-Type") or "").split(";")[0].strip().lower()
    if len(result.body) > max_bytes:
        result.error = f"larger than {max_bytes} bytes; not stored"
        result.body = b""
    if result.status in (401, 403):
        result.blocked = "forbidden"
    elif result.status == 200 and "html" in result.ctype and BLOCK_MARKERS.search(result.body[:4000].decode("utf-8", "replace")) \
            and len(result.body) < 20000:
        result.blocked = "bot_wall"
    if result.body:
        result.sha256 = hashlib.sha256(result.body).hexdigest()
    return result


def _entry(result: Result, kind: str) -> dict:
    return {"url": result.url, "final_url": result.final_url or result.url, "status": result.status, "bytes": len(result.body),
            "sha256": result.sha256, "retrieved_at": utc_now(), "content_type": result.ctype, "kind": kind,
            "error": result.error, "blocked": result.blocked, "path": os.path.relpath(result.path, ROOT) if result.path else None}


def get(url: str, kind: str = "page", *, timeout: int = 45, retries: int = 2, max_bytes: int | None = None,
        interval: float | None = None, store: bool = True, accept: str = "*/*") -> Result:
    """GET with retries on transient failures (never on 401/403). HTML/text bodies are stored unchanged (gzip) when store=True."""
    max_bytes = max_bytes or (MAX_DOC_BYTES if kind == "document" else MAX_PAGE_BYTES)
    interval = interval or MIN_INTERVAL
    attempt = 0
    while True:
        result = _raw_get(url, timeout=timeout, max_bytes=max_bytes, interval=interval, accept=accept)
        transient = result.error is not None or result.status in (429, 500, 502, 503, 504)
        if store and result.ok and kind != "document":
            result.path = save_page(url, result.body)
        _log(_entry(result, kind))
        if result.blocked or not transient or attempt >= retries:
            return result
        attempt += 1
        wait = 0
        ra = result.headers.get("Retry-After", "")
        if ra.isdigit():
            wait = min(int(ra), 60)
        time.sleep(max(wait, 4 * attempt))


def slug(url: str, limit: int = 80) -> str:
    parsed = urllib.parse.urlparse(url)
    tail = re.sub(r"[^A-Za-z0-9.]+", "_", (parsed.path + ("_" + parsed.query if parsed.query else "")).strip("/"))[-limit:] or "index"
    return f"{tail.strip('_.')}_{hashlib.sha1(url.encode()).hexdigest()[:8]}"


def page_path(url: str) -> str:
    host = urllib.parse.urlparse(url).netloc
    return os.path.join(ACQ, "pages", pace_key(host), slug(url) + ".html.gz")


def save_page(url: str, body: bytes) -> str:
    path = page_path(url)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path, "wb", compresslevel=9) as handle:
        handle.write(body)
    return path


def cached_page(url: str) -> bytes | None:
    path = page_path(url)
    if os.path.exists(path):
        with gzip.open(path, "rb") as handle:
            return handle.read()
    return None


def get_page(url: str, *, refresh: bool = False, check_robots: bool = True, timeout: int = 45) -> Result:
    """A page body from the local store when it was fetched before (resume), else a polite fetch. robots.txt is obeyed."""
    if not refresh:
        body = cached_page(url)
        if body is not None:
            return Result(url=url, final_url=url, status=200, body=body, ctype="text/html", cached=True,
                          sha256=hashlib.sha256(body).hexdigest(), path=page_path(url))
    interval = MIN_INTERVAL
    if check_robots:
        robots = robots_for(url)
        if not robots.allows(url):
            return Result(url=url, status=None, blocked="robots", error="robots.txt disallows")
        interval = max(MIN_INTERVAL, robots.delay)
    return get(url, "page", timeout=timeout, interval=interval)


def robots_for(url: str) -> Robots:
    parsed = urllib.parse.urlparse(url)
    host = parsed.netloc
    with _guard:
        known = _robots.get(host)
    if known is not None:
        return known
    robots_url = f"{parsed.scheme}://{host}/robots.txt"
    body = cached_page(robots_url)
    status = 200 if body is not None else None
    if body is None:
        r = get(robots_url, "robots", timeout=30, retries=1, store=True)
        status = r.status
        body = r.body if r.status == 200 and not r.blocked else None
    parser, delay = None, 0.0
    if body and b"<html" not in body[:500].lower():
        parser = urllib.robotparser.RobotFileParser()
        text = body.decode("utf-8", "replace")
        parser.parse(text.splitlines())
        d = parser.crawl_delay(USER_AGENT) or parser.crawl_delay("*")
        delay = float(d) if d else 0.0
    robots = Robots(parser, min(delay, 10.0), status)
    with _guard:
        _robots[host] = robots
    return robots


def load_manifest_index() -> dict[str, dict]:
    """Latest manifest entry per requested URL."""
    out: dict[str, dict] = {}
    for e in read_manifest():
        out[e["url"]] = e
    return out
