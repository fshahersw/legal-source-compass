"""Polite HTTP GET for www.uscourts.gov (identified User-Agent, <= 1 request/second, retry with backoff)."""
import hashlib
import json
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

UA = "legal-source-compass research (contact: notreelai@gmail.com)"
_lock = threading.Lock()
_last = [0.0]
MIN_INTERVAL = 1.0


def _wait():
    with _lock:
        delta = time.monotonic() - _last[0]
        if delta < MIN_INTERVAL:
            time.sleep(MIN_INTERVAL - delta)
        _last[0] = time.monotonic()


def get(url, attempts=4, timeout=120):
    """Return (status, bytes, final_url). 404 is returned at once; other errors retried with backoff."""
    for attempt in range(attempts):
        _wait()
        try:
            request = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.status, response.read(), response.geturl()
        except urllib.error.HTTPError as error:
            if error.code in (404, 410):
                return error.code, b"", url
            if attempt == attempts - 1:
                return error.code, b"", url
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == attempts - 1:
                return 0, b"", url
        time.sleep(2 * (attempt + 1))
    return 0, b"", url


def now_utc():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def append_manifest(path, entry):
    with _lock:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, sort_keys=True) + "\n")


def read_manifest(path):
    out = []
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    out.append(json.loads(line))
    except FileNotFoundError:
        pass
    return out
