"""Acquire FTC data-visualization source files unchanged into private/acq/ftc_sentinel/ with a manifest.

Usage:
  python3 -I -B fetch_ftc.py probe URL [URL ...]          print status/size/type only (nothing saved)
  python3 -I -B fetch_ftc.py get NAME URL [NAME URL ...]  save raw bytes as private/acq/ftc_sentinel/NAME
  python3 -I -B fetch_ftc.py list FILE                    FILE holds lines "NAME URL"; saves each

Every saved file gets a line in private/acq/ftc_sentinel/_manifest.jsonl:
  {url, path, sha256, bytes, retrieved_at (UTC), status, method, content_type}
Rate limit: at most 1 request per second per host; retries with exponential backoff on 429/5xx/network errors.
"""
import datetime as dt
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "ftc_sentinel")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")
UA = "legal-source-compass research (Seeger Weiss internal research)"
MIN_GAP = 1.0
_last = {}


def _wait(host):
    gap = time.time() - _last.get(host, 0)
    if gap < MIN_GAP:
        time.sleep(MIN_GAP - gap)
    _last[host] = time.time()


def fetch(url, tries=5):
    host = urllib.parse.urlparse(url).netloc
    for attempt in range(tries):
        _wait(host)
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                return resp.status, resp.headers.get("Content-Type", ""), resp.read(), resp.geturl()
        except urllib.error.HTTPError as err:
            body = err.read()
            if err.code in (429, 500, 502, 503, 504) and attempt < tries - 1:
                time.sleep(2 ** (attempt + 1))
                continue
            return err.code, err.headers.get("Content-Type", ""), body, url
        except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
            if attempt < tries - 1:
                time.sleep(2 ** (attempt + 1))
                continue
            return 0, "", str(err).encode(), url


def save(name, url):
    status, ctype, body, final = fetch(url)
    if status != 200:
        print(json.dumps({"name": name, "url": url, "status": status, "bytes": len(body), "type": ctype, "head": body[:200].decode("utf-8", "replace")}))
        return None
    path = os.path.join(ACQ, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as out:
        out.write(body)
    entry = {
        "url": url,
        "final_url": final,
        "path": os.path.relpath(path, ROOT),
        "sha256": hashlib.sha256(body).hexdigest(),
        "bytes": len(body),
        "retrieved_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": status,
        "method": "direct HTTPS GET (urllib, User-Agent: %s)" % UA,
        "content_type": ctype,
    }
    with open(MANIFEST, "a") as man:
        man.write(json.dumps(entry) + "\n")
    print(json.dumps({k: entry[k] for k in ("path", "bytes", "status", "content_type")}))
    return entry


def main(argv):
    if not argv:
        raise SystemExit(__doc__)
    cmd, rest = argv[0], argv[1:]
    if cmd == "probe":
        for url in rest:
            status, ctype, body, final = fetch(url, tries=2)
            print(status, len(body), ctype, url, "->", final if final != url else "")
    elif cmd == "get":
        for i in range(0, len(rest), 2):
            save(rest[i], rest[i + 1])
    elif cmd == "list":
        with open(rest[0]) as handle:
            for line in handle:
                line = line.strip()
                if line and not line.startswith("#"):
                    name, url = line.split(None, 1)
                    if os.path.exists(os.path.join(ACQ, name)) and "--force" not in rest:
                        print("exists", name)
                        continue
                    save(name, url)
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
