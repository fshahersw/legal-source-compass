"""Shared paths, polite HTTP and the acquisition manifest for the legislation stream.

Raw downloads live under private/acq/legislation/, build outputs under private/build/legislation/. Every response that is
kept is recorded as one JSON line in private/acq/legislation/_manifest.jsonl (url, path, sha256 of the exact bytes, bytes,
retrieved_at UTC, http status, method). Keys are sent only in request headers and never written to the manifest, logs or
files. Requests to one host are spaced by a per-host minimum interval (never more than 2 per second; Congress.gov API is
paced separately by congress_api.py).
"""
from __future__ import annotations

import gzip
import hashlib
import http.client
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
if not (ROOT / "private").exists():  # a worktree without the private symlink: use the main checkout's private tree
    ROOT = Path("/home/user/legal-source-compass")
ACQ = ROOT / "private" / "acq" / "legislation"
BUILD = ROOT / "private" / "build" / "legislation"
MANIFEST = ACQ / "_manifest.jsonl"
UA = "LegalSourceAtlas/1.0 (research; contact: notreelai@gmail.com)"
INTERVAL = {"www.govinfo.gov": 0.6, "api.congress.gov": 1.25, "data.openstates.org": 1.0, "open.pluralpolicy.com": 1.0}
DEFAULT_INTERVAL = 1.0
_lock = threading.Lock()
_last: dict[str, float] = {}


def now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def record(entry: dict, manifest: Path = MANIFEST) -> None:
    with _lock:
        manifest.parent.mkdir(parents=True, exist_ok=True)
        with manifest.open("a") as fh:
            fh.write(json.dumps(entry, sort_keys=True) + "\n")


def manifest_entries(manifest: Path = MANIFEST) -> list[dict]:
    if not manifest.exists():
        return []
    return [json.loads(line) for line in manifest.read_text().splitlines() if line.strip()]


def wait_host(host: str, interval: float | None = None) -> None:
    gap = INTERVAL.get(host, DEFAULT_INTERVAL) if interval is None else interval
    with _lock:
        last = _last.get(host, 0.0)
        now = time.monotonic()
        if last + gap > now:
            time.sleep(last + gap - now)
        _last[host] = time.monotonic()


def http_get(url: str, headers: dict | None = None, attempts: int = 6, timeout: int = 120, method: str = "GET",
             ok_status: tuple[int, ...] = (200,)) -> tuple[int, bytes, dict]:
    """GET (or HEAD) with per-host pacing and backoff on 429/5xx. Returns (status, body, headers); 404/410 are returned."""
    host = urllib.parse.urlparse(url).netloc
    status, body, hdrs = 0, b"", {}
    for attempt in range(attempts):
        wait_host(host)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})}, method=method)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, resp.read() if method != "HEAD" else b"", dict(resp.headers)
        except urllib.error.HTTPError as err:
            status, hdrs = err.code, dict(err.headers or {})
            if err.code in (429, 500, 502, 503, 504) and attempt < attempts - 1:
                retry = hdrs.get("Retry-After")
                pause = float(retry) if retry and retry.isdigit() else min(300, 10 * 2 ** attempt)
                time.sleep(pause)
                continue
            return status, b"", hdrs
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException) as err:
            if attempt < attempts - 1:
                time.sleep(min(120, 5 * 2 ** attempt))
                continue
            raise RuntimeError(f"{method} {url} failed: {type(err).__name__}") from None
    return status, body, hdrs


def download(url: str, dest: Path, method: str = "direct urllib GET (streamed to disk)", chunk: int = 1 << 20) -> dict:
    """Stream one file to disk, hashing as it goes; records the manifest entry and returns it."""
    host = urllib.parse.urlparse(url).netloc
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(5):
        wait_host(host)
        h = hashlib.sha256()
        size = 0
        t0 = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=600) as resp, tmp.open("wb") as out:
                status = resp.status
                length = resp.headers.get("Content-Length")
                modified = resp.headers.get("Last-Modified")
                while True:
                    block = resp.read(chunk)
                    if not block:
                        break
                    h.update(block)
                    out.write(block)
                    size += len(block)
            if length and int(length) != size:
                raise ConnectionError(f"short read {size} of {length}")
            break
        except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
            if isinstance(err, urllib.error.HTTPError) and err.code not in (429, 500, 502, 503, 504):
                raise RuntimeError(f"GET {url} -> HTTP {err.code}") from None
            if attempt == 4:
                raise RuntimeError(f"GET {url} failed: {type(err).__name__}") from None
            time.sleep(min(120, 10 * 2 ** attempt))
    os.replace(tmp, dest)
    entry = {"url": url, "path": str(dest.relative_to(ROOT)), "sha256": h.hexdigest(), "bytes": size, "retrieved_at": now_utc(),
             "http_status": status, "method": method, "last_modified": modified, "seconds": round(time.time() - t0, 1)}
    record(entry)
    return entry


def keep_gz(url: str, body: bytes, dest: Path, status: int = 200, method: str = "direct urllib GET") -> dict:
    """Store a small response body gzip-compressed (decompressing gives the exact bytes) and record it."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.write_bytes(gzip.compress(body, 6))
    os.replace(tmp, dest)
    entry = {"url": url, "path": str(dest.relative_to(ROOT)), "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body),
             "retrieved_at": now_utc(), "http_status": status, "method": method + " (stored gzip-compressed)"}
    record(entry)
    return entry


def sha256_file(path: Path) -> tuple[str, int]:
    h = hashlib.sha256()
    n = 0
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
            n += len(block)
    return h.hexdigest(), n


def disk_free_gb(path: str = "/home/user") -> float:
    st = os.statvfs(path)
    return st.f_bavail * st.f_frsize / 1e9
