"""Polite fetch helper for the US Code stream (uscode.house.gov, govinfo.gov).

Every stored download keeps its bytes unchanged (zip archives as published; XML and HTML gzip-compressed) and gets
a manifest line: url, path, sha256 of the raw bytes, bytes, retrieved_at (UTC), HTTP status, method and the server's
Last-Modified header when it sent one. Requests are spaced per host (default one every 0.6 s, under the 2 requests/s
limit), retried with backoff on transient errors, and never sent to a commercial legal publisher.
"""
import datetime
import gzip
import hashlib
import json
import re
import shutil
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ACQ = ROOT / "private" / "acq" / "uscode"
BUILD = ROOT / "private" / "build" / "uscode"
UA = "LegalSourceAtlas/1.0 (research; contact: notreelai@gmail.com)"
COMMERCIAL = re.compile(r"lexis|westlaw|justia|casetext|findlaw|thomsonreuters|fastcase|vlex|casemine|cornell", re.I)
ALLOWED = ("uscode.house.gov", "www.govinfo.gov", "api.govinfo.gov")
_last = {}
_lock = threading.Lock()
COUNTS = {}


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _wait(host, interval):
    with _lock:
        t = time.monotonic()
        start = max(t, _last.get(host, 0.0) + interval)
        _last[host] = start
    if start > t:
        time.sleep(start - t)


def _check(url):
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https" or parts.netloc not in ALLOWED or COMMERCIAL.search(parts.netloc):
        raise ValueError(f"refusing host {parts.netloc}")
    return parts.netloc


def request(url, *, method="GET", headers=None, interval=0.6, retries=5, timeout=180, stream_to=None, follow=True):
    """Returns (status, body_bytes_or_None, response_headers, final_url). 404 returns without retrying.

    With stream_to, the body is written to that path (raw bytes) and body is None.
    With follow=False, a 3xx answer is returned as is (status, b"", headers with Location)."""
    host = _check(url)
    last = None
    for attempt in range(retries):
        _wait(host, interval)
        COUNTS[host] = COUNTS.get(host, 0) + 1
        req = urllib.request.Request(url, method=method, headers={"User-Agent": UA, "Accept": "*/*", **(headers or {})})
        opener = urllib.request.build_opener() if follow else urllib.request.build_opener(_NoRedirect)
        try:
            with opener.open(req, timeout=timeout) as response:
                hdrs = {k.lower(): v for k, v in response.headers.items()}
                if stream_to is not None:
                    Path(stream_to).parent.mkdir(parents=True, exist_ok=True)
                    tmp = Path(str(stream_to) + ".part")
                    with open(tmp, "wb") as out:
                        shutil.copyfileobj(response, out, 1 << 20)
                    tmp.replace(stream_to)
                    return response.status, None, hdrs, response.geturl()
                return response.status, response.read(), hdrs, response.geturl()
        except urllib.error.HTTPError as error:
            hdrs = {k.lower(): v for k, v in (error.headers or {}).items()}
            if not follow and 300 <= error.code < 400:
                return error.code, b"", hdrs, url
            if error.code in (404, 410):
                return error.code, b"", hdrs, url
            last = f"HTTP {error.code}"
            if error.code not in (429, 500, 502, 503, 504):
                raise RuntimeError(f"{url}: {last}") from None
            retry_after = hdrs.get("retry-after")
            if retry_after and retry_after.isdigit():
                time.sleep(min(int(retry_after), 120))
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            last = str(error)[:160]
        time.sleep(min(2 ** attempt * 2, 60))
    raise RuntimeError(f"{url}: gave up after {retries} attempts ({last})")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def append_manifest(manifest, entry):
    Path(manifest).parent.mkdir(parents=True, exist_ok=True)
    with _lock, open(manifest, "a") as handle:
        handle.write(json.dumps(entry, sort_keys=True) + "\n")


def read_manifest(manifest):
    out = {}
    if Path(manifest).exists():
        for line in Path(manifest).read_text().splitlines():
            if line.strip():
                e = json.loads(line)
                out[e["path"]] = e
    return out


def fetch_file(url, out_path, manifest, *, gzip_body=False, method_note="urllib GET"):
    """Download url to out_path (raw bytes; or gzip of the raw bytes when gzip_body) with a manifest entry.

    Skips the download when out_path already exists with a manifest entry whose sha256 matches."""
    out_path = Path(out_path)
    known = read_manifest(manifest).get(str(out_path))
    if known and out_path.exists():
        raw = gzip.open(out_path, "rb").read() if gzip_body else None
        digest = hashlib.sha256(raw).hexdigest() if gzip_body else sha256_file(out_path)
        if digest == known["sha256"]:
            return known
    tmp = Path(str(out_path) + ".download")
    status, _, hdrs, final = request(url, stream_to=tmp)
    if status != 200:
        raise RuntimeError(f"{url}: HTTP {status}")
    digest = sha256_file(tmp)
    size = tmp.stat().st_size
    if gzip_body:
        with open(tmp, "rb") as src, gzip.open(out_path, "wb", compresslevel=9) as dst:
            shutil.copyfileobj(src, dst, 1 << 20)
        tmp.unlink()
        stored_as = "gzip of the unchanged response body"
    else:
        tmp.replace(out_path)
        stored_as = "unchanged response body"
    entry = {
        "url": url,
        "final_url": final,
        "path": str(out_path),
        "sha256": digest,
        "bytes": size,
        "stored_bytes": out_path.stat().st_size,
        "retrieved_at": now(),
        "status": status,
        "last_modified": hdrs.get("last-modified"),
        "method": method_note,
        "stored_as": stored_as,
    }
    append_manifest(manifest, entry)
    return entry


def open_raw(path):
    """Open a stored file for reading its original bytes (transparently un-gzips .gz)."""
    return gzip.open(path, "rb") if str(path).endswith(".gz") else open(path, "rb")
