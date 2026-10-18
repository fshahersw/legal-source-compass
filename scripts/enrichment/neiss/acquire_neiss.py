"""Acquire CPSC NEISS annual public-use TSV files and documentation (raw bytes kept unchanged, gzip for the TSVs).

Owner authorisation 2026-10-18 (neiss stream only). Plain GET with an identifying User-Agent; no forms, no terms accepted.

  python3 -I -B scripts/enrichment/neiss/acquire_neiss.py probe            # HEAD/Range probe each year, print status
  python3 -I -B scripts/enrichment/neiss/acquire_neiss.py years            # download every year that exists
  python3 -I -B scripts/enrichment/neiss/acquire_neiss.py doc <url> <name> # download one documentation file under docs/

Each retrieval appends a line to private/acq/neiss/_manifest.jsonl:
  {url, path, sha256, bytes, retrieved_at, http_status, method}
sha256/bytes describe the file as stored. For gzip-wrapped TSVs `sha256_raw`/`bytes_raw` describe the bytes as served.
"""
import gzip
import hashlib
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "neiss")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")
UA = "legal-source-compass research (contact: notreelai@gmail.com)"
YEAR_URL = "https://www.cpsc.gov/cgibin/NEISSQuery/Data/Archived%20Data/{y}/neiss{y}.tsv"
FIRST, LAST = 1995, 2026
DELAY = 0.6  # seconds between requests (<= 2 req/s per host)


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def opener():
    ctx = ssl.create_default_context(cafile="/root/.ccr/ca-bundle.crt")
    return urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx), urllib.request.ProxyHandler())


def request(url, method="GET", headers=None):
    h = {"User-Agent": UA, "Accept": "*/*"}
    h.update(headers or {})
    return urllib.request.Request(url, headers=h, method=method)


def probe(year):
    url = YEAR_URL.format(y=year)
    op = opener()
    for attempt in range(3):
        try:
            with op.open(request(url, "GET", {"Range": "bytes=0-0"}), timeout=60) as r:
                return {"year": year, "status": r.status, "content_range": r.headers.get("Content-Range"),
                        "length": r.headers.get("Content-Length"), "last_modified": r.headers.get("Last-Modified"),
                        "content_type": r.headers.get("Content-Type")}
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < 2:
                time.sleep(2 ** attempt * 2)
                continue
            return {"year": year, "status": e.code}
        except Exception as e:  # network errors
            if attempt < 2:
                time.sleep(2 ** attempt * 2)
                continue
            return {"year": year, "status": "error", "error": repr(e)[:200]}


def manifest_add(entry):
    with open(MANIFEST, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, sort_keys=True) + "\n")


def download(url, rel_path, gzip_wrap=False):
    """Stream url to ACQ/rel_path (optionally gzip-wrapped), return manifest entry."""
    dest = os.path.join(ACQ, rel_path)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    op = opener()
    last = None
    for attempt in range(4):
        raw = hashlib.sha256()
        n = 0
        part = dest + ".part"
        try:
            with op.open(request(url), timeout=300) as r:
                status = r.status
                lastmod = r.headers.get("Last-Modified")
                ctype = r.headers.get("Content-Type")
                expected = r.headers.get("Content-Length")
                with open(part, "wb") as fh:
                    if gzip_wrap:
                        # mtime=0 and fixed header make the gzip bytes reproducible
                        gz = gzip.GzipFile(filename="", mode="wb", fileobj=fh, compresslevel=9, mtime=0)
                    while True:
                        chunk = r.read(1 << 20)
                        if not chunk:
                            break
                        raw.update(chunk)
                        n += len(chunk)
                        if gzip_wrap:
                            gz.write(chunk)
                        else:
                            fh.write(chunk)
                    if gzip_wrap:
                        gz.close()
            if expected is not None and expected.isdigit() and int(expected) != n:
                # a connection that closes early is not an error to urllib: refuse short transfers (2017 was cut short once)
                raise IOError(f"short read: got {n} of {expected} bytes")
            os.replace(part, dest)
            h = hashlib.sha256()
            with open(dest, "rb") as fh:
                for c in iter(lambda: fh.read(1 << 20), b""):
                    h.update(c)
            entry = {"url": url, "path": os.path.relpath(dest, ROOT), "sha256": h.hexdigest(), "bytes": os.path.getsize(dest),
                     "retrieved_at": now(), "http_status": status, "method": "plain GET, User-Agent: " + UA,
                     "last_modified": lastmod, "content_type": ctype}
            if gzip_wrap:
                entry.update({"sha256_raw": raw.hexdigest(), "bytes_raw": n, "stored_as": "gzip of the served bytes (unchanged content)"})
            manifest_add(entry)
            return entry
        except urllib.error.HTTPError as e:
            last = e.code
            if e.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(2 ** attempt * 3)
                continue
            manifest_add({"url": url, "path": None, "sha256": None, "bytes": 0, "retrieved_at": now(), "http_status": e.code, "method": "plain GET"})
            return None
        except Exception as e:
            last = repr(e)[:200]
            time.sleep(2 ** attempt * 3)
    manifest_add({"url": url, "path": None, "sha256": None, "bytes": 0, "retrieved_at": now(), "http_status": str(last), "method": "plain GET"})
    return None


def main(argv):
    os.makedirs(ACQ, exist_ok=True)
    cmd = argv[0] if argv else "probe"
    if cmd == "probe":
        for y in range(FIRST, LAST + 1):
            print(json.dumps(probe(y)))
            time.sleep(DELAY)
    elif cmd == "years":
        for y in range(FIRST, LAST + 1):
            info = probe(y)
            time.sleep(DELAY)
            if info.get("status") not in (200, 206):
                print(json.dumps({"year": y, "skipped": info.get("status")}))
                continue
            dest = os.path.join("tsv", f"neiss{y}.tsv.gz")
            if os.path.exists(os.path.join(ACQ, dest)):
                print(json.dumps({"year": y, "exists": dest}))
                continue
            e = download(YEAR_URL.format(y=y), dest, gzip_wrap=True)
            print(json.dumps({"year": y, "entry": e}))
            time.sleep(DELAY)
    elif cmd == "doc":
        url, name = argv[1], argv[2]
        e = download(url, os.path.join("docs", name))
        print(json.dumps(e))
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
