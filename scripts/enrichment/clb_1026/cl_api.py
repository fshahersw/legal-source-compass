"""Rate-limited CourtListener REST v4 client for this stream.

* The API key is read from private/scratch/secrets.env into this process only (court_rules/secrets_env.py) and sent as the
  Authorization header; it is never printed, logged or written.
* At most one request per second (MIN_INTERVAL), a hard per-run cap, and a 429 back-off that honours Retry-After.
* Every response body is kept unchanged (gzip) under private/acq/clb_1026/api/raw/<sha256>.json.gz with one manifest line
  (url without credentials, sha256 of the body, bytes, http status, retrieved_at UTC, method). A URL fetched before is served
  from that archive (the stored retrieval time is reused), so a rebuild never repeats a request.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment", "court_rules"))

API = "https://www.courtlistener.com/api/rest/v4/"
ACQ = os.path.join(ROOT, "private", "acq", "clb_1026", "api")
RAW = os.path.join(ACQ, "raw")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")
UA = "LegalSourceAtlas/1.0 (research; contact: notreelai@gmail.com)"
CA = "/root/.ccr/ca-bundle.crt"
MIN_INTERVAL = 2.6  # about 23 requests a minute: under 1/s and under the membership tier's 25/min
HOURLY_CAP = 280


def build_url(path: str, params: dict | list | None = None) -> str:
    """Absolute v4 URL with parameters in the given order (no credentials ever appear in it)."""
    url = API + path.lstrip("/")
    if params:
        items = params.items() if isinstance(params, dict) else params
        url += "?" + urllib.parse.urlencode(list(items), quote_via=urllib.parse.quote)
    return url


class Client:
    def __init__(self, max_requests: int = 50) -> None:
        import secrets_env  # noqa: PLC0415 - loaded only when a live client is built

        self._key = secrets_env.load("COURTLISTENER_API_KEY")
        self.max_requests = max_requests
        self.requests = 0
        self._last = 0.0
        self._ctx = ssl.create_default_context(cafile=CA)
        os.makedirs(RAW, exist_ok=True)
        self.index = load_index()
        # requests already made in the last hour (from the manifest), so separate runs share one hourly budget
        cutoff = time.time() - 3600
        self._stamps = sorted(t for t in (_epoch(r["retrieved_at"]) for r in load_all()) if t > cutoff)

    def get(self, url: str, method: str = "GET") -> dict:
        """{"url", "status", "retrieved_at", "sha256", "json"} for a v4 URL; archived responses are reused."""
        if not url.startswith(API):
            raise ValueError("only CourtListener v4 API URLs")
        if method not in ("GET", "OPTIONS"):
            raise ValueError("read-only methods only")
        hit = self.index.get((method, url))
        if hit and hit["http_status"] == 200:
            body = read_raw(hit["sha256"])
            return {"url": url, "status": 200, "retrieved_at": hit["retrieved_at"], "sha256": hit["sha256"], "json": json.loads(body), "cached": True}
        for attempt in range(6):
            if self.requests >= self.max_requests:
                raise RuntimeError(f"request cap {self.max_requests} reached")
            recent = [t for t in self._stamps if t > time.time() - 3600]
            if len(recent) >= HOURLY_CAP:
                time.sleep(recent[0] + 3600 - time.time() + 1)
            wait = MIN_INTERVAL - (time.time() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.time()
            self._stamps.append(self._last)
            self.requests += 1
            req = urllib.request.Request(url, method=method, headers={"Authorization": f"Token {self._key}", "User-Agent": UA, "Accept": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=90, context=self._ctx) as r:
                    status, body = r.status, r.read()
            except urllib.error.HTTPError as e:
                status, body = e.code, e.read()
                if status == 429 or status >= 500:
                    retry = e.headers.get("Retry-After")
                    delay = float(retry) if retry and retry.isdigit() else min(60, 5 * 2 ** attempt)
                    self._record(url, status, body, method)
                    time.sleep(delay)
                    continue
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                time.sleep(min(60, 5 * 2 ** attempt))
                last = e
                continue
            rec = self._record(url, status, body, method)
            return {"url": url, "status": status, "retrieved_at": rec["retrieved_at"], "sha256": rec["sha256"],
                    "json": json.loads(body) if status == 200 else None, "cached": False}
        raise RuntimeError(f"giving up on {url}")

    def _record(self, url: str, status: int, body: bytes, method: str = "GET") -> dict:
        sha = hashlib.sha256(body).hexdigest()
        path = os.path.join(RAW, sha + ".json.gz")
        if not os.path.exists(path):
            with gzip.open(path, "wb") as h:
                h.write(body)
        rec = {"url": url, "path": os.path.relpath(path, ROOT), "sha256": sha, "bytes": len(body), "http_status": status,
               "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "method": method}
        with open(MANIFEST, "a") as h:
            h.write(json.dumps(rec) + "\n")
        if status == 200:
            self.index[(method, url)] = rec
        return rec


def load_index() -> dict:
    """Latest successful manifest line per URL."""
    out = {}
    if os.path.exists(MANIFEST):
        for line in open(MANIFEST):
            rec = json.loads(line)
            if rec["http_status"] == 200:
                out[(rec.get("method", "GET"), rec["url"])] = rec
    return out


def load_all() -> list[dict]:
    return [json.loads(line) for line in open(MANIFEST)] if os.path.exists(MANIFEST) else []


def _epoch(stamp: str) -> float:
    import calendar

    return calendar.timegm(time.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ"))


def read_raw(sha: str) -> bytes:
    with gzip.open(os.path.join(RAW, sha + ".json.gz"), "rb") as h:
        body = h.read()
    if hashlib.sha256(body).hexdigest() != sha:
        raise RuntimeError(f"archived response {sha} does not match its hash")
    return body
