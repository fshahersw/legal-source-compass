"""Shared paths, polite HTTP and the raw-file manifest for the enforcement_actions stream.

Every fetch goes through `Fetcher.get`: a per-host minimum interval between request starts, a descriptive
User-Agent with the owner's contact address, retries with backoff on 429/5xx/network errors, and no retry on
403 (a bot wall is reported, never bypassed). Raw response bytes are kept unchanged (gzip-compressed) and each
file is recorded in private/acq/enforcement_actions/_manifest.jsonl with its URL and sha256.
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
ACQ = os.path.join(PRIVATE, "acq", "enforcement_actions")
BUILD = os.path.join(PRIVATE, "build", "enforcement_actions")
SCRATCH = os.path.join(PRIVATE, "scratch", "enrich", "enforcement_actions")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")

CONTACT = "notreelai@gmail.com"
USER_AGENT = f"LegalSourceAtlas/1.0 (legal-source-compass research; contact: {CONTACT})"

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


class Blocked(Exception):
    """The host answered 403/401 or a bot wall; never retried or bypassed."""


class Fetcher:
    """Per-host polite fetcher. `rates` maps host -> minimum seconds between request starts."""

    def __init__(self, default_interval=1.0, rates=None, timeout=60, retries=5, extra_headers=None):
        self.default_interval = default_interval
        self.rates = dict(rates or {})
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

    def get(self, url, headers=None, accept_status=(200,)):
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
                if error.code in accept_status or error.code in (404, 410, 400):
                    return error.code, body, url, dict(error.headers or {})
                last = f"HTTP {error.code}"
                retry_after = (error.headers or {}).get("Retry-After") if error.headers else None
                wait = min(120, float(retry_after)) if retry_after and str(retry_after).isdigit() else 2 ** (attempt + 1)
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as error:
                last = f"{type(error).__name__}: {error}"
                wait = 2 ** (attempt + 1)
            self.stats["retries"] += 1
            time.sleep(wait)
        self.stats["errors"] += 1
        raise RuntimeError(f"giving up on {url}: {last}")


class PackWriter:
    """Store many raw HTML responses unchanged in solid xz packs (pages share an ~0.9 MB inline icon sprite, so
    per-file gzip would cost ~390 KB a page; a solid pack stores the repeat once per dictionary window).

    Each pack holds the exact response bytes back to back; `index.jsonl` beside the packs records url, pack,
    offset, length, sha256, status and retrieved_at for every page, so any page can be cut out and re-hashed.
    Pages are buffered in memory and a pack is written (and indexed) every `per_pack` pages and on close().
    """

    def __init__(self, folder, per_pack=40, method="direct GET"):
        self.folder = folder
        self.per_pack = per_pack
        self.method = method
        self.index_path = os.path.join(folder, "index.jsonl")
        os.makedirs(folder, exist_ok=True)
        self.index = {row["url"]: row for row in load_jsonl(self.index_path)}
        packs = [name for name in os.listdir(folder) if name.startswith("pack_") and name.endswith(".xz")]
        self.next_pack = max([int(name[5:10]) for name in packs] + [-1]) + 1
        self.buffer = []
        self.lock = threading.Lock()

    def has(self, url):
        return url in self.index or any(entry["url"] == url for entry in self.buffer)

    def add(self, url, body: bytes, status, final_url=None):
        with self.lock:
            self.buffer.append({"url": url, "final_url": final_url or url, "body": body, "status": status, "retrieved_at": now_utc()})
            if len(self.buffer) >= self.per_pack:
                self._flush()

    def _flush(self):
        import lzma

        if not self.buffer:
            return
        name = f"pack_{self.next_pack:05d}.xz"
        self.next_pack += 1
        path = os.path.join(self.folder, name)
        blob = b"".join(entry["body"] for entry in self.buffer)
        tmp = path + ".tmp"
        with lzma.open(tmp, "wb", preset=6) as handle:
            handle.write(blob)
        os.replace(tmp, path)
        offset = 0
        lines = []
        for entry in self.buffer:
            body = entry["body"]
            row = {
                "url": entry["url"],
                "final_url": entry["final_url"],
                "pack": name,
                "offset": offset,
                "length": len(body),
                "sha256": sha256(body),
                "status": entry["status"],
                "retrieved_at": entry["retrieved_at"],
            }
            offset += len(body)
            lines.append(row)
            self.index[row["url"]] = row
            manifest_entry = {"url": row["url"], "path": rel(path), "offset": row["offset"], "length": row["length"],
                              "sha256": row["sha256"], "bytes": row["length"], "retrieved_at": row["retrieved_at"],
                              "status": row["status"], "method": self.method}
            with _manifest_lock:
                with open(MANIFEST, "a", encoding="utf-8") as handle:
                    handle.write(json.dumps(manifest_entry) + "\n")
        with open(self.index_path, "a", encoding="utf-8") as handle:
            for row in lines:
                handle.write(json.dumps(row) + "\n")
        self.buffer = []

    def close(self):
        with self.lock:
            self._flush()


class PackReader:
    """Read pages back from PackWriter packs, verifying each page's sha256."""

    def __init__(self, folder):
        self.folder = folder
        self.index = {row["url"]: row for row in load_jsonl(os.path.join(folder, "index.jsonl"))}
        self._cache_name = None
        self._cache_blob = None

    def get(self, url):
        import lzma

        row = self.index.get(url)
        if row is None:
            return None
        if self._cache_name != row["pack"]:
            with lzma.open(os.path.join(self.folder, row["pack"]), "rb") as handle:
                self._cache_blob = handle.read()
            self._cache_name = row["pack"]
        body = self._cache_blob[row["offset"]:row["offset"] + row["length"]]
        if sha256(body) != row["sha256"]:
            raise ValueError(f"sha256 mismatch for {url}")
        return body

    def rows_by_pack(self):
        return sorted(self.index.values(), key=lambda r: (r["pack"], r["offset"]))


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
