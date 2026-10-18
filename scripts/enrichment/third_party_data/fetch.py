"""Polite fetcher for the third_party_data stream: stores raw bytes unchanged plus a manifest line.

Usage: python3 -I -B fetch.py <url> <relative_path_under_acq> [<url> <path> ...]
Writes private/acq/third_party_data/<path> and appends to private/acq/third_party_data/_manifest.jsonl.
"""
import datetime
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "third_party_data")
UA = "legal-source-compass research (Seeger Weiss internal research)"
MIN_INTERVAL = 0.6  # seconds between requests (< 2 req/s per host)


def fetch(url, rel, method="direct"):
    path = os.path.join(ACQ, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    status, body, err = None, b"", None
    for attempt in range(4):
        request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                status = response.status
                body = response.read()
                ctype = response.headers.get("Content-Type", "")
                final = response.geturl()
            err = None
            break
        except urllib.error.HTTPError as error:
            status = error.code
            body = error.read() or b""
            ctype = error.headers.get("Content-Type", "") if error.headers else ""
            final = url
            err = f"HTTP {error.code}"
            if error.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(2 ** (attempt + 1))
                continue
            break
        except Exception as error:  # network-level failure
            err = type(error).__name__ + ": " + str(error)[:200]
            ctype, final = "", url
            if attempt < 3:
                time.sleep(2 ** (attempt + 1))
                continue
            break
    with open(path, "wb") as out:
        out.write(body)
    line = {
        "url": url,
        "final_url": final,
        "path": os.path.relpath(path, ROOT),
        "sha256": hashlib.sha256(body).hexdigest(),
        "bytes": len(body),
        "retrieved_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "http_status": status,
        "content_type": ctype,
        "method": method,
        "error": err,
    }
    with open(os.path.join(ACQ, "_manifest.jsonl"), "a") as manifest:
        manifest.write(json.dumps(line) + "\n")
    print(json.dumps(line))
    time.sleep(MIN_INTERVAL)
    return line


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) % 2:
        raise SystemExit("pairs of <url> <path> required")
    for i in range(0, len(args), 2):
        fetch(args[i], args[i + 1])
