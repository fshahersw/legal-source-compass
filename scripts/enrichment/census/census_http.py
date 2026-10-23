"""Census Data API acquisition: cached, paced, key-safe.

Every response is stored unchanged under private/acq/census/raw/ and logged in private/acq/census/_manifest.jsonl with the
request URL WITHOUT the key, sha256, bytes, retrieved_at (UTC), http status and method. The API key is read with
scripts/enrichment/court_rules/secrets_env.py and is appended to the request only; it is never printed, logged, stored in a
manifest, a cache file name or an exception message.

api.census.gov can take minutes for a large query, so calls are cached by the key-less URL and may run in a small thread
pool (``fetch_many``); the pool is capped so the host never sees more than a handful of simultaneous requests.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "census")
RAW = os.path.join(ACQ, "raw")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")
UA = "legal-source-compass research (contact: notreelai@gmail.com)"
BASE = "https://api.census.gov/data"
MAX_WORKERS = 6
_lock = threading.Lock()
_key: str | None = None


def api_key() -> str:
    """The Census key from private secrets (cached for the process); never printed."""
    global _key
    if _key is None:
        sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment", "court_rules"))
        import secrets_env  # noqa: PLC0415

        _key = secrets_env.load("CENSUS_API_KEY")
    return _key


def redact(text: str) -> str:
    """Remove the key from any text before it can reach a log or an error."""
    key = _key
    return text.replace(key, "KEY") if key else text


def build_url(path: str, params: dict[str, str]) -> str:
    """Key-less request URL; parameters keep a stable order and the Census-style unescaped ``,`` ``:`` ``*`` characters."""
    query = "&".join(f"{k}={urllib.parse.quote(str(v), safe=',:*()')}" for k, v in params.items())
    return f"{BASE}/{path}?{query}" if query else f"{BASE}/{path}"


def cache_name(url: str) -> str:
    """Cache file name derived from the key-less URL (a readable prefix plus a hash)."""
    slug = re.sub(r"[^a-z0-9]+", "-", url.replace(BASE + "/", "").split("?")[0].lower()).strip("-")[:60]
    return f"{slug}-{hashlib.sha256(url.encode()).hexdigest()[:16]}.json"


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _log(entry: dict) -> None:
    with _lock:
        os.makedirs(ACQ, exist_ok=True)
        with open(MANIFEST, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, sort_keys=True) + "\n")


def manifest() -> dict[str, dict]:
    """Latest manifest entry per key-less URL."""
    out: dict[str, dict] = {}
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    entry = json.loads(line)
                    out[entry["url"]] = entry
    return out


def fetch(url: str, *, refresh: bool = False, timeout: tuple[int, int] = (15, 90), attempts: int = 12) -> str:
    """Return the path of the cached response for the key-less ``url``, requesting it (with the key) when absent."""
    path = os.path.join(RAW, cache_name(url))
    if os.path.exists(path) and not refresh:
        return path
    sep = "&" if "?" in url else "?"
    full = f"{url}{sep}key={api_key()}"
    last = "no attempt"
    for attempt in range(attempts):
        try:
            response = requests.get(full, headers={"User-Agent": UA}, timeout=timeout)
        except requests.RequestException as error:
            last = redact(repr(error))
            time.sleep(min(20, 2 ** attempt * 2))
            continue
        if response.status_code in (429, 500, 502, 503, 504):
            last = f"HTTP {response.status_code}"
            time.sleep(min(30, 2 ** attempt * 3))
            continue
        if response.status_code != 200:
            raise RuntimeError(f"GET {url} -> HTTP {response.status_code}: {redact(response.text[:200])}")
        body = response.content
        json.loads(body)  # a 200 that is not JSON (an HTML error page) must not be cached
        os.makedirs(RAW, exist_ok=True)
        tmp = path + ".part"
        with open(tmp, "wb") as handle:
            handle.write(body)
        os.replace(tmp, path)
        _log(
            {
                "url": url,
                "path": os.path.relpath(path, ROOT),
                "sha256": hashlib.sha256(body).hexdigest(),
                "bytes": len(body),
                "retrieved_at": _now(),
                "http_status": response.status_code,
                "method": "Census Data API GET (key sent as a query parameter, not recorded)",
            }
        )
        return path
    raise RuntimeError(f"GET {url} failed after {attempts} attempts: {last}")


def load(url: str, **kwargs) -> object:
    with open(fetch(url, **kwargs), encoding="utf-8") as handle:
        return json.load(handle)


_file_last = 0.0


def fetch_file(url: str, rel: str, *, refresh: bool = False, timeout: int = 300) -> str:
    """Download a public (keyless) census.gov file unchanged to private/acq/census/<rel>; at most one request a second."""
    global _file_last
    path = os.path.join(ACQ, rel)
    if os.path.exists(path) and not refresh:
        return path
    wait = 1.1 - (time.time() - _file_last)
    if wait > 0:
        time.sleep(wait)
    _file_last = time.time()
    response = requests.get(url, headers={"User-Agent": UA}, timeout=timeout)
    if response.status_code != 200:
        raise RuntimeError(f"GET {url} -> HTTP {response.status_code}")
    body = response.content
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".part"
    with open(tmp, "wb") as handle:
        handle.write(body)
    os.replace(tmp, path)
    _log(
        {
            "url": url,
            "path": os.path.relpath(path, ROOT),
            "sha256": hashlib.sha256(body).hexdigest(),
            "bytes": len(body),
            "retrieved_at": _now(),
            "http_status": response.status_code,
            "last_modified": response.headers.get("last-modified"),
            "method": "direct GET (unchanged)",
        }
    )
    return path


def fetch_many(urls: list[str], workers: int = MAX_WORKERS, **kwargs) -> dict[str, str]:
    """Fetch several key-less URLs concurrently (capped); returns url -> path. Raises after all finish if any failed."""
    out: dict[str, str] = {}
    errors: list[str] = []
    started = time.time()
    with ThreadPoolExecutor(max_workers=min(workers, MAX_WORKERS)) as pool:
        futures = {pool.submit(fetch, url, **kwargs): url for url in urls}
        for done, future in enumerate(as_completed(futures), 1):
            url = futures[future]
            try:
                out[url] = future.result()
            except Exception as error:  # noqa: BLE001 - collected, reported once
                errors.append(f"{url}: {redact(str(error))[:200]}")
            print(f"  {done}/{len(urls)} fetched ({time.time() - started:.0f}s)", flush=True)
    if errors:
        raise RuntimeError("; ".join(errors[:5]) + (f" (+{len(errors) - 5} more)" if len(errors) > 5 else ""))
    return out
