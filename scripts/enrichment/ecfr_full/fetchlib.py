"""Polite HTTP fetch helper for the ecfr_full stream.

Every saved response is kept under private/acq/ecfr_full/ (gzip-compressed, path ends in .gz) and recorded in
_manifest.jsonl: url, path, sha256 and bytes of the *uncompressed* response body, stored bytes, retrieved_at (UTC),
http status, content type, method. A deleted raw file can therefore be re-fetched and verified byte for byte.

Pacing: one request at a time per host, at least MIN_INTERVAL seconds apart (< 2 requests/s, the stream budget for
ecfr.gov, govinfo.gov and federalregister.gov). Retries with backoff on 429/5xx/network errors (Retry-After honoured).
Identifying User-Agent with the owner-supplied contact address. No credentials are used: the eCFR API, GovInfo bulk
data and the Federal Register API are keyless.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "ecfr_full")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")
USER_AGENT = "LegalSourceAtlas/1.0 (research; contact: notreelai@gmail.com)"
MIN_INTERVAL = 0.6

_last: dict[str, float] = {}
_locks: dict[str, threading.Lock] = {}
_guard = threading.Lock()
_mlock = threading.Lock()


def _context():
    bundle = os.environ.get("SSL_CERT_FILE") or "/root/.ccr/ca-bundle.crt"
    return ssl.create_default_context(cafile=bundle) if os.path.exists(bundle) else ssl.create_default_context()


CTX = _context()


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _lock(host: str) -> threading.Lock:
    with _guard:
        return _locks.setdefault(host, threading.Lock())


class FetchError(RuntimeError):
    def __init__(self, url: str, status: int, detail: str = ""):
        super().__init__(f"GET {url} -> {status} {detail[:200]}")
        self.status = status


def get(url: str, *, accept: str = "*/*", timeout: int = 900, tries: int = 6) -> tuple[int, bytes, str]:
    """GET with pacing and retries. Returns (status, uncompressed body, content type). Raises FetchError on 4xx."""
    host = urllib.parse.urlparse(url).netloc
    delay = 5.0
    for attempt in range(tries):
        with _lock(host):
            wait = _last.get(host, 0.0) + MIN_INTERVAL - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept, "Accept-Encoding": "gzip"})
            try:
                with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
                    body = r.read()
                    if (r.headers.get("Content-Encoding") or "").lower() == "gzip":
                        body = gzip.decompress(body)
                    _last[host] = time.monotonic()
                    return r.status, body, r.headers.get("Content-Type") or ""
            except urllib.error.HTTPError as e:
                _last[host] = time.monotonic()
                detail = ""
                try:
                    detail = e.read().decode("utf-8", "replace")
                except Exception:  # noqa: BLE001
                    pass
                if e.code in (429, 500, 502, 503, 504) and attempt < tries - 1:
                    retry_after = e.headers.get("Retry-After") if e.headers else None
                    pause = float(retry_after) if retry_after and retry_after.isdigit() else delay
                    time.sleep(min(pause, 300))
                    delay *= 2.5
                    continue
                raise FetchError(url, e.code, detail) from None
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
                _last[host] = time.monotonic()
                if attempt < tries - 1:
                    time.sleep(delay)
                    delay *= 2.5
                    continue
                raise FetchError(url, -1, str(e)) from None
    raise FetchError(url, -1, "retries exhausted")


def read_manifest() -> dict[str, dict]:
    """Latest manifest entry per relative path."""
    out: dict[str, dict] = {}
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding="utf-8") as fh:
            for line in fh:
                if line.strip():
                    e = json.loads(line)
                    out[e["path"]] = e
    return out


def save(url: str, rel: str, body: bytes, status: int, content_type: str, extra: dict | None = None) -> dict:
    """Store body gzip-compressed at private/acq/ecfr_full/<rel> (rel ends in .gz) and append a manifest entry."""
    assert rel.endswith(".gz")
    path = os.path.join(ACQ, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with gzip.open(tmp, "wb", compresslevel=6) as fh:
        fh.write(body)
    os.replace(tmp, path)
    entry = {
        "url": url,
        "path": rel,
        "sha256": sha256_hex(body),
        "bytes": len(body),
        "stored_bytes": os.path.getsize(path),
        "retrieved_at": utc_now(),
        "http_status": status,
        "content_type": content_type,
        "method": "GET (urllib, Accept-Encoding: gzip; body stored gzip-compressed, sha256 of the uncompressed body)",
    }
    if extra:
        entry.update(extra)
    with _mlock:
        with open(MANIFEST, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, sort_keys=True) + "\n")
    return entry


def load(rel: str) -> bytes:
    with gzip.open(os.path.join(ACQ, rel), "rb") as fh:
        return fh.read()


def exists(rel: str, manifest: dict[str, dict]) -> bool:
    e = manifest.get(rel)
    return bool(e) and os.path.exists(os.path.join(ACQ, rel))
