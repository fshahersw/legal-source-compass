"""HTTP acquisition helpers for the state_analysis stream (official, keyless sources only).

Every response is recorded in private/acq/state_analysis/_manifest.jsonl with url, path, sha256, bytes, retrieved_at (UTC),
http status and method. Two methods:
  * "direct GET": the response bytes are stored unchanged.
  * "direct GET, streamed and filtered": very large national files (ACS summary-file tables) are streamed once; the sha256
    and byte count of the complete response are recorded, and only the rows for the summary levels the analysis uses
    (nation, state, county, place) are kept, gzip-compressed, beside the filter rule. The stored subset can be re-derived
    by re-fetching the URL and re-applying the rule; the recorded full-response sha256 verifies the re-fetch.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import time
import urllib.parse

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "state_analysis")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")
UA = "legal-source-compass research (contact: notreelai@gmail.com)"
_last_hit: dict[str, float] = {}
MIN_GAP = 0.6  # seconds between requests to one host (<= 2 req/s)


def _pace(url: str) -> None:
    host = urllib.parse.urlparse(url).netloc
    wait = MIN_GAP - (time.time() - _last_hit.get(host, 0.0))
    if wait > 0:
        time.sleep(wait)
    _last_hit[host] = time.time()


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _log(entry: dict) -> None:
    os.makedirs(ACQ, exist_ok=True)
    with open(MANIFEST, "a") as h:
        h.write(json.dumps(entry, sort_keys=True) + "\n")


def manifest() -> dict[str, dict]:
    """Latest manifest entry per stored path (relative to the repository root)."""
    out: dict[str, dict] = {}
    if os.path.exists(MANIFEST):
        for line in open(MANIFEST):
            if line.strip():
                e = json.loads(line)
                out[e["path"]] = e
    return out


def sha256_file(path: str) -> str:
    d = hashlib.sha256()
    with open(path, "rb") as h:
        for chunk in iter(lambda: h.read(1 << 20), b""):
            d.update(chunk)
    return d.hexdigest()


def _get(url: str, stream: bool = False, timeout: int = 300) -> requests.Response:
    last = None
    for attempt in range(5):
        _pace(url)
        try:
            r = requests.get(url, headers={"User-Agent": UA}, timeout=timeout, stream=stream)
            if r.status_code in (429, 500, 502, 503, 504):
                last = f"HTTP {r.status_code}"
                r.close()
                time.sleep(2 ** attempt * 2)
                continue
            return r
        except requests.RequestException as e:  # network hiccup: back off and retry
            last = repr(e)
            time.sleep(2 ** attempt * 2)
    raise RuntimeError(f"GET {url} failed: {last}")


def fetch(url: str, rel: str, refresh: bool = False) -> str:
    """Download url unchanged to private/acq/state_analysis/<rel>; returns the absolute path."""
    path = os.path.join(ACQ, rel)
    relpath = os.path.relpath(path, ROOT)
    if os.path.exists(path) and not refresh and relpath in manifest():
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    r = _get(url, stream=True)
    if r.status_code != 200:
        r.close()
        raise RuntimeError(f"GET {url} -> HTTP {r.status_code}")
    tmp = path + ".part"
    d = hashlib.sha256()
    n = 0
    with open(tmp, "wb") as h:
        for chunk in r.iter_content(1 << 20):
            h.write(chunk)
            d.update(chunk)
            n += len(chunk)
    os.replace(tmp, path)
    _log({"url": url, "path": relpath, "sha256": d.hexdigest(), "bytes": n, "retrieved_at": _now(), "http_status": r.status_code, "method": "direct GET"})
    return path


def fetch_filtered(url: str, rel: str, keep, rule: str, refresh: bool = False) -> str:
    """Stream a large text file; keep lines where keep(line) is true (the header line is always kept); store gzip."""
    path = os.path.join(ACQ, rel)
    relpath = os.path.relpath(path, ROOT)
    if os.path.exists(path) and not refresh and relpath in manifest():
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    r = _get(url, stream=True, timeout=600)
    if r.status_code != 200:
        r.close()
        raise RuntimeError(f"GET {url} -> HTTP {r.status_code}")
    tmp = path + ".part"
    d = hashlib.sha256()
    n = 0
    kept = 0
    first = True
    buf = b""
    with gzip.open(tmp, "wb", compresslevel=6) as out:
        for chunk in r.iter_content(1 << 20):
            d.update(chunk)
            n += len(chunk)
            buf += chunk
            *lines, buf = buf.split(b"\n")
            for line in lines:
                if first or keep(line):
                    out.write(line + b"\n")
                    kept += 1
                first = False
        if buf:
            if first or keep(buf):
                out.write(buf + b"\n")
                kept += 1
    os.replace(tmp, path)
    _log({"url": url, "path": relpath, "sha256": d.hexdigest(), "bytes": n, "retrieved_at": _now(), "http_status": r.status_code,
          "method": "direct GET, streamed and filtered", "filter": rule, "stored_sha256": sha256_file(path),
          "stored_bytes": os.path.getsize(path), "stored_lines": kept})
    return path


def probe(url: str) -> tuple[int, str, int]:
    """Status, content type and length of a HEAD-like GET (first bytes only); nothing is stored."""
    r = _get(url, stream=True, timeout=60)
    status = r.status_code
    ctype = r.headers.get("content-type", "")
    length = int(r.headers.get("content-length") or -1)
    r.close()
    return status, ctype, length
