"""Polite, manifest-recording fetcher for the judiciary stream.

Every response body is kept byte-for-byte (gzip-compressed on disk when `gz=True`; decompressing gives the exact bytes)
under private/acq/judiciary/<subdir>/, and one JSON line is appended to private/acq/judiciary/_manifest.jsonl:
url, path, sha256 (of the uncompressed body), bytes, retrieved_at (UTC), http status, method.

A file already on disk is reused (no request), so re-runs are offline and deterministic. Requests to one host are
spaced by a per-host minimum interval (fjc.gov: 35 s, the owner's 2026-10-22 rule is at least 30 s; others <= 1.5/s).
Keys are sent only in request headers and never written to the manifest, logs or files.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if not (ROOT / "private").exists():  # running from a worktree: the private symlink lives in the worktree root
    ROOT = Path("/home/user/legal-source-compass")
ACQ = ROOT / "private" / "acq" / "judiciary"
MANIFEST = ACQ / "_manifest.jsonl"
UA = "LegalSourceAtlas/1.0 (research; contact: notreelai@gmail.com)"
INTERVAL = {"www.fjc.gov": 35.0, "fjc.gov": 35.0, "api.congress.gov": 0.5, "www.senate.gov": 0.75, "www.uscourts.gov": 0.75}
DEFAULT_INTERVAL = 1.0
_lock = threading.Lock()
_last: dict[str, float] = {}
_STATE = ACQ / "_last_request.json"  # persists the last fjc.gov request time across processes


def _load_state() -> dict:
    try:
        return json.loads(_STATE.read_text())
    except (OSError, ValueError):
        return {}


def _wait(host: str) -> None:
    gap = INTERVAL.get(host, DEFAULT_INTERVAL)
    with _lock:
        last = _last.get(host, 0.0)
        if host.endswith("fjc.gov"):
            last = max(last, _load_state().get(host, 0.0))  # wall-clock seconds
            now = time.time()
            if last + gap > now:
                time.sleep(last + gap - now)
            _last[host] = time.time()
            state = _load_state()
            state[host] = _last[host]
            ACQ.mkdir(parents=True, exist_ok=True)
            _STATE.write_text(json.dumps(state))
            return
        now = time.monotonic()
        if last + gap > now:
            time.sleep(last + gap - now)
        _last[host] = time.monotonic()


def _done(host: str) -> None:
    """For fjc.gov the gap is also counted from the END of the previous transfer (a long download must not shorten it)."""
    if not host.endswith("fjc.gov"):
        return
    with _lock:
        _last[host] = time.time()
        state = _load_state()
        state[host] = _last[host]
        _STATE.write_text(json.dumps(state))


def _record(entry: dict) -> None:
    with _lock:
        ACQ.mkdir(parents=True, exist_ok=True)
        with MANIFEST.open("a") as fh:
            fh.write(json.dumps(entry, sort_keys=True) + "\n")


def now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def safe_name(url: str, drop_query: tuple[str, ...] = ()) -> str:
    parsed = urllib.parse.urlparse(url)
    path = urllib.parse.unquote(parsed.path).lstrip("/") or "index"
    if path.endswith("/"):
        path += "index"
    query = "&".join(p for p in parsed.query.split("&") if p and p.split("=")[0] not in drop_query)
    if query:
        path += "__" + re.sub(r"[^A-Za-z0-9._-]+", "_", query)
    return "/".join(re.sub(r"[^A-Za-z0-9._()-]+", "_", part) for part in path.split("/"))


def read_stored(path: Path) -> bytes:
    data = path.read_bytes()
    return gzip.decompress(data) if path.suffix == ".gz" else data


def fetch(url: str, subdir: str, *, gz: bool = True, headers: dict | None = None, attempts: int = 5,
          method: str = "direct urllib GET", name: str | None = None, ok_missing: bool = False,
          timeout: int = 120) -> tuple[int, bytes, Path | None]:
    """Return (status, body, stored path). A stored copy is reused without a request."""
    rel = name or safe_name(url)
    target = ACQ / subdir / (rel + (".gz" if gz else ""))
    if target.exists() and target.stat().st_size > 0:
        return 200, read_stored(target), target
    miss = ACQ / subdir / (rel + ".missing")
    if miss.exists():
        return int(miss.read_text().strip() or 404), b"", None
    host = urllib.parse.urlparse(url).netloc
    status, data = 0, b""
    for attempt in range(attempts):
        _wait(host)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                status, data = resp.status, resp.read()
            _done(host)
            break
        except urllib.error.HTTPError as err:
            status = err.code
            if err.code in (404, 410) or (ok_missing and err.code in (400, 403)):
                break
            if err.code in (429, 500, 502, 503, 504) and attempt < attempts - 1:
                time.sleep(min(300, 10 * 2 ** attempt))
                continue
            raise RuntimeError(f"GET {safe_name(url)} -> HTTP {err.code}") from None
        except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
            if attempt < attempts - 1:
                time.sleep(min(120, 5 * 2 ** attempt))
                continue
            raise RuntimeError(f"GET {safe_name(url)} failed: {type(err).__name__}") from None
    if status != 200:
        miss.parent.mkdir(parents=True, exist_ok=True)
        miss.write_text(str(status))
        _record({"url": url, "path": None, "sha256": None, "bytes": 0, "retrieved_at": now_utc(), "http_status": status, "method": method})
        return status, b"", None
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".part")
    tmp.write_bytes(gzip.compress(data, 6) if gz else data)
    os.replace(tmp, target)
    _record({"url": url, "path": str(target.relative_to(ROOT)), "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
             "retrieved_at": now_utc(), "http_status": status, "method": method + (" (stored gzip-compressed)" if gz else "")})
    return status, data, target


def download_file(url: str, dest: Path, *, method: str = "direct urllib GET (streamed to disk)", chunk: int = 1 << 20) -> dict:
    """Stream one large file to disk exactly once (refuses if it already exists), hashing as it goes."""
    if dest.exists():
        raise SystemExit(f"{dest} exists; refusing to download again")
    host = urllib.parse.urlparse(url).netloc
    _wait(host)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    h = hashlib.sha256()
    size = 0
    t0 = time.time()
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
    _done(host)
    if length and int(length) != size:
        raise SystemExit(f"{url}: got {size} bytes, Content-Length {length}; kept {tmp} for inspection")
    os.replace(tmp, dest)
    entry = {"url": url, "path": str(dest.relative_to(ROOT)), "sha256": h.hexdigest(), "bytes": size, "retrieved_at": now_utc(),
             "http_status": status, "method": method, "last_modified": modified, "seconds": round(time.time() - t0, 1)}
    _record(entry)
    return entry
