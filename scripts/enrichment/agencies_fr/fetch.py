"""Polite HTTP fetcher for the agencies_fr stream: raw bytes kept unchanged under private/acq/agencies_fr/ with a manifest.

Every stored response appends one line to private/acq/agencies_fr/_manifest.jsonl:
  {url, path, sha256, bytes, retrieved_at, status, method[, post_body][, stored_gzip]}
sha256/bytes describe the bytes the server returned (before optional gzip storage), so a re-fetch can be verified.
Rate limit: at most 2 requests per second per host; retries with backoff on 403/429/5xx and network errors.
"""
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

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "agencies_fr")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")
UA = "legal-source-compass research (contact: notreelai@gmail.com)"
CA = os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE")
if not CA and os.path.exists("/root/.ccr/ca-bundle.crt"):
    CA = "/root/.ccr/ca-bundle.crt"
CONTEXT = ssl.create_default_context(cafile=CA) if CA else ssl.create_default_context()
_lock = threading.Lock()
_last = {}
MIN_GAP = 0.5


def _wait(url):
    host = urllib.parse.urlparse(url).netloc
    while True:
        with _lock:
            gap = time.time() - _last.get(host, 0)
            if gap >= MIN_GAP:
                _last[host] = time.time()
                return
        time.sleep(MIN_GAP - gap)


def _record(entry):
    with _lock:
        with open(MANIFEST, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, sort_keys=True) + "\n")


def fetch(url, rel, method, body=None, store_gzip=False, timeout=180, accept="application/json", reuse=True):
    """GET (or POST JSON `body`) `url`; store raw bytes at ACQ/rel (gzip-wrapped when store_gzip). Returns bytes."""
    path = os.path.join(ACQ, rel)
    if reuse and os.path.exists(path):
        with open(path, "rb") as fh:
            data = fh.read()
        return gzip.decompress(data) if store_gzip else data
    os.makedirs(os.path.dirname(path), exist_ok=True)
    payload = json.dumps(body).encode() if body is not None else None
    headers = {"User-Agent": UA, "Accept": accept}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    last_error = None
    for attempt in range(6):
        _wait(url)
        request = urllib.request.Request(url, data=payload, headers=headers, method="POST" if payload else "GET")
        try:
            with urllib.request.urlopen(request, context=CONTEXT, timeout=timeout) as response:
                status = response.status
                data = response.read()
            tmp = path + ".part"
            with open(tmp, "wb") as fh:
                fh.write(gzip.compress(data, mtime=0) if store_gzip else data)
            os.replace(tmp, path)
            entry = {
                "url": url, "path": os.path.relpath(path, ROOT), "sha256": hashlib.sha256(data).hexdigest(),
                "bytes": len(data), "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "status": status, "method": method,
            }
            if body is not None:
                entry["post_body"] = body
            if store_gzip:
                entry["stored_gzip"] = True
            _record(entry)
            return data
        except urllib.error.HTTPError as error:
            last_error = f"HTTP {error.code}"
            if error.code in (403, 429, 500, 502, 503, 504) and attempt < 5:
                time.sleep(min(60, 3 * 2 ** attempt))
                continue
            raise RuntimeError(f"{last_error} for {url}") from None
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            last_error = str(error)
            if attempt < 5:
                time.sleep(min(60, 3 * 2 ** attempt))
                continue
            raise RuntimeError(f"{last_error} for {url}") from None
    raise RuntimeError(f"{last_error} for {url}")


def fetch_json(url, rel, method, body=None, **kw):
    return json.loads(fetch(url, rel, method, body=body, **kw))


def manifest_entries():
    """Latest manifest entry per stored path."""
    out = {}
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    entry = json.loads(line)
                    out[entry["path"]] = entry
    return out
