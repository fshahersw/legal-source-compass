"""Rate-limited, cached HTTP for SEC hosts (EDGAR full-text search, data.sec.gov, www.sec.gov).

SEC fair-access policy: descriptive User-Agent and no more than 10 requests per second. This client
holds a global limit of 8 requests per second across threads and caches every response body
unchanged under private/acq/sec-companies so values can be re-checked.
"""
import gzip
import hashlib
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ACQ = ROOT / "private" / "acq" / "sec-companies"
USER_AGENT = "SeegerWeiss Research firasshaher99@gmail.com"
MAX_RPS = 8.0

_lock = threading.Lock()
_next_slot = [0.0]


def _throttle():
    with _lock:
        now = time.monotonic()
        wait = _next_slot[0] - now
        _next_slot[0] = max(now, _next_slot[0]) + 1.0 / MAX_RPS
    if wait > 0:
        time.sleep(wait)


def cache_path(url: str, kind: str, suffix: str) -> Path:
    digest = hashlib.sha256(url.encode()).hexdigest()[:24]
    return ACQ / kind / f"{digest}{suffix}"


def get(url: str, *, kind: str, suffix: str = ".json", refresh: bool = False, timeout: int = 90, compress: bool = False) -> bytes | None:
    """GET a URL (cached). Returns body bytes, or None for a 404.

    compress=True stores the body gzip-compressed (byte-identical after decompression) for large documents.
    """
    path = cache_path(url, kind, suffix + (".gz" if compress else ""))
    if path.exists() and not refresh:
        raw = path.read_bytes()
        return gzip.decompress(raw) if compress else raw
    path.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(6):
        _throttle()
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read()
            path.write_bytes(gzip.compress(body, 6) if compress else body)
            index = ACQ / kind / "_index.jsonl"
            with _lock:
                with index.open("a") as handle:
                    handle.write(json.dumps({"url": url, "file": path.name, "retrieved": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "bytes": len(body)}) + "\n")
            return body
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            if error.code in (429, 500, 502, 503, 504) and attempt < 5:
                time.sleep(2 + 2 ** attempt)
                continue
            raise RuntimeError(f"GET {url} -> {error.code}") from None
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt < 5:
                time.sleep(2 + 2 ** attempt)
                continue
            raise
    return None


def get_json(url: str, *, kind: str, refresh: bool = False):
    body = get(url, kind=kind, refresh=refresh)
    return None if body is None else json.loads(body)


def efts_url(phrase: str, forms: str, start: int = 0, date_from: str | None = None, date_to: str | None = None) -> str:
    params = {"q": f'"{phrase}"', "forms": forms}
    if start:
        params["from"] = str(start)
    if date_from and date_to:
        params.update({"dateRange": "custom", "startdt": date_from, "enddt": date_to})
    return "https://efts.sec.gov/LATEST/search-index?" + urllib.parse.urlencode(params)
