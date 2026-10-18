"""Polite fetcher for the enforcement_series stream.

Downloads each URL once (skips when the target file exists unless --force), keeps the response bytes unchanged
under private/acq/enforcement_series/, and appends a line to _manifest.jsonl with url, path, sha256, bytes,
retrieved_at (UTC), http status and method.

Usage:
  python3 -I -B fetch.py <url> <relative/output/path> [--force]
  python3 -I -B fetch.py --list <file with "url<TAB>relative path" lines> [--force]
"""
import hashlib
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "enforcement_series")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")
UA = "legal-source-compass research (Seeger Weiss internal research)"
MIN_INTERVAL = 1.0  # seconds between requests to the same host (<= 1 req/s)
# robots.txt Crawl-delay values recorded on 2026-10-18: www.justice.gov asks for 10 seconds.
HOST_INTERVAL = {"www.justice.gov": 10.0}
_last = {}


def _context():
    bundle = "/root/.ccr/ca-bundle.crt"
    return ssl.create_default_context(cafile=bundle) if os.path.exists(bundle) else ssl.create_default_context()


def fetch(url, rel, force=False):
    path = os.path.join(ACQ, rel)
    if os.path.exists(path) and not force:
        print("exists", rel)
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    host = urllib.parse.urlsplit(url).netloc
    wait = HOST_INTERVAL.get(host, MIN_INTERVAL) - (time.time() - _last.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    status, body = None, None
    for attempt in range(4):
        request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
        try:
            with urllib.request.urlopen(request, timeout=120, context=_context()) as response:
                status, body = response.status, response.read()
            break
        except urllib.error.HTTPError as error:
            status = error.code
            if error.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(2 ** (attempt + 1))
                continue
            body = error.read()
            break
        except urllib.error.URLError as error:
            if attempt < 3:
                time.sleep(2 ** (attempt + 1))
                continue
            print("error", url, error.reason, file=sys.stderr)
            return None
        finally:
            _last[host] = time.time()
    if status != 200:
        print("status", status, url, file=sys.stderr)
        rel = rel + f".http{status}"
        path = os.path.join(ACQ, rel)
    with open(path, "wb") as out:
        out.write(body or b"")
    entry = {
        "url": url,
        "path": os.path.relpath(path, ROOT),
        "sha256": hashlib.sha256(body or b"").hexdigest(),
        "bytes": len(body or b""),
        "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "http_status": status,
        "method": "direct HTTPS GET (urllib, User-Agent: " + UA + ")",
    }
    with open(MANIFEST, "a") as out:
        out.write(json.dumps(entry) + "\n")
    print(status, entry["bytes"], rel)
    return path if status == 200 else None


def main(argv):
    force = "--force" in argv
    args = [a for a in argv if a != "--force"]
    if args and args[0] == "--list":
        with open(args[1]) as handle:
            for line in handle:
                line = line.rstrip("\n")
                if not line or line.startswith("#"):
                    continue
                url, rel = line.split("\t")
                fetch(url, rel, force)
        return
    fetch(args[0], args[1], force)


if __name__ == "__main__":
    main(sys.argv[1:])
