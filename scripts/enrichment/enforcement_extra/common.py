"""Shared helpers for the enforcement_extra builders: paths, polite HTTP, manifest, record shape.

Raw downloads go to private/acq/enforcement_extra/<source>/ with a manifest line per file
(url, path, sha256, bytes, retrieved_at UTC, http status, method). Build files go to
private/build/enforcement_extra/<dataset>.json in the shape publish_build.py validates.
"""
from __future__ import annotations

import datetime as _dt
import gzip
import hashlib
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
if os.path.islink(os.path.join(ROOT, "private")) or os.path.isdir(os.path.join(ROOT, "private")):
    PRIVATE = os.path.realpath(os.path.join(ROOT, "private"))
else:  # pragma: no cover - worktree without the symlink
    PRIVATE = "/home/user/legal-source-compass/private"
ACQ = os.path.join(PRIVATE, "acq", "enforcement_extra")
BUILD = os.path.join(PRIVATE, "build", "enforcement_extra")
LOOKUPS = os.path.join(BUILD, "lookups")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")
UA = "LegalSourceAtlas/1.0 (research; contact: notreelai@gmail.com)"
NOT_RECORDED = "Not recorded"

sys.path.insert(0, os.path.dirname(HERE))


def utc_now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_file(path: str) -> tuple[str, int]:
    h = hashlib.sha256()
    n = 0
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
            n += len(block)
    return h.hexdigest(), n


def free_bytes(path: str = "/home/user") -> int:
    return shutil.disk_usage(path).free


def require_space(expected_bytes: int, floor: int = 4 * 1024**3) -> None:
    """Stop before a download that would push free space on /home/user below the floor (4 GB)."""
    free = free_bytes()
    if free - expected_bytes < floor:
        raise SystemExit(f"disk: {free / 1e9:.2f} GB free; a {expected_bytes / 1e6:.0f} MB download would cross the 4 GB floor")


class EmptyResponse(RuntimeError):
    """The server answered without a file (e.g. HTTP 204 for an extract that is not published yet)."""


_last: dict[str, float] = {}


def _pace(host: str, min_interval: float) -> None:
    wait = _last.get(host, 0) + min_interval - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last[host] = time.monotonic()


def http_get(url: str, *, min_interval: float = 1.0, timeout: int = 300, headers: dict | None = None, attempts: int = 5):
    """GET with a descriptive User-Agent, per-host pacing and backoff on 429/5xx. Returns the open response."""
    host = urllib.parse.urlparse(url).hostname or ""
    delay = 2.0
    for attempt in range(attempts):
        _pace(host, min_interval)
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*", **(headers or {})})
        try:
            return urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError as err:
            if err.code in (429, 500, 502, 503, 504) and attempt < attempts - 1:
                time.sleep(delay)
                delay *= 2
                continue
            raise
        except urllib.error.URLError:
            if attempt < attempts - 1:
                time.sleep(delay)
                delay *= 2
                continue
            raise
    raise RuntimeError("unreachable")


def download(url: str, dest: str, *, method: str = "direct GET", min_interval: float = 1.0, expected: int = 0,
             gzip_store: bool = False) -> dict:
    """Stream url to dest (optionally gzip-compressed), hash the bytes as received, append a manifest line."""
    if expected > 50 * 1024**2:
        require_space(expected)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    h = hashlib.sha256()
    n = 0
    with http_get(url, min_interval=min_interval) as resp:
        status = resp.status
        final_url = resp.geturl()
        opener = (lambda p: gzip.open(p, "wb", compresslevel=6)) if gzip_store else (lambda p: open(p, "wb"))
        with opener(tmp) as out:
            for block in iter(lambda: resp.read(1 << 20), b""):
                h.update(block)
                n += len(block)
                out.write(block)
    if n == 0 or status == 204:
        os.remove(tmp)
        raise EmptyResponse(f"{url}: HTTP {status}, no content")
    os.replace(tmp, dest)
    entry = {
        "url": url,
        "path": os.path.relpath(dest, PRIVATE),
        "sha256": h.hexdigest(),
        "bytes": n,
        "stored_bytes": os.path.getsize(dest),
        "stored_as": "gzip" if gzip_store else "unchanged",
        "retrieved_at": utc_now(),
        "http_status": status,
        "method": method,
    }
    if final_url != url and "X-Amz-" not in final_url:
        entry["final_url"] = final_url
    manifest_append(entry)
    return entry


def manifest_append(entry: dict) -> None:
    os.makedirs(ACQ, exist_ok=True)
    with open(MANIFEST, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, sort_keys=True) + "\n")


def manifest_entries(prefix: str = "") -> list[dict]:
    if not os.path.exists(MANIFEST):
        return []
    out = []
    with open(MANIFEST, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                e = json.loads(line)
                if e.get("path", "").startswith(prefix) or e.get("url", "").startswith(prefix):
                    out.append(e)
    return out


def latest_manifest(path_prefix: str) -> dict | None:
    rows = [e for e in manifest_entries() if e.get("path", "").startswith(path_prefix)]
    return rows[-1] if rows else None


# ------------------------------------------------------------------------------------------------ text helpers
_WS = re.compile(r"\s+")


def clean(value) -> str:
    """Trim and collapse internal whitespace; never changes letters or punctuation."""
    if value is None:
        return ""
    return _WS.sub(" ", str(value)).strip()


def or_nr(value) -> str:
    v = clean(value)
    return v if v else NOT_RECORDED


_NAME_PUNCT = re.compile(r"[^0-9a-z&]+")
_SUFFIX = re.compile(r"\b(incorporated|inc|corporation|corp|company|co|llc|l l c|ltd|limited|plc|lp|l p|na|n a|sa|ag|nv|n v|se|bv|b v|holdings?)\b")


def norm_company(name: str) -> str:
    """Deterministic company-name key: lowercase, '&' kept, punctuation to spaces, corporate suffixes and a
    leading 'the' dropped, whitespace collapsed. Used only for exact key equality (never fuzzy)."""
    s = clean(name).lower().replace("&amp;", "&")
    s = s.replace(".", "")
    s = _NAME_PUNCT.sub(" ", s)
    s = _SUFFIX.sub(" ", s)
    s = _WS.sub(" ", s).strip()
    if s.startswith("the "):
        s = s[4:]
    return s


def write_build(dataset: str, label: str, rows: list, listing_block: dict, summary: dict, inputs: list) -> str:
    """Write private/build/enforcement_extra/<dataset>.json, streaming the rows (large datasets stay cheap)."""
    os.makedirs(BUILD, exist_ok=True)
    path = os.path.join(BUILD, f"{dataset}.json")
    tmp = path + ".tmp"
    dump = lambda v: json.dumps(v, ensure_ascii=False, separators=(",", ":"))  # noqa: E731
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("{" + dump("dataset") + ":" + dump(dataset) + "," + dump("label") + ":" + dump(label) + ",")
        f.write(dump("listing_block") + ":" + dump(listing_block) + "," + dump("summary") + ":" + dump(summary) + ",")
        f.write(dump("built_at") + ":" + dump(utc_now()) + "," + dump("inputs") + ":" + dump(inputs) + ",")
        f.write(dump("rows") + ":[")
        for i, row in enumerate(rows):
            if i:
                f.write(",")
            f.write(dump(row))
        f.write("]}")
    os.replace(tmp, path)
    return path


def iter_build_rows(path: str, chunk: int = 1 << 22):
    """Stream the rows of a build file written by write_build without loading the whole file."""
    dec = json.JSONDecoder()
    with open(path, encoding="utf-8") as f:
        buf = f.read(chunk)
        i = buf.find('"rows":[')
        while i < 0:
            more = f.read(chunk)
            if not more:
                raise ValueError(f"{path}: no rows array")
            buf += more
            i = buf.find('"rows":[')
        pos = i + len('"rows":[')
        while True:
            while pos < len(buf) and buf[pos] in ", \n":
                pos += 1
            if pos < len(buf) and buf[pos] == "]":
                return
            try:
                row, end = dec.raw_decode(buf, pos)
            except json.JSONDecodeError:
                more = f.read(chunk)
                if not more:
                    raise
                buf = buf[pos:] + more
                pos = 0
                continue
            yield row
            pos = end
            if pos > chunk:
                buf = buf[pos:]
                pos = 0


def read_build_meta(path: str) -> dict:
    """Everything in a build file except its rows (read from the head of the file)."""
    with open(path, encoding="utf-8") as f:
        head = f.read(1 << 22)
    i = head.find(',"rows":[')
    return json.loads(head[:i] + "}")


def facts_pairs(facts: list[tuple[str, object]], optional: list[tuple[str, object]] = ()) -> list[list[str]]:
    """[label, value] pairs as the entity view reads them. Core facts: empty values become 'Not recorded'.
    Optional facts (identifiers a record may simply not have) are listed only when present."""
    out = []
    for label, value in facts:
        v = NOT_RECORDED if value is None or (isinstance(value, str) and not value.strip()) else str(value)
        out.append([label, v])
    for label, value in optional:
        if value is not None and str(value).strip():
            out.append([label, str(value)])
    return out


def compact(d: dict) -> dict:
    """Drop None and empty-string values (readers treat a missing key as 'Not recorded')."""
    return {k: v for k, v in d.items() if v is not None and v != ""}

