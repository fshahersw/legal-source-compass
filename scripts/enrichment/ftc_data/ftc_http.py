"""Polite HTTP for the FTC open-data stream: per-host minimum interval, retries with backoff, raw bytes + manifest.

* ftc.gov and public.tableau.com: descriptive User-Agent with the owner's contact address, one request at a time per host,
  at least the host's robots.txt Crawl-delay between requests (ftc.gov 5 s, public.tableau.com 10 s). A 403 is a bot wall
  and is reported, never retried or bypassed.
* api.ftc.gov: observed 2026-10-23: the header allowance is 20,000 requests an hour, but a burst of about 50 requests within a minute
  (about 1 request a second) drew HTTP 429 with a Retry-After of 1,400 to 2,900 s, longer after repeated 429s. The default spacing is
  therefore 2 s between requests, and a Retry-After longer than 300 s stops the run (RateLimited) instead of waiting. The api.data.gov key (DATA_GOV_API_KEY, loaded from private secrets) is sent only in the X-Api-Key header,
  so no URL recorded in a manifest or in published provenance ever contains it. 429 and 5xx back off exponentially
  (Retry-After honoured); the hourly allowance is read from X-Ratelimit-Remaining and the fetcher slows down when it is low.
* Raw response bytes are stored unchanged under private/acq/ftc_data/ and recorded in _manifest.jsonl with URL, sha256,
  size, UTC time, HTTP status and method.
"""
import gzip
import hashlib
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "ftc_data")
BUILD = os.path.join(ROOT, "private", "build", "ftc_data")
SCRATCH = os.path.join(ROOT, "private", "scratch", "enrich", "ftc_data")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")

CONTACT = "notreelai@gmail.com"
USER_AGENT = f"LegalSourceAtlas/1.0 (legal-source-compass research; contact: {CONTACT})"
API_USER_AGENT = "LegalSourceAtlas/1.0 (research)"
API_HOST = "api.ftc.gov"

# seconds between request starts, per host (robots.txt Crawl-delay where one is published)
HOST_INTERVAL = {"www.ftc.gov": 5.0, "public.tableau.com": 10.0, "api.ftc.gov": 2.0}

_manifest_lock = threading.Lock()


def now_utc():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def rel(path):
    return os.path.relpath(path, ROOT)


def api_key():
    sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment", "court_rules"))
    import secrets_env  # noqa: E402

    return secrets_env.load("DATA_GOV_API_KEY")


def append_manifest(entry, path=MANIFEST):
    with _manifest_lock:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, sort_keys=True) + "\n")


def write_raw(path, data, gz=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if gz:
        with gzip.GzipFile(path, "wb", compresslevel=6, mtime=0) as handle:
            handle.write(data)
    else:
        with open(path, "wb") as handle:
            handle.write(data)


class FetchError(Exception):
    pass


class BotWall(FetchError):
    pass


class RateLimited(FetchError):
    """HTTP 429 with a Retry-After longer than the fetcher is willing to sleep: stop and resume after `retry_after` seconds."""

    def __init__(self, url, retry_after):
        super().__init__(f"HTTP 429 for {url}: retry after {retry_after} s")
        self.retry_after = retry_after


class Response:
    def __init__(self, url, status, headers, body, attempts):
        self.url, self.status, self.headers, self.body, self.attempts = url, status, headers, body, attempts

    @property
    def content_type(self):
        return self.headers.get("Content-Type", "")


class Fetcher:
    """One instance per process. Thread-safe: the per-host spacing is enforced under a lock."""

    def __init__(self, interval_override=None, max_attempts=6, timeout=120):
        self.interval = dict(HOST_INTERVAL)
        if interval_override:
            self.interval.update(interval_override)
        self.max_attempts = max_attempts
        self.timeout = timeout
        self._next_slot = {}
        self._lock = threading.Lock()
        self._key = None
        self.api_remaining = None
        self.rate = {}
        self.requests = 0
        self.retries = 0
        self.blocked_until = 0.0  # monotonic time before which no api request is sent
        self.max_sleep = 300

    def _wait(self, host):
        with self._lock:
            now = time.monotonic()
            slot = max(now, self._next_slot.get(host, 0.0))
            interval = self.interval.get(host, 1.0)
            if host == API_HOST and self.api_remaining is not None and self.api_remaining < 2500:
                interval = max(interval, 2.0)  # the hourly allowance is nearly spent: slow right down
            self._next_slot[host] = slot + interval
        delay = slot - time.monotonic()
        if delay > 0:
            time.sleep(delay)

    def get(self, url, headers=None):
        host = url.split("/")[2]
        hdrs = {"User-Agent": API_USER_AGENT if host == API_HOST else USER_AGENT, "Accept-Encoding": "identity"}
        if host == API_HOST:
            if self._key is None:
                self._key = api_key()
            hdrs["X-Api-Key"] = self._key
        hdrs.update(headers or {})
        last_error = None
        for attempt in range(1, self.max_attempts + 1):
            if host == API_HOST and time.monotonic() < self.blocked_until:
                wait_s = self.blocked_until - time.monotonic()
                if wait_s > self.max_sleep:
                    raise RateLimited(url, int(wait_s))
                time.sleep(wait_s)
            self._wait(host)
            self.requests += 1
            try:
                req = urllib.request.Request(url, headers=hdrs)
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    body = resp.read()
                    status, rh = resp.status, dict(resp.headers)
            except urllib.error.HTTPError as err:
                body, status, rh = err.read(), err.code, dict(err.headers)
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as err:
                last_error = repr(err)
                self.retries += 1
                time.sleep(min(60, 2 ** attempt))
                continue
            if host == API_HOST:
                try:
                    self.api_remaining = int(rh.get("X-Ratelimit-Remaining", self.api_remaining))
                except (TypeError, ValueError):
                    pass
                # What the gateway says about the key's allowance (a count and a header, no secret): kept for the run log.
                self.rate = {"limit": rh.get("X-Ratelimit-Limit"), "remaining": rh.get("X-Ratelimit-Remaining"), "status": status}
            if status == 403 and host != API_HOST:
                raise BotWall(f"HTTP 403 (bot wall) for {url}")
            if status == 429 or status >= 500:
                self.retries += 1
                wait = rh.get("Retry-After")
                try:
                    pause = float(wait) if wait else 0
                except ValueError:
                    pause = 0
                last_error = f"HTTP {status}"
                if status == 429 and host == API_HOST:
                    self.blocked_until = max(self.blocked_until, time.monotonic() + pause)
                    if pause > self.max_sleep:
                        raise RateLimited(url, int(pause))
                time.sleep(max(pause, min(300, 5 * 2 ** (attempt - 1))))
                continue
            return Response(url, status, rh, body, attempt)
        raise FetchError(f"{url}: gave up after {self.max_attempts} attempts ({last_error})")

    def fetch_to_file(self, url, path, method, gz=False, headers=None, manifest=MANIFEST, keep_non200=False):
        """GET url, store the unchanged bytes at path (optionally gzip), append a manifest entry; returns (entry, response)."""
        resp = self.get(url, headers=headers)
        entry = {
            "url": url,
            "path": rel(path),
            "sha256": sha256(resp.body),
            "bytes": len(resp.body),
            "retrieved_at": now_utc(),
            "status": resp.status,
            "method": method,
            "content_type": resp.content_type,
            "stored_gzip": gz,
        }
        if resp.status == 200 or keep_non200:
            write_raw(path, resp.body, gz=gz)
        else:
            entry["path"] = None
        append_manifest(entry, manifest)
        return entry, resp
